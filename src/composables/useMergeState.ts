import { ref } from "vue";
import { commands } from "@/utils/commands";
import { errMsg } from "@/utils/error";

export type MergeOp = "merge" | "rebase" | "cherry-pick" | "revert";

export interface MergeStateSnapshot {
  state: "none" | MergeOp;
  hasConflicts: boolean;
}

/**
 * 仓库当前合并/变基/cherry-pick/revert 半成态的状态与 continue/abort 操作。
 * 与具体 repo 解耦：调用方负责传入 repoPath（通常来自 repoStore.activeRepo?.path）。
 */
export function useMergeState(opts: {
  getRepoPath: () => string | null | undefined;
  onAfterAction?: () => Promise<void> | void;
  onMessage?: (msg: string) => void;
}) {
  const mergeState = ref<MergeStateSnapshot | null>(null);
  const mergeBusy = ref(false);

  const notify = (m: string) => opts.onMessage?.(m);

  async function refresh(): Promise<void> {
    const repoPath = opts.getRepoPath();
    if (!repoPath) {
      mergeState.value = null;
      return;
    }
    try {
      mergeState.value = await commands.getMergeState(repoPath);
    } catch (e: unknown) {
      console.error("getMergeState failed:", errMsg(e));
      mergeState.value = null;
    }
  }

  async function continueOp(): Promise<void> {
    const repoPath = opts.getRepoPath();
    if (!repoPath || !mergeState.value || mergeState.value.state === "none") return;
    mergeBusy.value = true;
    try {
      const result = await commands.continueOperation(repoPath, mergeState.value.state);
      if (!result.success) notify(`继续失败：${result.message}`);
      else notify(`${mergeState.value.state} 已继续完成`);
      await refresh();
      await opts.onAfterAction?.();
    } catch (e: unknown) {
      notify(`继续失败：${errMsg(e)}`);
    } finally {
      mergeBusy.value = false;
    }
  }

  async function abortOp(): Promise<void> {
    const repoPath = opts.getRepoPath();
    if (!repoPath || !mergeState.value || mergeState.value.state === "none") return;
    mergeBusy.value = true;
    try {
      await commands.abortOperation(repoPath, mergeState.value.state);
      notify(`${mergeState.value.state} 已中止`);
      await refresh();
      await opts.onAfterAction?.();
    } catch (e: unknown) {
      notify(`中止失败：${errMsg(e)}`);
    } finally {
      mergeBusy.value = false;
    }
  }

  return { mergeState, mergeBusy, refresh, continueOp, abortOp };
}
