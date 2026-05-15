/**
 * Interactive Rebase 状态机（前端）。
 *
 * 职责：
 *   1. 弹出 Sequencer 对话框 → 收集用户编排的 todos → 调后端 startInteractiveRebase
 *   2. 对话框关闭后：根据后端结果决定提示 / 跳冲突 tab / 显示 rebase 进度栏
 *   3. 进度栏轮询 getRebaseStatus，提供 Continue / Abort
 *
 * 复用：
 *   - branchStore.requestTabSwitch / showToast：在出冲突 / 暂停时同步通知用户
 *   - commands.continueOperation('rebase') / abortOperation('rebase')：操作半成态
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useRepoStore } from "./repoStore";
import { useBranchStore } from "./branchStore";
import { commands } from "@/utils/commands";
import type {
  CommitInfo,
  RebaseTodoEntry,
  RebaseStatus,
} from "@/utils/commands";

export interface SequencerDialogState {
  visible: boolean;
  /** 用户右键选中的"基"commit 的 id；rebase 区间是 (baseRef..HEAD] */
  baseRef: string;
  /** baseRef 的短描述，用于 dialog header */
  baseLabel: string;
  /** UI 当前可编辑的 todo 列表 */
  todos: RebaseTodoEntry[];
  loadingPreview: boolean;
  pending: boolean;
  errorMessage: string;
}

export const useRebaseStore = defineStore("rebase", () => {
  const repoStore = useRepoStore();
  const branchStore = useBranchStore();

  const dialog = ref<SequencerDialogState>({
    visible: false,
    baseRef: "",
    baseLabel: "",
    todos: [],
    loadingPreview: false,
    pending: false,
    errorMessage: "",
  });

  /** 当前 rebase 进度；inProgress=false 表示无 rebase 半成态，状态栏隐藏 */
  const status = ref<RebaseStatus>({
    inProgress: false,
    total: 0,
    done: 0,
    currentCommitId: null,
    currentAction: null,
    conflictFiles: [],
  });

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const isOpen = computed(() => dialog.value.visible);
  const hasRebaseInProgress = computed(() => status.value.inProgress);

  function close(): void {
    dialog.value = {
      visible: false,
      baseRef: "",
      baseLabel: "",
      todos: [],
      loadingPreview: false,
      pending: false,
      errorMessage: "",
    };
  }

  /**
   * 打开 Sequencer Dialog 并预加载 todo 列表。
   * @param baseRef 一般是被右键的 commit id（rebase 区间是 baseRef..HEAD）
   * @param baseLabel commit 的简短描述，用于显示
   */
  async function openSequencer(baseRef: string, baseLabel: string): Promise<void> {
    if (!repoStore.activeRepo) return;
    dialog.value = {
      visible: true,
      baseRef,
      baseLabel,
      todos: [],
      loadingPreview: true,
      pending: false,
      errorMessage: "",
    };
    try {
      const commits: CommitInfo[] = await commands.getRebaseTodoPreview(
        repoStore.activeRepo.path,
        baseRef
      );
      if (commits.length === 0) {
        dialog.value.loadingPreview = false;
        dialog.value.errorMessage = "选中的 commit 与 HEAD 相同，没有需要编排的 commit";
        return;
      }
      dialog.value.todos = commits.map((c) => ({
        action: "pick",
        commitId: c.id,
        shortId: c.shortId,
        subject: c.summary,
      }));
      dialog.value.loadingPreview = false;
    } catch (e: unknown) {
      dialog.value.loadingPreview = false;
      dialog.value.errorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  function moveUp(index: number): void {
    if (index <= 0 || index >= dialog.value.todos.length) return;
    const arr = dialog.value.todos;
    [arr[index - 1], arr[index]] = [arr[index]!, arr[index - 1]!];
  }

  function moveDown(index: number): void {
    if (index < 0 || index >= dialog.value.todos.length - 1) return;
    const arr = dialog.value.todos;
    [arr[index + 1], arr[index]] = [arr[index]!, arr[index + 1]!];
  }

  function updateTodo(index: number, patch: Partial<RebaseTodoEntry>): void {
    const t = dialog.value.todos[index];
    if (!t) return;
    Object.assign(t, patch);
  }

  async function start(): Promise<void> {
    if (!repoStore.activeRepo) return;
    dialog.value.pending = true;
    dialog.value.errorMessage = "";
    try {
      const result = await commands.startInteractiveRebase(
        repoStore.activeRepo.path,
        dialog.value.baseRef,
        dialog.value.todos
      );
      if (result.success) {
        close();
        branchStore.showToast(result.message || "Interactive rebase 完成", "ok");
        await refreshStatus();
        return;
      }
      // 半成态：dialog 关闭，跳冲突 tab + 显示 toast + 启状态栏轮询
      close();
      await refreshStatus();
      if (result.conflicts.length > 0) {
        branchStore.requestTabSwitch("commit");
        branchStore.showToast(
          `Rebase 暂停：${result.conflicts.length} 个文件冲突，请解决后 Continue`,
          "err"
        );
      } else {
        branchStore.requestTabSwitch("commit");
        branchStore.showToast(result.message || "Rebase 在 edit 步骤暂停，请继续", "info");
      }
    } catch (e: unknown) {
      dialog.value.pending = false;
      dialog.value.errorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function refreshStatus(): Promise<void> {
    if (!repoStore.activeRepo) {
      status.value = {
        inProgress: false,
        total: 0,
        done: 0,
        currentCommitId: null,
        currentAction: null,
        conflictFiles: [],
      };
      return;
    }
    try {
      status.value = await commands.getRebaseStatus(repoStore.activeRepo.path);
    } catch {
      // 状态查询失败时保留旧值，避免 UI 抖动
    }
  }

  /** 启动状态栏的轮询；rebase 半成态期间每 2s 拉一次 */
  function startPolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void refreshStatus();
    }, 2000);
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function continueRebase(): Promise<void> {
    if (!repoStore.activeRepo) return;
    try {
      const result = await commands.continueOperation(repoStore.activeRepo.path, "rebase");
      await refreshStatus();
      if (result.success) {
        branchStore.showToast(result.message || "Rebase continue 成功", "ok");
      } else if (result.conflicts.length > 0) {
        branchStore.requestTabSwitch("commit");
        branchStore.showToast(
          `仍有 ${result.conflicts.length} 个冲突未解决`,
          "err"
        );
      } else {
        branchStore.showToast(result.message || "Continue 仍未完成", "err");
      }
    } catch (e: unknown) {
      branchStore.showToast(
        `Continue 失败：${e instanceof Error ? e.message : String(e)}`,
        "err"
      );
    }
  }

  async function abortRebase(): Promise<void> {
    if (!repoStore.activeRepo) return;
    try {
      await commands.abortOperation(repoStore.activeRepo.path, "rebase");
      await refreshStatus();
      branchStore.showToast("已 Abort，仓库回到 rebase 前状态", "info");
    } catch (e: unknown) {
      branchStore.showToast(
        `Abort 失败：${e instanceof Error ? e.message : String(e)}`,
        "err"
      );
    }
  }

  return {
    dialog,
    status,
    isOpen,
    hasRebaseInProgress,
    openSequencer,
    close,
    moveUp,
    moveDown,
    updateTodo,
    start,
    refreshStatus,
    startPolling,
    stopPolling,
    continueRebase,
    abortRebase,
  };
});
