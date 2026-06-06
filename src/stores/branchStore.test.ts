import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { BranchInfo, BranchesResult } from "@/utils/commands";

// 必须在 import store 之前 mock commands（store 顶部 import 会触发 web/electron adapter 选择）
vi.mock("@/utils/commands", () => {
  return {
    commands: {
      getBranches: vi.fn(),
    },
  };
});

// 切仓库 watch 不依赖 refreshGit；mock 掉以避免引入 useGitRefresh → commitStore/logStore 加载链
vi.mock("@/composables/useGitRefresh", () => {
  return {
    refreshGit: vi.fn(),
  };
});

import { commands } from "@/utils/commands";
import { useBranchStore } from "./branchStore";
import { useRepoStore } from "./repoStore";

function makeBranch(name: string, isHead = false): BranchInfo {
  return {
    name,
    isHead,
    upstream: null,
    aheadBehind: null,
    lastCommitId: `${name}-id`,
    lastCommitSummary: `${name} summary`,
    lastCommitTime: 0,
  };
}

function makeBranches(prefix: string): BranchesResult {
  return {
    local: [makeBranch(`${prefix}-main`, true), makeBranch(`${prefix}-dev`)],
    remote: [makeBranch(`origin/${prefix}-main`)],
    tags: [`${prefix}-v1`],
  };
}

describe("branchStore — 多仓库切换时不残留旧仓库分支", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("切到无缓存的新仓库时，应立即清空上一个仓库的分支/标签（消除闪烁）", async () => {
    const repoStore = useRepoStore();
    const branchStore = useBranchStore();

    repoStore.repos = [
      { path: "/repos/A", name: "A", currentBranch: "main", color: "#000" },
      { path: "/repos/B", name: "B", currentBranch: "main", color: "#111" },
    ];
    repoStore.activeRepoIndex = 0;

    // 模拟 A 仓库已展示分支
    const aBranches = makeBranches("A");
    branchStore.localBranches = aBranches.local;
    branchStore.remoteBranches = aBranches.remote;
    branchStore.tags = aBranches.tags;

    // 切到 B（B 从未访问，无缓存）
    repoStore.activeRepoIndex = 1;
    await Promise.resolve();
    await Promise.resolve();

    // 关键：切换瞬间不应再残留 A 的分支（旧实现会保留直到 getBranches 返回）
    expect(branchStore.localBranches).toEqual([]);
    expect(branchStore.remoteBranches).toEqual([]);
    expect(branchStore.tags).toEqual([]);
  });

  it("切回已访问过（有缓存）的仓库时，应立即回填该仓库缓存，而非空白或旧仓库数据", async () => {
    const repoStore = useRepoStore();
    const branchStore = useBranchStore();

    const aBranches = makeBranches("A");
    const bBranches = makeBranches("B");
    const mockedGetBranches = vi.mocked(commands.getBranches);

    repoStore.repos = [
      { path: "/repos/A", name: "A", currentBranch: "main", color: "#000" },
      { path: "/repos/B", name: "B", currentBranch: "main", color: "#111" },
    ];
    repoStore.activeRepoIndex = 0;

    // 加载 A → 写入缓存
    mockedGetBranches.mockResolvedValueOnce(aBranches);
    await branchStore.loadBranches();
    expect(branchStore.localBranches).toEqual(aBranches.local);

    // 切到 B 并加载 B → 写入缓存
    repoStore.activeRepoIndex = 1;
    await Promise.resolve();
    mockedGetBranches.mockResolvedValueOnce(bBranches);
    await branchStore.loadBranches();
    expect(branchStore.localBranches).toEqual(bBranches.local);

    // 切回 A：watch 应立即用 A 的缓存回填（无需等待异步 loadBranches）
    repoStore.activeRepoIndex = 0;
    await Promise.resolve();
    await Promise.resolve();

    expect(branchStore.localBranches).toEqual(aBranches.local);
    expect(branchStore.tags).toEqual(aBranches.tags);
    // 关键：回填的是 A 的缓存，不是 B 的数据
    expect(branchStore.localBranches.some((b) => b.name.startsWith("B-"))).toBe(false);
  });
});
