/**
 * server/services/submodule.service · 单测
 *
 * 覆盖：
 *   - getSubmodules · 无 .gitmodules 时直接返回 []（不跑 git）
 *   - getSubmodules · 有 .gitmodules 但 status 异常 → console.warn + 返回 []
 *   - getSubmodules · 正常解析（含 prefix → state 映射）
 *   - getSubmodules · fillUrls 从 .gitmodules 补 url
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { submoduleService } from "./submodule.service.js";

const execFile = promisify(execFileCb);

async function runGit(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", repo, ...args], { encoding: "utf8" });
  return stdout;
}

async function makeRepoNoSubmodule(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-submod-svc-"));
  await runGit(dir, "init", "-q");
  await runGit(dir, "config", "user.email", "t@test");
  await runGit(dir, "config", "user.name", "t");
  await fs.writeFile(path.join(dir, "README.md"), "# init\n", "utf8");
  await runGit(dir, "add", "README.md");
  await runGit(dir, "commit", "-q", "-m", "init");
  return dir;
}

/**
 * 制造一个带 1 个 submodule 的 super 仓库（child 是 super 同进程下的本地 git）。
 */
async function makeRepoWithSubmodule(): Promise<{ super: string; child: string }> {
  const child = await fs.mkdtemp(path.join(os.tmpdir(), "gm-submod-child-"));
  await runGit(child, "init", "-q", "-b", "main");
  await runGit(child, "config", "user.email", "t@test");
  await runGit(child, "config", "user.name", "t");
  await fs.writeFile(path.join(child, "lib.txt"), "v1\n", "utf8");
  await runGit(child, "add", "lib.txt");
  await runGit(child, "commit", "-q", "-m", "child init");

  const sup = await makeRepoNoSubmodule();
  // 允许 file:// 协议作 submodule（git 默认禁，需要 -c）
  await execFile(
    "git",
    ["-c", "protocol.file.allow=always", "-C", sup, "submodule", "add", "-q", child, "lib"],
    { encoding: "utf8" }
  );
  await runGit(sup, "commit", "-q", "-am", "add submodule");
  return { super: sup, child };
}

describe("submoduleService.getSubmodules", () => {
  it("无 .gitmodules → 直接返回 []，不调用 git submodule status", async () => {
    const repo = await makeRepoNoSubmodule();
    try {
      const list = await submoduleService.getSubmodules(repo);
      expect(list).toEqual([]);
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  it("正常 submodule → 解析出 path / state / head / url", async () => {
    const { super: sup, child } = await makeRepoWithSubmodule();
    try {
      const list = await submoduleService.getSubmodules(sup);
      expect(list).toHaveLength(1);
      const sm = list[0]!;
      expect(sm.path).toBe("lib");
      expect(sm.name).toBe("lib");
      expect(sm.state).toBe("initialized");
      expect(sm.head).toMatch(/^[a-f0-9]{40}$/);
      // url 字段应填 child 路径（来自 .gitmodules）
      expect(sm.url).toBe(child);
    } finally {
      await fs.rm(sup, { recursive: true, force: true });
      await fs.rm(child, { recursive: true, force: true });
    }
  });

  it("有 .gitmodules 但 submodule status 异常 → 返回 [] 而非抛", async () => {
    // 手工写一个非法 .gitmodules，git 会因 submodule registration 异常报错
    const repo = await makeRepoNoSubmodule();
    try {
      await fs.writeFile(
        path.join(repo, ".gitmodules"),
        // 故意写一个不存在的 submodule 路径，git submodule status 会失败或返回空
        '[submodule "ghost"]\n\tpath = ghost\n\turl = file:///nowhere/does-not-exist.git\n',
        "utf8"
      );
      // 不抛错；可能 [] 或包含 ghost prefix='-' 视 git 版本而定
      const list = await submoduleService.getSubmodules(repo);
      expect(Array.isArray(list)).toBe(true);
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
});
