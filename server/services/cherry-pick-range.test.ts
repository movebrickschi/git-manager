/**
 * branchService.cherryPickRange · 单测
 *
 * 覆盖：
 *   - 空数组 → 直接 success no-op
 *   - 多 commit 批量 cherry-pick 到目标分支
 *   - 冲突时返回 success=false + conflicts 列表
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

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-cp-range-"));
  await runGit(dir, "init", "-q", "-b", "main");
  await runGit(dir, "config", "user.email", "t@test");
  await runGit(dir, "config", "user.name", "t");
  await fs.writeFile(path.join(dir, "README.md"), "v0\n", "utf8");
  await runGit(dir, "add", "README.md");
  await runGit(dir, "commit", "-q", "-m", "init");
  return dir;
}

describe("branchService.cherryPickRange", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("空数组 → success no-op", async () => {
    const r = await branchService.cherryPickRange(repo, []);
    expect(r.success).toBe(true);
    expect(r.conflicts).toEqual([]);
  });

  it(
    "在 feature 分支制造 2 个 commit → 切回 main → cherryPickRange 应用 → main HEAD 多 2 个 commit",
    { timeout: 30_000 },
    async () => {
      // feature 分支
      await runGit(repo, "checkout", "-q", "-b", "feature");
      await fs.writeFile(path.join(repo, "a.txt"), "A\n");
      await runGit(repo, "add", "a.txt");
      await runGit(repo, "commit", "-q", "-m", "add a");
      const shaA = (await runGit(repo, "rev-parse", "HEAD")).trim();
      await fs.writeFile(path.join(repo, "b.txt"), "B\n");
      await runGit(repo, "add", "b.txt");
      await runGit(repo, "commit", "-q", "-m", "add b");
      const shaB = (await runGit(repo, "rev-parse", "HEAD")).trim();

      // 切回 main
      await runGit(repo, "checkout", "-q", "main");
      const beforeCount = parseInt(
        (await runGit(repo, "rev-list", "--count", "HEAD")).trim(),
        10
      );

      // 顺序：旧→新 = shaA → shaB
      const r = await branchService.cherryPickRange(repo, [shaA, shaB]);
      expect(r.success).toBe(true);

      const afterCount = parseInt(
        (await runGit(repo, "rev-list", "--count", "HEAD")).trim(),
        10
      );
      expect(afterCount).toBe(beforeCount + 2);
      // 文件应该都存在了
      await expect(fs.access(path.join(repo, "a.txt"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(repo, "b.txt"))).resolves.toBeUndefined();
    }
  );

  it(
    "故意制造同行冲突 → success=false + conflicts 列出",
    { timeout: 30_000 },
    async () => {
      await runGit(repo, "checkout", "-q", "-b", "feature");
      await fs.writeFile(path.join(repo, "README.md"), "v-feature\n");
      await runGit(repo, "commit", "-q", "-am", "feature edit");
      const shaF = (await runGit(repo, "rev-parse", "HEAD")).trim();

      await runGit(repo, "checkout", "-q", "main");
      await fs.writeFile(path.join(repo, "README.md"), "v-main\n");
      await runGit(repo, "commit", "-q", "-am", "main edit");

      const r = await branchService.cherryPickRange(repo, [shaF]);
      expect(r.success).toBe(false);
      expect(r.conflicts).toContain("README.md");
      // 清理冲突，避免后续 afterEach rm 之前 git 状态机异常
      await runGit(repo, "cherry-pick", "--abort").catch(() => {});
    }
  );
});
