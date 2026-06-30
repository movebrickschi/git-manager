import { describe, it, expect, beforeEach } from "vitest";

import {
  beginNetwork,
  endNetwork,
  isNetworkBusy,
  isRepoNetworkBusy,
  networkBusyRepos,
  runNetworkBusy,
} from "./network-busy";

// 模块级状态跨用例保留，每个用例前排空残留，保证隔离。
function drain(): void {
  for (const repo of [...networkBusyRepos.value]) {
    while (networkBusyRepos.value.includes(repo)) endNetwork(repo);
  }
}

describe("network-busy", () => {
  beforeEach(drain);

  it("begin/end 切换全局 busy 与仓库列表", () => {
    expect(isNetworkBusy.value).toBe(false);
    beginNetwork("/a");
    expect(isNetworkBusy.value).toBe(true);
    expect(networkBusyRepos.value).toEqual(["/a"]);
    endNetwork("/a");
    expect(isNetworkBusy.value).toBe(false);
    expect(networkBusyRepos.value).toEqual([]);
  });

  it("同仓库嵌套计数：全部结束才解除 busy", () => {
    beginNetwork("/a");
    beginNetwork("/a");
    endNetwork("/a");
    expect(isNetworkBusy.value).toBe(true);
    endNetwork("/a");
    expect(isNetworkBusy.value).toBe(false);
  });

  it("runNetworkBusy 在 resolve 与 reject 后都复位", async () => {
    await runNetworkBusy("/a", async () => "ok");
    expect(isNetworkBusy.value).toBe(false);
    await expect(
      runNetworkBusy("/a", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(isNetworkBusy.value).toBe(false);
  });

  it("多仓库并行各自计数", () => {
    beginNetwork("/a");
    beginNetwork("/b");
    expect(new Set(networkBusyRepos.value)).toEqual(new Set(["/a", "/b"]));
    endNetwork("/a");
    expect(networkBusyRepos.value).toEqual(["/b"]);
    endNetwork("/b");
    expect(isNetworkBusy.value).toBe(false);
  });

  it("空 repoPath 不计数", () => {
    beginNetwork("");
    expect(isNetworkBusy.value).toBe(false);
  });

  it("isRepoNetworkBusy 只反映指定仓库且仓库间互不影响", () => {
    expect(isRepoNetworkBusy("/a")).toBe(false);
    beginNetwork("/a");
    expect(isRepoNetworkBusy("/a")).toBe(true);
    expect(isRepoNetworkBusy("/b")).toBe(false);
    endNetwork("/a");
    expect(isRepoNetworkBusy("/a")).toBe(false);
  });

  it("isRepoNetworkBusy 对空/缺省入参返回 false", () => {
    expect(isRepoNetworkBusy("")).toBe(false);
    expect(isRepoNetworkBusy(null)).toBe(false);
    expect(isRepoNetworkBusy(undefined)).toBe(false);
  });
});
