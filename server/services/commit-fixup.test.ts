/**
 * statusService.commitFixup · 单测
 *
 * 验证 `git commit --fixup=<sha>` 把已暂存改动提交为 `fixup! <目标标题>`，
 * 并能被 branchService.rebaseAutosquash 自动合并回目标 commit。
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { statusService } from "./status.service.js";
import { branchService } from "./branch.service.js";

const execFile = promisify(execFileCb);

async function runGit(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", repo, ...args], { encoding: "utf8" });
  return stdout;
}

async function makeRepo(): Promise<{ dir: string; baseSha: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-fixup-"));
  await runGit(dir, "init", "-q", "-b", "main");
  await runGit(dir, "config", "user.email", "t@test");
  await runGit(dir, "config", "user.name", "t");
  // 隔离用户全局 core.autocrlf：避免 rebase checkout 时 LF→CRLF 干扰换行内容断言
  await runGit(dir, "config", "core.autocrlf", "false");
  await fs.writeFile(path.join(dir, "README.md"), "v1\n", "utf8");
  await runGit(dir, "add", "README.md");
  await runGit(dir, "commit", "-q", "-m", "init");
  const baseSha = (await runGit(dir, "rev-parse", "HEAD")).trim();
  return { dir, baseSha };
}

describe("statusService.commitFixup", () => {
  let repo: string;
  let baseSha: string;

  beforeEach(async () => {
    ({ dir: repo, baseSha } = await makeRepo());
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("已暂存改动 → 生成 fixup! <目标标题> 提交", { timeout: 30_000 }, async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "A1\n");
    await runGit(repo, "add", "a.txt");
    await runGit(repo, "commit", "-q", "-m", "feat: A");
    const featSha = (await runGit(repo, "rev-parse", "HEAD")).trim();

    // 暂存一处补丁改动
    await fs.writeFile(path.join(repo, "a.txt"), "A2\n");
    await runGit(repo, "add", "a.txt");

    const sha = await statusService.commitFixup(repo, featSha);
    expect(sha).toMatch(/^[a-f0-9]+$/);

    const subject = (await runGit(repo, "log", "-1", "--pretty=%s")).trim();
    expect(subject).toBe("fixup! feat: A");

    const count = parseInt((await runGit(repo, "rev-list", "--count", "HEAD")).trim(), 10);
    expect(count).toBe(3); // init / feat: A / fixup!
  });

  it("暂存区为空 → 抛错（nothing to commit）", { timeout: 30_000 }, async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "A1\n");
    await runGit(repo, "add", "a.txt");
    await runGit(repo, "commit", "-q", "-m", "feat: A");
    const featSha = (await runGit(repo, "rev-parse", "HEAD")).trim();

    await expect(statusService.commitFixup(repo, featSha)).rejects.toThrow();
  });

  it("端到端：commitFixup 后 autosquash 自动合并回目标 commit", { timeout: 30_000 }, async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "A1\n");
    await runGit(repo, "add", "a.txt");
    await runGit(repo, "commit", "-q", "-m", "feat: A");
    const featSha = (await runGit(repo, "rev-parse", "HEAD")).trim();

    await fs.writeFile(path.join(repo, "a.txt"), "A2\n");
    await runGit(repo, "add", "a.txt");
    await statusService.commitFixup(repo, featSha);

    const r = await branchService.rebaseAutosquash(repo, baseSha);
    expect(r.success).toBe(true);

    const count = parseInt((await runGit(repo, "rev-list", "--count", "HEAD")).trim(), 10);
    expect(count).toBe(2); // init / feat: A（已并入 fixup）

    const content = await fs.readFile(path.join(repo, "a.txt"), "utf8");
    expect(content).toBe("A2\n");
  });
});
