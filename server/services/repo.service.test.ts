/**
 * server/services/repo.service · 单测
 *
 * 覆盖 P3 加入的友好错误兜底（B1/B2/B4）+ B3 的 redactUrl 行为：
 *   - openRepo：路径不存在 / 非目录 / 非 git 仓库 / 正常
 *   - openRepo：detached HEAD 时 currentBranch 走 short sha fallback
 *   - cloneRepo：url/target 为空抛 INVALID_URL/INVALID_PATH
 *   - cloneRepo：target 非空目录抛 PATH_NOT_EMPTY
 *   - redactUrl：脏 https/git URL 中的 user/token 被打码
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { redactUrl, repoService } from "./repo.service.js";

const execFile = promisify(execFileCb);

async function makeTmpDir(prefix = "gm-repo-svc-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function initGitRepo(dir: string): Promise<void> {
  await execFile("git", ["-C", dir, "init", "-q"], { encoding: "utf8" });
  await execFile("git", ["-C", dir, "config", "user.email", "t@test"], { encoding: "utf8" });
  await execFile("git", ["-C", dir, "config", "user.name", "t"], { encoding: "utf8" });
}

async function makeFirstCommit(dir: string): Promise<void> {
  await fs.writeFile(path.join(dir, "README.md"), "# init\n", "utf8");
  await execFile("git", ["-C", dir, "add", "README.md"], { encoding: "utf8" });
  await execFile("git", ["-C", dir, "commit", "-q", "-m", "init"], { encoding: "utf8" });
}

describe("redactUrl", () => {
  it.each([
    ["https://oauth2:GITHUB_TOKEN@github.com/o/r.git", "https://***@github.com/o/r.git"],
    ["https://user:pass@gitlab.com/g/p.git", "https://***@gitlab.com/g/p.git"],
    ["https://ghp_XXXXXXXX@github.com/o/r.git", "https://***@github.com/o/r.git"],
  ])("redact %s → %s", (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });

  it("无 user 的 https 不修改", () => {
    expect(redactUrl("https://github.com/o/r.git")).toBe("https://github.com/o/r.git");
  });

  it("ssh URL 不修改（ssh 不带 secret）", () => {
    expect(redactUrl("git@github.com:o/r.git")).toBe("git@github.com:o/r.git");
  });

  it("非 string 输入安全转字符串", () => {
    expect(redactUrl(123 as unknown as string)).toBe("123");
  });
});

describe("repoService.openRepo · 错误兜底", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it("空字符串路径 → 抛 INVALID_PATH", async () => {
    await expect(repoService.openRepo("")).rejects.toThrow(/INVALID_PATH/);
  });

  it("不存在的路径 → 抛 REPO_NOT_FOUND", async () => {
    const ghost = path.join(workdir, "does-not-exist");
    await expect(repoService.openRepo(ghost)).rejects.toThrow(/REPO_NOT_FOUND/);
  });

  it("路径是文件不是目录 → 抛 INVALID_PATH", async () => {
    const f = path.join(workdir, "not-a-dir.txt");
    await fs.writeFile(f, "x");
    await expect(repoService.openRepo(f)).rejects.toThrow(/INVALID_PATH/);
  });

  it("目录存在但不是 git 仓库 → 抛 Not a git repository", async () => {
    await expect(repoService.openRepo(workdir)).rejects.toThrow(/Not a git repository/);
  });
});

describe("repoService.openRepo · 正常路径", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTmpDir("gm-repo-ok-");
    await initGitRepo(repoDir);
    await makeFirstCommit(repoDir);
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("正常 git 仓库 → 返回 path/name/currentBranch", async () => {
    const info = await repoService.openRepo(repoDir);
    expect(info.path).toBeTruthy();
    expect(info.name).toBe(path.basename(repoDir));
    // git init 默认分支可能是 master 或 main，二者都接受
    expect(info.currentBranch).toMatch(/^(master|main)$/);
  });

  it("子目录传入也能识别到 toplevel（show-toplevel）", async () => {
    const sub = path.join(repoDir, "deep", "nested");
    await fs.mkdir(sub, { recursive: true });
    const info = await repoService.openRepo(sub);
    // 在 macOS 上 /var/folders/... 实际是 /private/var/folders/...，realpath 后可能不一样
    expect(path.basename(info.path)).toBe(path.basename(repoDir));
  });

  it("detached HEAD → currentBranch 走 (HEAD: sha) fallback", async () => {
    // checkout 当前 commit 触发 detached
    const sha = (
      await execFile("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" })
    ).stdout.trim();
    await execFile("git", ["-C", repoDir, "checkout", "-q", "--detach", sha], { encoding: "utf8" });
    const info = await repoService.openRepo(repoDir);
    expect(info.currentBranch).toMatch(/^\(HEAD: [a-f0-9]+\)$/);
  });
});

describe("repoService.cloneRepo · 输入校验", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it("空 url → INVALID_URL", async () => {
    await expect(repoService.cloneRepo("", workdir)).rejects.toThrow(/INVALID_URL/);
  });

  it("空 target → INVALID_PATH", async () => {
    await expect(repoService.cloneRepo("https://example.com/x.git", "")).rejects.toThrow(
      /INVALID_PATH/
    );
  });

  it("target 已存在且为非空目录 → PATH_NOT_EMPTY", async () => {
    const target = path.join(workdir, "nonempty");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "x.txt"), "x");
    await expect(
      repoService.cloneRepo("https://example.com/x.git", target)
    ).rejects.toThrow(/PATH_NOT_EMPTY/);
  });

  it("target 已存在但是文件 → INVALID_PATH", async () => {
    const f = path.join(workdir, "is-a-file");
    await fs.writeFile(f, "x");
    await expect(
      repoService.cloneRepo("https://example.com/x.git", f)
    ).rejects.toThrow(/INVALID_PATH/);
  });
});
