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
import { ref, computed, watch } from "vue";
import { useRepoStore } from "./repoStore";
import { useBranchStore } from "./branchStore";
import { commands } from "@/utils/commands";
import { refreshGit } from "@/composables/useGitRefresh";
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

  /**
   * Continue / Abort 是否正在执行中。
   *
   * 后端同仓库 git 命令是单实例串行队列：若此刻有联网命令（push/pull/fetch）卡在
   * 队列里，continue/abort 会排队等待、迟迟不返回。没有这个标志时，用户点了按钮却
   * 看不到任何变化，体感是「点击无反应」。用它把按钮置为「处理中…」并禁用，既给出
   * 明确反馈，又避免重复点击把多条 --continue/--abort 压进队列。
   */
  const actionPending = ref(false);

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
        // rebase 改写历史/分支位置/工作区，必须刷新 log + 分支 + 文件状态，
        // 否则提交图与 ahead/behind 箭头会严重滞后。
        await Promise.all([refreshStatus(), refreshGit()]);
        return;
      }
      // 半成态：dialog 关闭，跳冲突 tab + 显示 toast + 启状态栏轮询
      close();
      await Promise.all([refreshStatus(), refreshGit()]);
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
    const repoPath = repoStore.activeRepo.path;
    try {
      const next = await commands.getRebaseStatus(repoPath);
      // 竞态守卫：2s 轮询与切仓库 watch 会并发触发；await 期间若已切到别的仓库，
      // 旧仓库的 rebase 进度不能覆盖当前仓库的状态栏。
      if (repoStore.activeRepo?.path !== repoPath) return;
      status.value = next;
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

  // 切仓库严重风险：dialog 里编排的是 A 的 commits / baseRef，status 显示的是 A 的 rebase 进度；
  // 不重置会让 Continue/Abort/Start 把 A 的载荷打到 B 仓库。
  watch(
    () => repoStore.activeRepo?.path,
    () => {
      close();
      status.value = {
        inProgress: false,
        total: 0,
        done: 0,
        currentCommitId: null,
        currentAction: null,
        conflictFiles: [],
      };
      // 立刻拉一次新仓库的 rebase 状态（若新仓库本就在 rebase 半成态，状态栏会同步显示）
      void refreshStatus();
    }
  );

  async function continueRebase(): Promise<void> {
    if (!repoStore.activeRepo) return;
    if (actionPending.value) return;
    actionPending.value = true;
    try {
      const result = await commands.continueOperation(repoStore.activeRepo.path, "rebase");
      await Promise.all([refreshStatus(), refreshGit()]);
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
    } finally {
      actionPending.value = false;
    }
  }

  async function abortRebase(): Promise<void> {
    if (!repoStore.activeRepo) return;
    if (actionPending.value) return;
    actionPending.value = true;
    try {
      await commands.abortOperation(repoStore.activeRepo.path, "rebase");
      await Promise.all([refreshStatus(), refreshGit()]);
      branchStore.showToast("已 Abort，仓库回到 rebase 前状态", "info");
    } catch (e: unknown) {
      branchStore.showToast(
        `Abort 失败：${e instanceof Error ? e.message : String(e)}`,
        "err"
      );
    } finally {
      actionPending.value = false;
    }
  }

  return {
    dialog,
    status,
    actionPending,
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
