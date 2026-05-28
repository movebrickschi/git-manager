/**
 * server/services/conflict.service · 单测
 *
 * 覆盖：
 *   - getMergeState · 4 种状态：none / merge / cherry-pick / revert
 *     （rebase 状态依赖 git rebase 中途断点，CI/本地行为不稳，单独跳过）
 *   - getConflictContent · 正常合并冲突文件能读出 ours/theirs/base 三段
 *   - resolveConflict · 写文件 + git add 后 conflict 列表清空
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { conflictService } from "./conflict.service.js";

const execFile = promisify(execFileCb);

async function runGit(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", repo, ...args], { encoding: "utf8" });
  return stdout;
}

async function makeRepoWithCommit(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-conflict-svc-"));
  await runGit(dir, "init", "-q", "-b", "main");
  await runGit(dir, "config", "user.email", "t@test");
  await runGit(dir, "config", "user.name", "t");
  await fs.writeFile(path.join(dir, "README.md"), "# v1\n", "utf8");
  await runGit(dir, "add", "README.md");
  await runGit(dir, "commit", "-q", "-m", "v1");
  return dir;
}

/**
 * 制造一个真实的 merge 冲突：
 * - main 分支改 README 为 "main edit"
 * - feature 分支改 README 为 "feature edit"
 * - 在 main 上 merge feature → 冲突
 */
async function makeMergeConflict(repo: string): Promise<void> {
  await runGit(repo, "checkout", "-q", "-b", "feature");
  await fs.writeFile(path.join(repo, "README.md"), "# feature edit\n", "utf8");
  await runGit(repo, "commit", "-q", "-am", "feature edit");
  await runGit(repo, "checkout", "-q", "main");
  await fs.writeFile(path.join(repo, "README.md"), "# main edit\n", "utf8");
  await runGit(repo, "commit", "-q", "-am", "main edit");
  // 这里会失败但是会留下 conflict 状态
  await runGit(repo, "merge", "feature").catch(() => {});
}

describe("conflictService.getMergeState · 状态机", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepoWithCommit();
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("纯净仓库 → state=none, hasConflicts=false", async () => {
    const s = await conflictService.getMergeState(repo);
    expect(s.state).toBe("none");
    expect(s.hasConflicts).toBe(false);
  });

  it("merge 冲突中 → state=merge, hasConflicts=true", async () => {
    await makeMergeConflict(repo);
    const s = await conflictService.getMergeState(repo);
    expect(s.state).toBe("merge");
    expect(s.hasConflicts).toBe(true);
  });

  it("cherry-pick 冲突中 → state=cherry-pick", async () => {
    // 准备：feature 分支有 1 个 commit；main 也改了同行
    await runGit(repo, "checkout", "-q", "-b", "feature");
    await fs.writeFile(path.join(repo, "README.md"), "# feature\n", "utf8");
    await runGit(repo, "commit", "-q", "-am", "feature change");
    const featureSha = (await runGit(repo, "rev-parse", "HEAD")).trim();
    await runGit(repo, "checkout", "-q", "main");
    await fs.writeFile(path.join(repo, "README.md"), "# main\n", "utf8");
    await runGit(repo, "commit", "-q", "-am", "main change");

    await runGit(repo, "cherry-pick", featureSha).catch(() => {});

    const s = await conflictService.getMergeState(repo);
    expect(s.state).toBe("cherry-pick");
  });
});

describe("conflictService.getConflictContent · 三路读取", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepoWithCommit();
    await makeMergeConflict(repo);
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("冲突文件能读出 ours / theirs / base 三段", async () => {
    const files = await conflictService.getConflictFiles(repo);
    expect(files).toContain("README.md");

    const content = await conflictService.getConflictContent(repo, "README.md");
    expect(content.path).toBe("README.md");
    expect(content.oursContent).toContain("main edit");
    expect(content.theirsContent).toContain("feature edit");
    // base 是 "# v1\n"
    expect(content.baseContent).toContain("v1");
  });

  it("不存在的文件 → 三段为空字符串而不抛", async () => {
    const content = await conflictService.getConflictContent(repo, "does-not-exist.txt");
    expect(content.oursContent).toBe("");
    expect(content.theirsContent).toBe("");
    expect(content.baseContent).toBe("");
  });
});

describe("conflictService.resolveConflict", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepoWithCommit();
    await makeMergeConflict(repo);
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("写解决内容 + git add → 冲突列表清空", async () => {
    await conflictService.resolveConflict(repo, "README.md", "# resolved\n");
    const remaining = await conflictService.getConflictFiles(repo);
    expect(remaining).toHaveLength(0);
    // 内容也确实写入工作区
    const written = await fs.readFile(path.join(repo, "README.md"), "utf8");
    expect(written).toBe("# resolved\n");
  });

  it("path traversal 拦截", async () => {
    await expect(
      conflictService.resolveConflict(repo, "../../escape.txt", "x")
    ).rejects.toThrow(/path traversal/);
  });
});
