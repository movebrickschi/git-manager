/**
 * branchService.rebaseAutosquash · 单测
 *
 * 制造一个 fixup commit 场景：
 *   v1 (base) → A (initial code) → A fixup! (修复 A)
 * autosquash 后期望：
 *   v1 → A (合并了 fixup 的版本)，总 commit -1
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { branchService } from "./branch.service.js";

const execFile = promisify(execFileCb);

async function runGit(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", repo, ...args], { encoding: "utf8" });
  return stdout;
}

async function makeRepo(): Promise<{ dir: string; baseSha: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-autosquash-"));
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

describe("branchService.rebaseAutosquash", () => {
  let repo: string;
  let baseSha: string;

  beforeEach(async () => {
    ({ dir: repo, baseSha } = await makeRepo());
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it(
    "fixup commit 在 rebase --autosquash 后合并到原 commit",
    { timeout: 30_000 },
    async () => {
      // 原始 commit "feat: A"
      await fs.writeFile(path.join(repo, "a.txt"), "A1\n");
      await runGit(repo, "add", "a.txt");
      await runGit(repo, "commit", "-q", "-m", "feat: A");
      const featSha = (await runGit(repo, "rev-parse", "HEAD")).trim();

      // fixup commit
      await fs.writeFile(path.join(repo, "a.txt"), "A2\n");
      await runGit(repo, "commit", "-q", "-am", `fixup! ${featSha.substring(0, 7)}`);

      // 当前 commit 数（init / feat: A / fixup!） = 3
      const beforeCount = parseInt(
        (await runGit(repo, "rev-list", "--count", "HEAD")).trim(),
        10
      );
      expect(beforeCount).toBe(3);

      // autosquash from base
      const r = await branchService.rebaseAutosquash(repo, baseSha);
      if (!r.success) {
        console.error("[test] autosquash failed:", r.message);
      }
      expect(r.success).toBe(true);

      const afterCount = parseInt(
        (await runGit(repo, "rev-list", "--count", "HEAD")).trim(),
        10
      );
      expect(afterCount).toBe(2); // init / feat: A（合并了 fixup）

      // a.txt 应是 fixup 之后的内容
      const content = await fs.readFile(path.join(repo, "a.txt"), "utf8");
      expect(content).toBe("A2\n");
    }
  );

  it("无 fixup 时 autosquash → 等价空 rebase，commit 数不变", { timeout: 30_000 }, async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "A\n");
    await runGit(repo, "add", "a.txt");
    await runGit(repo, "commit", "-q", "-m", "feat: A");

    const beforeCount = parseInt(
      (await runGit(repo, "rev-list", "--count", "HEAD")).trim(),
      10
    );

    const r = await branchService.rebaseAutosquash(repo, baseSha);
    expect(r.success).toBe(true);

    const afterCount = parseInt(
      (await runGit(repo, "rev-list", "--count", "HEAD")).trim(),
      10
    );
    expect(afterCount).toBe(beforeCount);
  });
});
