import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { MergeResult, RebaseStatus } from "@/utils/commands";

// 必须在 import store 之前 mock commands（store 顶部 import 会触发 web/electron adapter 选择）
vi.mock("@/utils/commands", () => {
  return {
    commands: {
      getRebaseStatus: vi.fn(),
      continueOperation: vi.fn(),
      abortOperation: vi.fn(),
    },
  };
});

// rebaseStore setup 会初始化 branchStore（它 import refreshGit）；mock 掉以避免加载链
vi.mock("@/composables/useGitRefresh", () => {
  return {
    refreshGit: vi.fn(),
  };
});

import { commands } from "@/utils/commands";
import { useRebaseStore } from "./rebaseStore";
import { useRepoStore } from "./repoStore";

function makeStatus(inProgress: boolean, currentCommitId: string | null): RebaseStatus {
  return {
    inProgress,
    total: inProgress ? 3 : 0,
    done: inProgress ? 1 : 0,
    currentCommitId,
    currentAction: inProgress ? "pick" : null,
    conflictFiles: [],
  };
}

describe("rebaseStore — 切仓库时 refreshStatus 不残留旧仓库 rebase 状态", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("refreshStatus 进行中切到新仓库后，旧仓库晚到的 rebase 状态不得覆盖当前仓库", async () => {
    const repoStore = useRepoStore();
    const rebaseStore = useRebaseStore();
    const mockedGetRebaseStatus = vi.mocked(commands.getRebaseStatus);

    repoStore.repos = [
      { path: "/repos/A", name: "A", currentBranch: "main", color: "#000" },
      { path: "/repos/B", name: "B", currentBranch: "main", color: "#111" },
    ];
    repoStore.activeRepoIndex = 0;

    const statusA = makeStatus(true, "A-commit");
    const statusB = makeStatus(false, null);

    // A 的 getRebaseStatus 挂起（模拟 2s 轮询时的 in-flight 请求），B 立即返回
    let resolveA!: (v: RebaseStatus) => void;
    const aPending = new Promise<RebaseStatus>((r) => {
      resolveA = r;
    });
    mockedGetRebaseStatus.mockImplementation((path: string) =>
      path === "/repos/A" ? aPending : Promise.resolve(statusB)
    );

    // 在 A 上发起 refreshStatus（A 挂起，先不等）
    const aRefresh = rebaseStore.refreshStatus();

    // 切到 B：触发切仓库 watch（close + 重置 status + 拉 B 的状态）
    repoStore.activeRepoIndex = 1;
    await Promise.resolve();
    await rebaseStore.refreshStatus();
    expect(rebaseStore.status.inProgress).toBe(false);

    // A 的旧请求姗姗来迟返回
    resolveA(statusA);
    await aRefresh;

    // 关键：A 的 rebase 进度（inProgress=true）不能覆盖当前 B 的状态栏
    expect(rebaseStore.status.inProgress).toBe(false);
    expect(rebaseStore.status.currentCommitId).toBeNull();
  });
});

describe("rebaseStore — Continue/Abort 执行反馈与防重复点击", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("continueRebase 期间 actionPending=true，结束复位；pending 期间重复点击被忽略", async () => {
    const repoStore = useRepoStore();
    const rebaseStore = useRebaseStore();
    repoStore.repos = [{ path: "/repos/A", name: "A", currentBranch: "main", color: "#000" }];
    repoStore.activeRepoIndex = 0;

    vi.mocked(commands.getRebaseStatus).mockResolvedValue(makeStatus(false, null));

    // 模拟后端 continue 卡在串行队列里（迟迟不返回），用于观察 pending 态
    let resolveOp!: (v: MergeResult) => void;
    vi.mocked(commands.continueOperation).mockImplementation(
      () => new Promise<MergeResult>((r) => (resolveOp = r))
    );

    expect(rebaseStore.actionPending).toBe(false);

    const first = rebaseStore.continueRebase();
    expect(rebaseStore.actionPending).toBe(true);

    // pending 期间再次点击：不应再发起第二条 --continue（防止压入多条命令）
    await rebaseStore.continueRebase();
    expect(vi.mocked(commands.continueOperation)).toHaveBeenCalledTimes(1);

    resolveOp({ success: true, conflicts: [], message: "ok" });
    await first;
    expect(rebaseStore.actionPending).toBe(false);
  });

  it("abortRebase 失败时 actionPending 也会复位（finally 保障）", async () => {
    const repoStore = useRepoStore();
    const rebaseStore = useRebaseStore();
    repoStore.repos = [{ path: "/repos/A", name: "A", currentBranch: "main", color: "#000" }];
    repoStore.activeRepoIndex = 0;

    vi.mocked(commands.getRebaseStatus).mockResolvedValue(makeStatus(false, null));
    vi.mocked(commands.abortOperation).mockRejectedValue(new Error("boom"));

    await rebaseStore.abortRebase();
    expect(rebaseStore.actionPending).toBe(false);
  });
});
