/**
 * logService.getLog · 默认分支视图 · 单测
 *
 * 回归方案 A 的修复：未指定 filter.branch 时，日志默认只显示当前检出分支（HEAD）的
 * 历史，而不再用 `git log --all`。`--all` 会展开 refs/ 下所有引用（含 refs/stash 及
 * 其它本地/远程分支），把 stash 提交（WIP on <b> / On <b> / index on <b>）和无关分支
 * 的提交混进日志列表。
 *
 * 覆盖：
 *   - 默认（branch:null）只返回 HEAD 可达提交，排除 stash 与其它分支独有提交
 *   - 显式 branch=feat 时返回该分支历史（分叉前的共同祖先 + feat 独有提交）
 *   - 空仓库 / unborn 分支默认调用不抛错、返回空日志
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { logService } from "./log.service.js";
import { disposeGitInstances } from "./_helpers.js";
import type { LogFilter } from "../git-service.js";

const execFile = promisify(execFileCb);

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", repo, ...args], { encoding: "utf8" });
  return stdout;
}

function makeFilter(overrides: Partial<LogFilter> = {}): LogFilter {
  return {
    skip: 0,
    limit: 100,
    branch: null,
    author: null,
    dateFrom: null,
    dateTo: null,
    path: null,
    searchText: "",
    useRegex: false,
    matchCase: false,
    ...overrides,
  };
}

async function initRepo(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@test");
  await git(dir, "config", "user.name", "t");
  await git(dir, "config", "core.autocrlf", "false");
  await git(dir, "config", "commit.gpgsign", "false");
  return dir;
}

/** HEAD 可达的全部 commit id 集合；用于断言日志不混入 stash / 其它分支提交。 */
async function revListHead(repo: string): Promise<Set<string>> {
  const out = await git(repo, "rev-list", "HEAD");
  return new Set(
    out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

const tmpDirs: string[] = [];
afterEach(async () => {
  disposeGitInstances();
  await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("logService.getLog · 默认只显示当前分支（方案 A）", () => {
  it("默认（branch:null）排除 stash 与其它分支提交", async () => {
    const repo = await initRepo("gm-log-default-");
    tmpDirs.push(repo);

    await fs.writeFile(path.join(repo, "file.txt"), "v1\n", "utf8");
    await git(repo, "add", "file.txt");
    await git(repo, "commit", "-q", "-m", "init");
    await git(repo, "branch", "-M", "main");

    await fs.writeFile(path.join(repo, "file.txt"), "v2\n", "utf8");
    await git(repo, "commit", "-q", "-am", "main second");

    // feat 分支独有提交（默认视图不应出现）
    await git(repo, "checkout", "-q", "-b", "feat");
    await fs.writeFile(path.join(repo, "feat.txt"), "f1\n", "utf8");
    await git(repo, "add", "feat.txt");
    await git(repo, "commit", "-q", "-m", "feat only commit");
    await git(repo, "checkout", "-q", "main");

    // 制造 stash（写入 refs/stash，默认视图不应出现）
    await fs.writeFile(path.join(repo, "file.txt"), "dirty\n", "utf8");
    await git(repo, "stash", "push", "-m", "wip stash");
    expect((await git(repo, "stash", "list")).trim()).not.toBe("");

    const result = await logService.getLog(repo, makeFilter());

    const headSet = await revListHead(repo);
    // 所有返回提交都必须是 HEAD（main）可达 —— stash 与 feat 独有提交都不该出现
    expect(result.commits.every((c) => headSet.has(c.id))).toBe(true);
    expect(result.commits).toHaveLength(2);

    const summaries = result.commits.map((c) => c.summary);
    expect(summaries).toEqual(["main second", "init"]);
    expect(summaries.some((s) => /feat only commit/.test(s))).toBe(false);
    expect(summaries.some((s) => /WIP on|on main/i.test(s))).toBe(false);
    expect(result.graphRows).toHaveLength(2);
  });

  it("显式 branch=feat 时返回该分支完整历史（共同祖先 + feat 独有）", async () => {
    const repo = await initRepo("gm-log-branch-");
    tmpDirs.push(repo);

    await fs.writeFile(path.join(repo, "file.txt"), "v1\n", "utf8");
    await git(repo, "add", "file.txt");
    await git(repo, "commit", "-q", "-m", "init");
    await git(repo, "branch", "-M", "main");
    await fs.writeFile(path.join(repo, "file.txt"), "v2\n", "utf8");
    await git(repo, "commit", "-q", "-am", "main second");

    await git(repo, "checkout", "-q", "-b", "feat");
    await fs.writeFile(path.join(repo, "feat.txt"), "f1\n", "utf8");
    await git(repo, "add", "feat.txt");
    await git(repo, "commit", "-q", "-m", "feat only commit");
    await git(repo, "checkout", "-q", "main");

    const result = await logService.getLog(repo, makeFilter({ branch: "feat" }));
    const summaries = result.commits.map((c) => c.summary);
    expect(summaries).toEqual(["feat only commit", "main second", "init"]);
  });

  it("空仓库 / unborn 分支默认调用不抛错、返回空日志", async () => {
    const repo = await initRepo("gm-log-empty-");
    tmpDirs.push(repo);

    const result = await logService.getLog(repo, makeFilter());
    expect(result.commits).toEqual([]);
    expect(result.graphRows).toEqual([]);
  });
});
