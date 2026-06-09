import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { LogResult } from "@/utils/commands";

// 必须在 import store 之前 mock commands，因为 store 顶部 import 会触发 web/electron adapter 选择
vi.mock("@/utils/commands", () => {
  return {
    commands: {
      getLog: vi.fn(),
    },
  };
});

import { commands } from "@/utils/commands";
import { useLogStore } from "./logStore";
import { useRepoStore } from "./repoStore";

function makeLogResult(prefix: string, count: number): LogResult {
  return {
    commits: Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${i}`,
      shortId: `${prefix}-${i}`.slice(0, 7),
      message: `${prefix} commit ${i}`,
      summary: `${prefix} commit ${i}`,
      author: "A",
      authorEmail: "a@x.com",
      authorTime: 0,
      committer: "A",
      committerEmail: "a@x.com",
      commitTime: 0,
      parents: [],
      refs: [],
      isMerge: false,
    })),
    graphRows: Array.from({ length: count }, (_, i) => ({
      commitId: `${prefix}-${i}`,
      column: 0,
      color: 0,
      edges: [],
    })),
  };
}

describe("logStore.loadCommits — race condition vs repo switching", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("当 activeRepo 切换时，旧仓库未完成的 getLog 结果不应写入新仓库的 commits", async () => {
    const repoStore = useRepoStore();
    const logStore = useLogStore();

    // 准备：两个仓库的 getLog 结果
    const repoAResult = makeLogResult("RA", 3);
    const repoBResult = makeLogResult("RB", 2);

    // 第一次调用（RA）人为 hang 住，第二次调用（RB）立即 resolve
    let resolveRepoA!: (v: LogResult) => void;
    const repoAPromise = new Promise<LogResult>((resolve) => {
      resolveRepoA = resolve;
    });

    const mockedGetLog = vi.mocked(commands.getLog);
    mockedGetLog.mockImplementationOnce(() => repoAPromise);
    mockedGetLog.mockImplementationOnce(() => Promise.resolve(repoBResult));

    // 步骤 1: 打开仓库 A
    repoStore.repos = [
      { path: "/repos/A", name: "A", currentBranch: "main", color: "#000" },
      { path: "/repos/B", name: "B", currentBranch: "main", color: "#111" },
    ];
    repoStore.activeRepoIndex = 0;

    // 步骤 2: 主动触发首次 loadCommits（模拟挂载阶段）
    const firstLoad = logStore.loadCommits(true);

    // 步骤 3: 在 RA 请求未返回前切到 B —— logStore 内 watch 自动 cancelFetchLog 并清掉旧仓库 commits
    repoStore.activeRepoIndex = 1;

    // 等 Vue watch 异步派发完（不能在 watch 之前手动 loadCommits，否则新 controller 会被
    // watch 内 cancelFetchLog 抹掉）
    await Promise.resolve();
    await Promise.resolve();

    // 步骤 4: GitLogView 在切换后通过 ensureLoaded() 触发新仓库加载（这里手动触发等价行为）
    await logStore.loadCommits(true);

    // 步骤 5: RA 的请求 *现在* 才返回（模拟慢请求），useAbortable 会让它抛 AbortError 被安静吞掉
    resolveRepoA(repoAResult);
    await firstLoad;

    // 断言：commits 应该只含 RB 的结果，不应被 RA 污染
    expect(logStore.commits.map((c) => c.id)).toEqual(["RB-0", "RB-1"]);
    expect(logStore.commits.find((c) => c.id.startsWith("RA-"))).toBeUndefined();
  });

  it("cancelFetchLog() 暴露在 store 上，可手动调用且幂等", () => {
    const logStore = useLogStore();
    expect(typeof logStore.cancelFetchLog).toBe("function");
    expect(() => logStore.cancelFetchLog()).not.toThrow();
    expect(() => logStore.cancelFetchLog()).not.toThrow();
  });

  it("切回已访问仓库时立即回填缓存的日志（SWR：不空白），再后台刷新替换", async () => {
    const repoStore = useRepoStore();
    const logStore = useLogStore();

    const repoAResult = makeLogResult("RA", 3);
    const repoBResult = makeLogResult("RB", 2);
    const repoARefreshed = makeLogResult("RA2", 4);

    const mockedGetLog = vi.mocked(commands.getLog);

    repoStore.repos = [
      { path: "/repos/A", name: "A", currentBranch: "main", color: "#000" },
      { path: "/repos/B", name: "B", currentBranch: "main", color: "#111" },
    ];
    repoStore.activeRepoIndex = 0;
    // 等初始 watch（null→A）派发完，避免它的 cancelFetchLog 打断下面的首次加载
    await Promise.resolve();
    await Promise.resolve();

    // 仓库 A 首次加载 → 写入结果缓存
    mockedGetLog.mockResolvedValueOnce(repoAResult);
    await logStore.loadCommits(true);
    expect(logStore.commits.map((c) => c.id)).toEqual(["RA-0", "RA-1", "RA-2"]);

    // 切到 B 并加载
    mockedGetLog.mockResolvedValueOnce(repoBResult);
    repoStore.activeRepoIndex = 1;
    await Promise.resolve();
    await Promise.resolve();
    await logStore.loadCommits(true);
    expect(logStore.commits.map((c) => c.id)).toEqual(["RB-0", "RB-1"]);

    // 切回 A：watch 同步回填缓存 → commits 立即为 RA（无需等待 getLog 返回）
    repoStore.activeRepoIndex = 0;
    await Promise.resolve();
    await Promise.resolve();
    expect(logStore.commits.map((c) => c.id)).toEqual(["RA-0", "RA-1", "RA-2"]);

    // 后台刷新（ensureLoaded → loadCommits）拿到新数据后整体替换
    mockedGetLog.mockResolvedValueOnce(repoARefreshed);
    logStore.ensureLoaded();
    await new Promise((r) => setTimeout(r, 0));
    expect(logStore.commits.map((c) => c.id)).toEqual(["RA2-0", "RA2-1", "RA2-2", "RA2-3"]);
  });
});
