/**
 * git-net —— 可取消联网 git 执行器的单元测试。
 *
 * 取消能力用 `process.execPath`（node）跑一个永不退出的进程来确定性验证，
 * 不依赖真实慢速网络；runNetworkGit 的 `git -C` 拼装用一个临时 git 仓库验证。
 */
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GitCancelledError,
  cancelNetworkGit,
  hasActiveNetworkGit,
  runNetworkGit,
  runTracked,
  stripProgressLines,
} from "./git-net.js";

const execFile = promisify(execFileCb);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("git-net runTracked / cancelNetworkGit", () => {
  it("resolves with stdout on success and cleans the registry", async () => {
    const repo = path.join(os.tmpdir(), "gm-net-ok");
    const out = await runTracked(repo, process.execPath, ["-e", "process.stdout.write('hello')"]);
    expect(out).toBe("hello");
    expect(hasActiveNetworkGit(repo)).toBe(false);
  });

  it("rejects with stderr on non-zero exit", async () => {
    const repo = path.join(os.tmpdir(), "gm-net-fail");
    await expect(
      runTracked(repo, process.execPath, [
        "-e",
        "process.stderr.write('boom'); process.exit(3)",
      ])
    ).rejects.toThrow(/boom/);
    expect(hasActiveNetworkGit(repo)).toBe(false);
  });

  it("cancelNetworkGit kills an in-flight process, rejects cancelled, and clears the registry", async () => {
    const repo = path.join(os.tmpdir(), "gm-net-cancel");
    const p = runTracked(repo, process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    // 进程登记是同步发生的；稍等确保 OS 已真正起进程再取消。
    await sleep(100);
    expect(hasActiveNetworkGit(repo)).toBe(true);

    const killed = cancelNetworkGit(repo);
    expect(killed).toBe(1);

    await expect(p).rejects.toBeInstanceOf(GitCancelledError);
    await expect(p).rejects.toMatchObject({ cancelled: true });
    expect(hasActiveNetworkGit(repo)).toBe(false);
  });

  it("cancelNetworkGit returns 0 when no op is active", () => {
    expect(cancelNetworkGit(path.join(os.tmpdir(), "gm-net-idle"))).toBe(0);
  });

  it("merges opts.extraEnv into the child process env (GIT_ASKPASS credential passthrough)", async () => {
    const repo = path.join(os.tmpdir(), "gm-net-env");
    const out = await runTracked(
      repo,
      process.execPath,
      ["-e", "process.stdout.write(process.env.GM_TEST_VAR || '')"],
      { extraEnv: { GM_TEST_VAR: "injected-123" } }
    );
    expect(out).toBe("injected-123");
    expect(hasActiveNetworkGit(repo)).toBe(false);
  });
});

describe("git-net stripProgressLines · --progress 进度行不污染错误消息", () => {
  it("剔除标准传输进度/统计行，保留真实错误行与 remote: hook 消息", () => {
    // \r 是 --progress 原位刷新的分隔符，管道里进度会连成一长串
    const stderr = [
      "remote: Enumerating objects: 1234, done.",
      "remote: Counting objects: 100% (1234/1234), done.",
      "remote: Compressing objects: 100% (567/567), done.",
      "remote: Total 1234 (delta 890), reused 1100 (delta 800), pack-reused 0",
      "Receiving objects:  42% (520/1234), 2.1 MiB | 1.0 MiB/s\rReceiving objects: 100% (1234/1234), done.",
      "Resolving deltas: 100% (890/890), done.",
      "remote: GitLab: You are not allowed to push code to this project.",
      "fatal: unable to access 'https://example.com/repo.git/': Could not resolve host",
    ].join("\n");

    const out = stripProgressLines(stderr);

    expect(out).not.toMatch(/Enumerating objects|Counting objects|Compressing objects/);
    expect(out).not.toMatch(/Receiving objects|Resolving deltas|remote: Total/);
    expect(out).toContain("remote: GitLab: You are not allowed to push code to this project.");
    expect(out).toContain("fatal: unable to access");
  });

  it("全是进度行时返回空串（runTracked 将回退到 exit code 兜底消息）", () => {
    const out = stripProgressLines(
      "Receiving objects:  10% (1/10)\rReceiving objects: 100% (10/10), done.\nResolving deltas: 100% (5/5), done."
    );
    expect(out).toBe("");
  });

  it("runTracked 失败时 reject 消息已剔除进度行", async () => {
    const repo = path.join(os.tmpdir(), "gm-net-progress");
    const script =
      "process.stderr.write('Receiving objects:  50% (5/10)\\rReceiving objects: 100% (10/10), done.\\n');" +
      "process.stderr.write('fatal: early EOF\\n');" +
      "process.exit(128)";
    const p = runTracked(repo, process.execPath, ["-e", script]);
    await expect(p).rejects.toThrow(/fatal: early EOF/);
    await expect(p).rejects.not.toThrow(/Receiving objects/);
  });
});

describe("git-net runNetworkGit", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "gm-net-repo-"));
    await execFile("git", ["-C", repo, "init", "-q"]);
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("runs `git -C <repo> ...` against the right repo", async () => {
    const out = await runNetworkGit(repo, ["rev-parse", "--is-inside-work-tree"]);
    expect(out.trim()).toBe("true");
    expect(hasActiveNetworkGit(repo)).toBe(false);
  });
});
