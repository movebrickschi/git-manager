/**
 * stashService.stashRemoveFile - remove a single file from a stash - integration test
 *
 * Real temp git repos (same setup as branch-smart-checkout.test). Covers:
 *   - remove one modified file from a multi-file stash: others kept, removed change discarded
 *   - remove a staged-added file from a stash
 *   - remove the last file in a stash -> whole stash dropped
 *   - remove a file from a non-top stash -> other stashes intact (reflog chain valid)
 *   - message and timestamp preserved after removal
 *   - stash with untracked(^3): removing the last tracked file keeps it (untracked remains)
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stashService } from "./stash.service.js";

const execFile = promisify(execFileCb);

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", repo, ...args], { encoding: "utf8" });
  return stdout;
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-stash-rm-"));
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@test");
  await git(dir, "config", "user.name", "t");
  await git(dir, "config", "core.autocrlf", "false");
  await fs.writeFile(path.join(dir, "a.txt"), "a-base\n", "utf8");
  await fs.writeFile(path.join(dir, "b.txt"), "b-base\n", "utf8");
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "init");
  await git(dir, "branch", "-M", "main");
  return dir;
}

function read(repo: string, file: string): Promise<string> {
  return fs.readFile(path.join(repo, file), "utf8");
}

describe("stashService.stashRemoveFile", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("remove one modified file from multi-file stash: keep rest, discard removed change", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "a-changed\n", "utf8");
    await fs.writeFile(path.join(repo, "b.txt"), "b-changed\n", "utf8");
    await git(repo, "stash", "push", "-m", "wip");

    let files = await stashService.getStashFiles(repo, 0);
    expect(files.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);

    await stashService.stashRemoveFile(repo, 0, "b.txt");

    files = await stashService.getStashFiles(repo, 0);
    expect(files.map((f) => f.path)).toEqual(["a.txt"]);

    await git(repo, "stash", "apply");
    expect(await read(repo, "a.txt")).toBe("a-changed\n");
    expect(await read(repo, "b.txt")).toBe("b-base\n");
  });

  it("remove a staged-added new file from a stash", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "a-changed\n", "utf8");
    await fs.writeFile(path.join(repo, "c.txt"), "c-new\n", "utf8");
    await git(repo, "add", "c.txt");
    await git(repo, "stash", "push", "-m", "wip-add");

    let files = await stashService.getStashFiles(repo, 0);
    expect(files.map((f) => f.path).sort()).toEqual(["a.txt", "c.txt"]);

    await stashService.stashRemoveFile(repo, 0, "c.txt");

    files = await stashService.getStashFiles(repo, 0);
    expect(files.map((f) => f.path)).toEqual(["a.txt"]);

    await git(repo, "stash", "apply");
    expect(await read(repo, "a.txt")).toBe("a-changed\n");
    await expect(read(repo, "c.txt")).rejects.toThrow();
  });

  it("remove the last file in a stash -> whole stash is dropped", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "a-only\n", "utf8");
    await git(repo, "stash", "push", "-m", "single");

    expect((await stashService.getStashList(repo)).length).toBe(1);

    await stashService.stashRemoveFile(repo, 0, "a.txt");

    expect((await stashService.getStashList(repo)).length).toBe(0);
  });

  it("remove a file from a non-top stash: other stashes intact, reflog chain valid", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "a-s1\n", "utf8");
    await fs.writeFile(path.join(repo, "b.txt"), "b-s1\n", "utf8");
    await git(repo, "stash", "push", "-m", "s1");
    await fs.writeFile(path.join(repo, "a.txt"), "a-s0\n", "utf8");
    await git(repo, "stash", "push", "-m", "s0");

    await stashService.stashRemoveFile(repo, 1, "b.txt");

    expect((await stashService.getStashFiles(repo, 1)).map((f) => f.path)).toEqual(["a.txt"]);
    expect((await stashService.getStashFiles(repo, 0)).map((f) => f.path)).toEqual(["a.txt"]);

    const list = await stashService.getStashList(repo);
    expect(list.length).toBe(2);

    await git(repo, "stash", "apply", "stash@{1}");
    expect(await read(repo, "a.txt")).toBe("a-s1\n");
    expect(await read(repo, "b.txt")).toBe("b-base\n");
  });

  it("preserve message and timestamp after removal", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "a-changed\n", "utf8");
    await fs.writeFile(path.join(repo, "b.txt"), "b-changed\n", "utf8");
    await git(repo, "stash", "push", "-m", "keep-me");

    const before = (await stashService.getStashList(repo))[0]!;

    await stashService.stashRemoveFile(repo, 0, "b.txt");

    const after = (await stashService.getStashList(repo))[0]!;
    expect(after.message).toBe(before.message);
    expect(after.time).toBe(before.time);
  });

  it("stash with untracked: removing last tracked file keeps it (untracked remains)", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "a-changed\n", "utf8");
    await fs.writeFile(path.join(repo, "u.txt"), "u-untracked\n", "utf8");
    await git(repo, "stash", "push", "-u", "-m", "with-untracked");

    expect((await stashService.getStashFiles(repo, 0)).map((f) => f.path)).toEqual(["a.txt"]);

    await stashService.stashRemoveFile(repo, 0, "a.txt");

    expect((await stashService.getStashList(repo)).length).toBe(1);

    await git(repo, "stash", "apply");
    expect(await read(repo, "u.txt")).toBe("u-untracked\n");
    expect(await read(repo, "a.txt")).toBe("a-base\n");
  });
});

describe("stashService.stashFiles · 大批量（回归 argv 长度溢出）", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it(
    "700 个长路径文件一次搁置 → 仅 1 个 stash entry、工作区清理、文件全部入 stash",
    async () => {
      // 旧实现 `git stash push -- <...>` 把全部路径摊进 argv，700 个长路径必然超出
      // Windows 32767 上限；改走「add(pathspec-from-file) + stash push --staged」后
      // 单命令完成、只产生 1 个 entry、工作区清理干净。
      const sub = "deep/nested/directory/path";
      await fs.mkdir(path.join(repo, sub), { recursive: true });
      const names = Array.from(
        { length: 700 },
        (_, i) =>
          `${sub}/segment-${String(i).padStart(4, "0")}-extra-long-file-name-to-exceed-argv-limit.txt`
      );
      await Promise.all(names.map((name, i) => fs.writeFile(path.join(repo, name), `content-${i}`)));

      await stashService.stashFiles(repo, names, "bulk wip");

      expect((await stashService.getStashList(repo)).length).toBe(1);
      expect((await stashService.getStashFiles(repo, 0)).length).toBe(700);
      // 这些文件已被搁置移出工作区 → status 干净
      expect((await git(repo, "status", "--porcelain", "-uall")).trim()).toBe("");
    },
    30000
  );

  it("保留未选中的已暂存文件：只搁置选中项，外部暂存文件暂存态不变", async () => {
    // a.txt 已暂存（外部、不在本次搁置选择里）
    await fs.writeFile(path.join(repo, "a.txt"), "a-staged\n", "utf8");
    await git(repo, "add", "a.txt");
    // u1/u2 未跟踪，是本次要搁置的目标
    await fs.writeFile(path.join(repo, "u1.txt"), "u1\n", "utf8");
    await fs.writeFile(path.join(repo, "u2.txt"), "u2\n", "utf8");

    await stashService.stashFiles(repo, ["u1.txt", "u2.txt"], "shelve untracked");

    // 只产生 1 个 entry，且只含 u1/u2
    expect((await stashService.getStashList(repo)).length).toBe(1);
    expect((await stashService.getStashFiles(repo, 0)).map((f) => f.path).sort()).toEqual([
      "u1.txt",
      "u2.txt",
    ]);
    // a.txt 仍处于已暂存状态（外部暂存文件被保留）
    expect((await git(repo, "diff", "--cached", "--name-only")).trim()).toBe("a.txt");
    // u1/u2 已移出工作区
    expect((await git(repo, "status", "--porcelain", "-uall")).split("\n").map((l) => l.trim())).not.toContain(
      "?? u1.txt"
    );
  });
});

describe("stashService.stashFiles · 二进制与编译产物", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  async function writeBinary(rel: string, bytes: number[]): Promise<void> {
    const abs = path.join(repo, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.from(bytes));
  }

  it("新增二进制 + 文本：stash 成功、工作区清空、两者都进同一条 stash", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "a-changed\n", "utf8");
    await writeBinary("blob.bin", [0x00, 0x01, 0x02, 0xff, 0x00, 0x99]);

    await stashService.stashFiles(repo, ["a.txt", "blob.bin"], "wip binary add");

    expect((await stashService.getStashList(repo)).length).toBe(1);
    expect((await stashService.getStashFiles(repo, 0)).map((f) => f.path).sort()).toEqual([
      "a.txt",
      "blob.bin",
    ]);
    expect((await git(repo, "status", "--porcelain", "-uall")).trim()).toBe("");
    expect(await read(repo, "a.txt")).toBe("a-base\n");
    await expect(fs.access(path.join(repo, "blob.bin"))).rejects.toThrow();
  });

  it("已跟踪二进制被改：stash 成功、工作区回到 HEAD", async () => {
    await writeBinary("blob.bin", [0x00, 0x11]);
    await git(repo, "add", "blob.bin");
    await git(repo, "commit", "-q", "-m", "add blob");
    await writeBinary("blob.bin", [0x00, 0x99]);
    await fs.writeFile(path.join(repo, "a.txt"), "a-changed\n", "utf8");

    await stashService.stashFiles(repo, ["a.txt", "blob.bin"], "wip binary edit");

    expect((await stashService.getStashList(repo)).length).toBe(1);
    expect((await stashService.getStashFiles(repo, 0)).map((f) => f.path).sort()).toEqual([
      "a.txt",
      "blob.bin",
    ]);
    expect((await git(repo, "status", "--porcelain", "-uall")).trim()).toBe("");
    expect(await read(repo, "a.txt")).toBe("a-base\n");
    expect([...(await fs.readFile(path.join(repo, "blob.bin")))]).toEqual([0x00, 0x11]);
  });

  it("__pycache__/*.pyc 自动跳过：只搁置文本，pyc 留在工作区且不进 stash", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "a-changed\n", "utf8");
    const pyc = "scripts/__pycache__/deploy_sit.cpython-312.pyc";
    await writeBinary(pyc, [0xcb, 0x0d, 0x0d, 0x0a, 0x00, 0xff]);

    await stashService.stashFiles(repo, ["a.txt", pyc], "skip pycache");

    expect((await stashService.getStashList(repo)).length).toBe(1);
    expect((await stashService.getStashFiles(repo, 0)).map((f) => f.path)).toEqual(["a.txt"]);
    expect(await read(repo, "a.txt")).toBe("a-base\n");
    expect(await fs.access(path.join(repo, pyc)).then(() => true)).toBe(true);
    const porcelain = await git(repo, "status", "--porcelain", "-uall");
    expect(porcelain).toContain(pyc.replace(/\\/g, "/"));
    expect(porcelain).not.toMatch(/a\.txt/);
  });

  it("只选编译产物 → 抛错且不产生 stash", async () => {
    const pyc = "pkg/__pycache__/x.cpython-312.pyc";
    await writeBinary(pyc, [0x00, 0x01]);

    await expect(stashService.stashFiles(repo, [pyc], "only junk")).rejects.toThrow(/编译产物/);
    expect((await stashService.getStashList(repo)).length).toBe(0);
    expect(await fs.access(path.join(repo, pyc)).then(() => true)).toBe(true);
  });

  it("含新增二进制时仍保留未选中的已暂存文件", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "a-staged\n", "utf8");
    await git(repo, "add", "a.txt");
    await writeBinary("blob.bin", [0x00, 0xfe]);

    await stashService.stashFiles(repo, ["blob.bin"], "bin only");

    expect((await stashService.getStashFiles(repo, 0)).map((f) => f.path)).toEqual(["blob.bin"]);
    expect((await git(repo, "diff", "--cached", "--name-only")).trim()).toBe("a.txt");
    await expect(fs.access(path.join(repo, "blob.bin"))).rejects.toThrow();
  });
});
