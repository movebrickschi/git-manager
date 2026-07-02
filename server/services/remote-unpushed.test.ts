/**
 * remoteService.getUnpushedCommits · 真实 git 集成测试
 *
 * 回归点：分支首次推送（remote-tracking ref 不存在）时，推送预览必须正确列出
 * “会被推送的提交”，而不是因 `<remote>/<branch>..HEAD` 报错被吞成空列表
 * （旧实现 → 弹框误显示“无待推送的提交”）。
 *
 * 用 `git update-ref refs/remotes/origin/main` 手动模拟远端分支，无需联网。
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { remoteService } from "./remote.service.js";

const execFile = promisify(execFileCb);

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", repo, ...args], { encoding: "utf8" });
  return stdout;
}

async function makeRepoWithRemote(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-unpushed-"));
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@test");
  await git(dir, "config", "user.name", "t");
  await git(dir, "config", "core.autocrlf", "false");
  await fs.writeFile(path.join(dir, "base.txt"), "base\n", "utf8");
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "init");
  await git(dir, "branch", "-M", "main");
  // 模拟一个 origin：注册 remote + 手动建 remote-tracking ref 指向 main（不联网）
  await git(dir, "remote", "add", "origin", "https://example.invalid/x.git");
  await git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  return dir;
}

describe("remoteService.getUnpushedCommits · 远端分支状态", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepoWithRemote();
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("新分支（origin/feature 不存在）→ 列出会被推送的提交，而非空", async () => {
    await git(repo, "checkout", "-q", "-b", "feature");
    await fs.writeFile(path.join(repo, "f1.txt"), "f1\n", "utf8");
    await git(repo, "add", ".");
    await git(repo, "commit", "-q", "-m", "feat 1");
    await fs.writeFile(path.join(repo, "f2.txt"), "f2\n", "utf8");
    await git(repo, "add", ".");
    await git(repo, "commit", "-q", "-m", "feat 2");

    const commits = await remoteService.getUnpushedCommits(repo, "origin", "feature");

    // 旧实现这里会因 origin/feature 不存在而返回 []，弹框显示“无待推送的提交”
    expect(commits.map((c) => c.summary)).toEqual(["feat 2", "feat 1"]);
  });

  it("远端分支已存在且最新 → 返回空（确实无可推送）", async () => {
    const commits = await remoteService.getUnpushedCommits(repo, "origin", "main");
    expect(commits).toEqual([]);
  });

  it("远端分支存在但本地领先 → 只列出领先的提交", async () => {
    await fs.writeFile(path.join(repo, "m2.txt"), "m2\n", "utf8");
    await git(repo, "add", ".");
    await git(repo, "commit", "-q", "-m", "main 2");

    const commits = await remoteService.getUnpushedCommits(repo, "origin", "main");
    expect(commits.map((c) => c.summary)).toEqual(["main 2"]);
  });
});
