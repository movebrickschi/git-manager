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
