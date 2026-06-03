/**
 * branchService 切换分支 · 未跟踪/被忽略文件覆盖冲突 · 单测
 *
 * 复现真实 bug：unplugin 自动生成的 `gen.d.ts` 在当前分支被 `.gitignore` 忽略
 * （`git status` / `stash -u` 都看不到它），却在目标分支被提交跟踪。切换时
 * `git checkout` 会报 "The following untracked working tree files would be
 * overwritten by checkout"，而预检却误判为"安全"。
 *
 * 覆盖：
 *   - previewCheckoutConflicts：能把这类文件归入 untrackedConflict（即便 dirty 为空）
 *   - smartCheckoutBranch：能成功切换、保留 tracked 改动、并把被覆盖文件备份到 .git
 *   - forceCheckoutBranch：能成功切换（不再被 untracked overwrite 阻塞）
 */
import { execFile as execFileCb } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { branchService } from "./branch.service.js";

const execFile = promisify(execFileCb);

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", repo, ...args], { encoding: "utf8" });
  return stdout;
}

/**
 * 构造 bug 仓库：
 *   main：跟踪 README.md + .gitignore(忽略 gen.d.ts)
 *   feat：在 main 基础上用 `git add -f` 强制跟踪 gen.d.ts
 * 切回 main 后重新生成 gen.d.ts（未跟踪/被忽略），并制造 tracked + untracked dirty。
 */
async function makeBugRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-smart-co-"));
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@test");
  await git(dir, "config", "user.name", "t");
  await git(dir, "config", "core.autocrlf", "false");
  await fs.writeFile(path.join(dir, "README.md"), "# init\n", "utf8");
  await fs.writeFile(path.join(dir, ".gitignore"), "gen.d.ts\n", "utf8");
  await git(dir, "add", "README.md", ".gitignore");
  await git(dir, "commit", "-q", "-m", "init");
  await git(dir, "branch", "-M", "main");

  // feat 分支强制跟踪被忽略的 gen.d.ts
  await git(dir, "checkout", "-q", "-b", "feat");
  await fs.writeFile(path.join(dir, "gen.d.ts"), "export const FEAT = 1;\n", "utf8");
  await git(dir, "add", "-f", "gen.d.ts");
  await git(dir, "commit", "-q", "-m", "feat tracks gen.d.ts");
  await git(dir, "checkout", "-q", "main");

  // 模拟切回 main 后工具重新生成（未跟踪 + 被忽略）+ 正常 dirty
  await fs.writeFile(path.join(dir, "gen.d.ts"), "export const LOCAL = 2;\n", "utf8");
  await fs.writeFile(path.join(dir, "README.md"), "# local edit\n", "utf8");
  await fs.writeFile(path.join(dir, "notes.txt"), "scratch\n", "utf8");
  return dir;
}

/**
 * 构造 stash-pop 冲突仓库：
 *   main：conflict.txt = "base"
 *   feat：conflict.txt = "feat version"（已提交）
 *   切回 main 后对同一文件做未提交修改 = "local version"
 * smartCheckout 到 feat 时 stash→切→pop 会在 conflict.txt 上撞车。
 */
async function makeConflictRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-co-conflict-"));
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@test");
  await git(dir, "config", "user.name", "t");
  await git(dir, "config", "core.autocrlf", "false");
  await fs.writeFile(path.join(dir, "conflict.txt"), "base\n", "utf8");
  await git(dir, "add", "conflict.txt");
  await git(dir, "commit", "-q", "-m", "init");
  await git(dir, "branch", "-M", "main");

  await git(dir, "checkout", "-q", "-b", "feat");
  await fs.writeFile(path.join(dir, "conflict.txt"), "feat version\n", "utf8");
  await git(dir, "commit", "-q", "-am", "feat edits conflict.txt");
  await git(dir, "checkout", "-q", "main");

  // 未提交本地修改，与 feat 改动同一文件 → stash pop 必冲突
  await fs.writeFile(path.join(dir, "conflict.txt"), "local version\n", "utf8");
  return dir;
}

