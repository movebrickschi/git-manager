import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures the spy exists before vi.mock factory is hoisted to top.
// 每次调用返回一个全新对象，便于断言「同仓库复用同一实例 / 不同仓库不同实例」。
const { simpleGitSpy } = vi.hoisted(() => ({
  simpleGitSpy: vi.fn((_options?: unknown) => ({})),
}));

vi.mock("simple-git", () => ({
  simpleGit: simpleGitSpy,
}));

import {
  getGit,
  getRemoteGit,
  disposeGitInstances,
  GIT_TIMEOUT_MS,
  REMOTE_GIT_TIMEOUT_MS,
} from "./_helpers.js";

type GitOpts = {
  baseDir?: string;
  binary?: string;
  maxConcurrentProcesses?: number;
  timeout?: { block?: number };
};

function lastOpts(): GitOpts {
  const calls = simpleGitSpy.mock.calls;
  return calls[calls.length - 1]![0] as GitOpts;
}

// 背景：原先 getGit / getRemoteGit 每次 new 一个独立实例，且 maxConcurrentProcesses:6，
// 而 simple-git 的串行队列只在单实例内生效 —— 于是同仓库的本地命令（status 轮询 /
// watcher 触发的 status）与联网命令（pull / fetch）分属不同实例、各自队列、毫无互斥，
// 并发争抢 .git/index.lock 与 refs/**/*.lock，表现为「git 索引被锁定」。
// 以下用例锁定修复后的新契约：同仓库共享同一个串行实例。
describe("git instance cache + serialized queue (lock-race fix)", () => {
  beforeEach(() => {
    simpleGitSpy.mockClear();
    disposeGitInstances();
  });

  it("同一仓库的本地与联网命令共用同一个实例（互斥的前提）", () => {
    const local = getGit("/repo");
    const networked = getRemoteGit("/repo");
    expect(local).toBe(networked);
    // 命中缓存：整个仓库只创建一次底层 simple-git 实例
    expect(simpleGitSpy).toHaveBeenCalledTimes(1);
  });

  it("实例强制串行 maxConcurrentProcesses === 1（消除应用自身并发争锁）", () => {
    getGit("/repo");
    expect(lastOpts().maxConcurrentProcesses).toBe(1);
  });

  // Regression guard：push 对话框会先 fetch（联网）再 push。最初的 bug 是本地工厂的
  // block:30s 在认证等待 / SSH-TLS 握手 / 慢网 / 远端 counting objects 期间误杀进程，
  // 抛 simple-git "block timeout reached"。共享实例统一用联网级超时，必须远大于 30s。
  it("联网级 block 超时必须远大于 30s（认证 / 握手期间不被误杀）", () => {
    getRemoteGit("/repo");
    expect(lastOpts().timeout?.block).toBe(REMOTE_GIT_TIMEOUT_MS);
    expect(REMOTE_GIT_TIMEOUT_MS).toBeGreaterThan(GIT_TIMEOUT_MS);
    expect(REMOTE_GIT_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
  });

  it("保留 baseDir / binary 配置", () => {
    getRemoteGit("/some/repo");
    const opts = lastOpts();
    expect(opts.baseDir).toBe("/some/repo");
    expect(opts.binary).toBe("git");
  });

  it("不同仓库使用不同实例（跨仓库仍可并行，互不阻塞）", () => {
    const a = getGit("/repo-a");
    const b = getGit("/repo-b");
    expect(a).not.toBe(b);
    expect(simpleGitSpy).toHaveBeenCalledTimes(2);
  });

  it("disposeGitInstances 释放缓存后会重新创建实例", () => {
    const first = getGit("/repo");
    disposeGitInstances("/repo");
    const second = getGit("/repo");
    expect(first).not.toBe(second);
    expect(simpleGitSpy).toHaveBeenCalledTimes(2);
  });
});
