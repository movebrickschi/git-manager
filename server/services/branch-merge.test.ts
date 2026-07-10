/**
 * branchService.mergeBranch · 已合并分支重复合并提示
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
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

async function makeMergedRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-merge-dup-"));
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@test");
  await git(dir, "config", "user.name", "t");
  await git(dir, "config", "core.autocrlf", "false");
  await fs.writeFile(path.join(dir, "README.md"), "# init\n", "utf8");
  await git(dir, "add", "README.md");
  await git(dir, "commit", "-q", "-m", "init");
  await git(dir, "branch", "-M", "main");

  await git(dir, "checkout", "-q", "-b", "feat");
  await fs.writeFile(path.join(dir, "feat.txt"), "feat\n", "utf8");
  await git(dir, "add", "feat.txt");
  await git(dir, "commit", "-q", "-m", "feat commit");
  await git(dir, "checkout", "-q", "main");
  await git(dir, "merge", "-q", "feat", "-m", "merge feat");
  return dir;
}

async function makeUnmergedRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-merge-new-"));
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@test");
  await git(dir, "config", "user.name", "t");
  await git(dir, "config", "core.autocrlf", "false");
  await fs.writeFile(path.join(dir, "README.md"), "# init\n", "utf8");
  await git(dir, "add", "README.md");
  await git(dir, "commit", "-q", "-m", "init");
  await git(dir, "branch", "-M", "main");

  await git(dir, "checkout", "-q", "-b", "feat");
  await fs.writeFile(path.join(dir, "feat.txt"), "feat\n", "utf8");
  await git(dir, "add", "feat.txt");
  await git(dir, "commit", "-q", "-m", "feat commit");
  await git(dir, "checkout", "-q", "main");
  return dir;
}

describe("branchService.mergeBranch · 已合并检测", () => {
  let repo: string;

  afterEach(async () => {
    if (repo) await fs.rm(repo, { recursive: true, force: true });
  });

  it("源分支已合并到 HEAD 时返回已合并状态且不产生新提交", async () => {
    repo = await makeMergedRepo();
    const before = (await git(repo, "rev-parse", "HEAD")).trim();

    const result = await branchService.mergeBranch(repo, "feat");

    expect(result.success).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.message).toBe("已合并");
    expect((await git(repo, "rev-parse", "HEAD")).trim()).toBe(before);
  });

  it("源分支有未合并提交时正常完成合并", async () => {
    repo = await makeUnmergedRepo();
    const before = (await git(repo, "rev-parse", "HEAD")).trim();

    const result = await branchService.mergeBranch(repo, "feat");

    expect(result.success).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.message).not.toBe("已合并");
    expect((await git(repo, "rev-parse", "HEAD")).trim()).not.toBe(before);
  });
});