async function currentBranch(repo: string): Promise<string> {
  return (await git(repo, "rev-parse", "--abbrev-ref", "HEAD")).trim();
}

describe("branchService.previewCheckoutConflicts · 未跟踪覆盖检测", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeBugRepo();
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("被忽略但目标分支跟踪的文件 → 归入 untrackedConflict", async () => {
    // 前端 dirty 来自 git status，不含被忽略的 gen.d.ts
    const preview = await branchService.previewCheckoutConflicts(repo, "feat", [
      "README.md",
      "notes.txt",
    ]);
    expect(preview.untrackedConflict).toContain("gen.d.ts");
    // README/notes 在目标分支没动 → 安全保留
    expect(preview.safe.sort()).toEqual(["README.md", "notes.txt"]);
    expect(preview.wouldConflict).toEqual([]);
  });

  it("即便 dirtyFiles 为空，也能检测出 untrackedConflict", async () => {
    const preview = await branchService.previewCheckoutConflicts(repo, "feat", []);
    expect(preview.untrackedConflict).toContain("gen.d.ts");
  });
});

describe("branchService.smartCheckoutBranch · 处理未跟踪覆盖", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeBugRepo();
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("成功切到 feat，保留 tracked 改动，被覆盖文件已备份", async () => {
    const res = await branchService.smartCheckoutBranch(repo, "feat");
    expect(res.success).toBe(true);
    expect(await currentBranch(repo)).toBe("feat");

    // tracked 改动被 stash pop 恢复
    expect(await fs.readFile(path.join(repo, "README.md"), "utf8")).toBe("# local edit\n");
    // 普通 untracked 也恢复
    expect(existsSync(path.join(repo, "notes.txt"))).toBe(true);
    // gen.d.ts 现在是目标分支版本
    expect(await fs.readFile(path.join(repo, "gen.d.ts"), "utf8")).toBe("export const FEAT = 1;\n");

    // 原未跟踪版本备份在 .git/gitmanager-backup 下
    const backupRoot = path.join(repo, ".git", "gitmanager-backup");
    expect(existsSync(backupRoot)).toBe(true);
    const found = await findFile(backupRoot, "gen.d.ts");
    expect(found).not.toBeNull();
    expect(await fs.readFile(found!, "utf8")).toBe("export const LOCAL = 2;\n");
  });
});

describe("branchService.forceCheckoutBranch · 处理未跟踪覆盖", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeBugRepo();
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("force 切换不再被 untracked overwrite 阻塞", async () => {
    await expect(branchService.forceCheckoutBranch(repo, "feat")).resolves.toBeUndefined();
    expect(await currentBranch(repo)).toBe("feat");
    expect(await fs.readFile(path.join(repo, "gen.d.ts"), "utf8")).toBe("export const FEAT = 1;\n");
  });
});

describe("branchService.smartCheckoutBranch · stash pop 冲突回传 autoStash", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeConflictRepo();
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("pop 冲突时 success=false、conflicts 含文件、autoStash.kind=stash-pop", async () => {
    const res = await branchService.smartCheckoutBranch(repo, "feat");
    expect(res.success).toBe(false);
    expect(res.conflicts).toContain("conflict.txt");
    expect(res.autoStash).toEqual({ kind: "stash-pop" });
    // 已切到目标分支，pop 失败的改动以冲突标记落在工作区，stash 仍在栈顶
    expect(await currentBranch(repo)).toBe("feat");
  });
});

/** 在目录树里递归找第一个同名文件，返回绝对路径或 null。 */
async function findFile(root: string, name: string): Promise<string | null> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      const hit = await findFile(full, name);
      if (hit) return hit;
    } else if (e.name === name) {
      return full;
    }
  }
  return null;
}
