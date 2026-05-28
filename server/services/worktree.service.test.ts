/**
 * worktreeService · 单测
 *
 * 覆盖 parseWorktreePorcelain 解析正确性 + add/list/remove 端到端。
 * lock/unlock/prune 不做端到端（避免 git 状态污染），仅信任直接透传 git 命令。
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseWorktreePorcelain, worktreeService } from "./worktree.service.js";

const execFile = promisify(execFileCb);

async function runGit(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", repo, ...args], { encoding: "utf8" });
  return stdout;
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-worktree-"));
  await runGit(dir, "init", "-q", "-b", "main");
  await runGit(dir, "config", "user.email", "t@test");
  await runGit(dir, "config", "user.name", "t");
  await fs.writeFile(path.join(dir, "README.md"), "# v1\n", "utf8");
  await runGit(dir, "add", "README.md");
  await runGit(dir, "commit", "-q", "-m", "init");
  return dir;
}

describe("parseWorktreePorcelain", () => {
  it("空输入 → []", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
    expect(parseWorktreePorcelain("   \n  ")).toEqual([]);
  });

  it("单主工作树 + 普通分支", () => {
    const raw = [
      "worktree /repo/main",
      "HEAD aaaaaaa1111111111111111111111111111111aa",
      "branch refs/heads/main",
      "",
    ].join("\n");
    const list = parseWorktreePorcelain(raw);
    expect(list).toHaveLength(1);
    expect(list[0]!).toMatchObject({
      path: "/repo/main",
      head: "aaaaaaa1111111111111111111111111111111aa",
      branch: "main",
      detached: false,
      locked: false,
      main: true,
    });
  });

  it("主 + 附加 detached + locked 三段", () => {
    const raw = [
      "worktree /repo/main",
      "HEAD aaaaaaa1111111111111111111111111111111aa",
      "branch refs/heads/main",
      "",
      "worktree /tmp/wt-detached",
      "HEAD bbbbbbb1111111111111111111111111111111bb",
      "detached",
      "",
      "worktree /tmp/wt-locked",
      "HEAD ccccccc1111111111111111111111111111111cc",
      "branch refs/heads/feature",
      "locked because review",
      "",
    ].join("\n");
    const list = parseWorktreePorcelain(raw);
    expect(list).toHaveLength(3);
    expect(list[0]!.main).toBe(true);
    expect(list[1]!.detached).toBe(true);
    expect(list[1]!.branch).toBeNull();
    expect(list[2]!.locked).toBe(true);
    expect(list[2]!.lockReason).toBe("because review");
    expect(list[2]!.branch).toBe("feature");
  });

  it("bare 仓库", () => {
    const raw = ["worktree /repo/bare.git", "bare", ""].join("\n");
    const list = parseWorktreePorcelain(raw);
    expect(list[0]!.bare).toBe(true);
  });
});

describe("worktreeService · 端到端 add/list/remove", () => {
  let repo: string;
  let wtTarget: string;

  beforeEach(async () => {
    repo = await makeRepo();
    wtTarget = path.join(os.tmpdir(), `gm-wt-add-${Date.now()}`);
  });

  afterEach(async () => {
    await fs.rm(wtTarget, { recursive: true, force: true }).catch(() => {});
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("listWorktrees 仅含主工作树", async () => {
    const list = await worktreeService.listWorktrees(repo);
    expect(list).toHaveLength(1);
    expect(list[0]!.main).toBe(true);
    expect(list[0]!.path).toBeTruthy();
  });

  it("addWorktree + listWorktrees + removeWorktree 全流程", async () => {
    await worktreeService.addWorktree(repo, wtTarget, undefined, "feature-x");
    const list = await worktreeService.listWorktrees(repo);
    expect(list.length).toBeGreaterThanOrEqual(2);
    const wt = list.find((w) => !w.main);
    expect(wt).toBeTruthy();
    expect(wt!.branch).toBe("feature-x");

    await worktreeService.removeWorktree(repo, wtTarget);
    const after = await worktreeService.listWorktrees(repo);
    expect(after).toHaveLength(1);
  });

  it("addWorktree · 空 targetPath 抛 INVALID_PATH", async () => {
    await expect(worktreeService.addWorktree(repo, "")).rejects.toThrow(/INVALID_PATH/);
    await expect(worktreeService.addWorktree(repo, "   ")).rejects.toThrow(/INVALID_PATH/);
  });
});
