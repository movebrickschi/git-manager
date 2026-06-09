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
