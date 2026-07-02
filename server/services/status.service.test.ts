/**
 * server/services/status.service · 单测
 *
 * 覆盖：
 *   - getStatus：staged / unstaged / untracked 三组归类正确
 *   - stageFilesBatch：1 次调用完成 N 个文件 add（对比 N 次 stageFile）
 *   - unstageFilesBatch：reset HEAD -- pathspec
 *   - getWorkingFileContent / deleteFile：异步 fs 路径
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { statusService } from "./status.service.js";

const execFile = promisify(execFileCb);

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-status-svc-"));
  await execFile("git", ["-C", dir, "init", "-q"], { encoding: "utf8" });
  await execFile("git", ["-C", dir, "config", "user.email", "t@test"], { encoding: "utf8" });
  await execFile("git", ["-C", dir, "config", "user.name", "t"], { encoding: "utf8" });
  await fs.writeFile(path.join(dir, "README.md"), "# init\n", "utf8");
  await execFile("git", ["-C", dir, "add", "README.md"], { encoding: "utf8" });
  await execFile("git", ["-C", dir, "commit", "-q", "-m", "init"], { encoding: "utf8" });
  return dir;
}

describe("statusService.getStatus · 状态归类", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("纯净仓库 → 三组都空", async () => {
    const s = await statusService.getStatus(repo);
    expect(s.staged).toEqual([]);
    expect(s.unstaged).toEqual([]);
    expect(s.untracked).toEqual([]);
  });

  it("新建未跟踪文件 → 进 untracked", async () => {
    await fs.writeFile(path.join(repo, "new.txt"), "x");
    const s = await statusService.getStatus(repo);
    expect(s.untracked).toHaveLength(1);
    expect(s.untracked[0]!.path).toBe("new.txt");
    expect(s.untracked[0]!.status).toBe("untracked");
  });

  it("修改已跟踪文件未 add → 进 unstaged modified", async () => {
    await fs.writeFile(path.join(repo, "README.md"), "# changed\n");
    const s = await statusService.getStatus(repo);
    expect(s.unstaged).toHaveLength(1);
    expect(s.unstaged[0]!.status).toBe("modified");
    expect(s.unstaged[0]!.staged).toBe(false);
  });

  it("修改已跟踪文件 + git add → 进 staged modified", async () => {
    await fs.writeFile(path.join(repo, "README.md"), "# staged\n");
    await execFile("git", ["-C", repo, "add", "README.md"], { encoding: "utf8" });
    const s = await statusService.getStatus(repo);
    expect(s.staged).toHaveLength(1);
    expect(s.staged[0]!.status).toBe("modified");
    expect(s.staged[0]!.staged).toBe(true);
  });
});

describe("statusService.stageFilesBatch / unstageFilesBatch", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("空数组 → no-op，无报错", async () => {
    await expect(statusService.stageFilesBatch(repo, [])).resolves.toBeUndefined();
    await expect(statusService.unstageFilesBatch(repo, [])).resolves.toBeUndefined();
  });

  it("batch stage 3 个文件 → 一次 git add，全部进 staged", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "a");
    await fs.writeFile(path.join(repo, "b.txt"), "b");
    await fs.writeFile(path.join(repo, "c.txt"), "c");

    await statusService.stageFilesBatch(repo, ["a.txt", "b.txt", "c.txt"]);

    const s = await statusService.getStatus(repo);
    expect(s.staged).toHaveLength(3);
    expect(s.untracked).toHaveLength(0);
    expect(new Set(s.staged.map((f) => f.path))).toEqual(new Set(["a.txt", "b.txt", "c.txt"]));
  });

  it("batch unstage → 全部回到 untracked / unstaged", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "a");
    await fs.writeFile(path.join(repo, "b.txt"), "b");
    await statusService.stageFilesBatch(repo, ["a.txt", "b.txt"]);

    await statusService.unstageFilesBatch(repo, ["a.txt", "b.txt"]);

    const s = await statusService.getStatus(repo);
    expect(s.staged).toHaveLength(0);
    expect(s.untracked.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it(
    "大批量 stage + unstage：700 个长路径文件（回归 argv 长度溢出）",
    async () => {
      // 旧实现把全部路径摊进单条 `git add -- <...>`，700 个长路径命令行 > 60KB，
      // 远超 Windows CreateProcess 的 32767 上限必然失败；新实现走 --pathspec-from-file
      // 应一次成功完成 stage 与 unstage。
      const sub = "deep/nested/directory/path";
      await fs.mkdir(path.join(repo, sub), { recursive: true });
      const names = Array.from(
        { length: 700 },
        (_, i) =>
          `${sub}/segment-${String(i).padStart(4, "0")}-extra-long-file-name-to-exceed-argv-limit.txt`
      );
      await Promise.all(names.map((name, i) => fs.writeFile(path.join(repo, name), `content-${i}`)));

      await statusService.stageFilesBatch(repo, names);
      let s = await statusService.getStatus(repo);
      expect(s.staged).toHaveLength(700);
      expect(s.untracked).toHaveLength(0);

      await statusService.unstageFilesBatch(repo, names);
      s = await statusService.getStatus(repo);
      expect(s.staged).toHaveLength(0);
      expect(s.untracked).toHaveLength(700);
    },
    30000
  );
});

describe("statusService.getWorkingFileContent / deleteFile", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("getWorkingFileContent → 读取工作区文件内容", async () => {
    const content = await statusService.getWorkingFileContent(repo, "README.md");
    expect(content).toBe("# init\n");
  });

  it("getWorkingFileContent · path traversal 抛错", async () => {
    await expect(
      statusService.getWorkingFileContent(repo, "../../etc/passwd")
    ).rejects.toThrow(/path traversal/);
  });

  it("deleteFile → 文件被删除", async () => {
    const fp = path.join(repo, "to-delete.txt");
    await fs.writeFile(fp, "bye");
    await statusService.deleteFile(repo, "to-delete.txt");
    await expect(fs.access(fp)).rejects.toBeTruthy();
  });
});

describe("statusService.discardFilesBatch / deleteFilesBatch · 批量文件操作", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("空数组 → no-op，返回空结果", async () => {
    await expect(statusService.discardFilesBatch(repo, [])).resolves.toEqual({ ok: [], failed: [] });
    await expect(statusService.deleteFilesBatch(repo, [])).resolves.toEqual({ ok: [], failed: [] });
  });

  it("discardFilesBatch 一次回滚多个文件（staged + unstaged）到 HEAD", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "A0\n");
    await fs.writeFile(path.join(repo, "b.txt"), "B0\n");
    await execFile("git", ["-C", repo, "add", "a.txt", "b.txt"], { encoding: "utf8" });
    await execFile("git", ["-C", repo, "commit", "-q", "-m", "add ab"], { encoding: "utf8" });
    // a.txt 改完已暂存；b.txt 改完未暂存
    await fs.writeFile(path.join(repo, "a.txt"), "A-changed\n");
    await fs.writeFile(path.join(repo, "b.txt"), "B-changed\n");
    await execFile("git", ["-C", repo, "add", "a.txt"], { encoding: "utf8" });

    const result = await statusService.discardFilesBatch(repo, ["a.txt", "b.txt"]);

    expect([...result.ok].sort()).toEqual(["a.txt", "b.txt"]);
    expect(result.failed).toEqual([]);
    // trim 规避 Windows git autocrlf 把 \n 转成 \r\n 的平台差异
    expect((await fs.readFile(path.join(repo, "a.txt"), "utf8")).trim()).toBe("A0");
    expect((await fs.readFile(path.join(repo, "b.txt"), "utf8")).trim()).toBe("B0");
    const s = await statusService.getStatus(repo);
    expect(s.staged).toHaveLength(0);
    expect(s.unstaged).toHaveLength(0);
  });

  it("deleteFilesBatch 一次删除多个文件；不存在的文件(ENOENT)也计入成功", async () => {
    await fs.writeFile(path.join(repo, "x.txt"), "x");
    await fs.writeFile(path.join(repo, "y.txt"), "y");

    const result = await statusService.deleteFilesBatch(repo, ["x.txt", "y.txt", "ghost.txt"]);

    expect([...result.ok].sort()).toEqual(["ghost.txt", "x.txt", "y.txt"]);
    expect(result.failed).toEqual([]);
    await expect(fs.access(path.join(repo, "x.txt"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(repo, "y.txt"))).rejects.toBeTruthy();
  });
});
