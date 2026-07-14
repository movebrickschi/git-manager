import { ref } from "vue";
import { commands } from "@/utils/commands";
import { errMsg, errText } from "@/utils/error";
import { translateGitError } from "@/utils/git-error";

export type MergeOp = "merge" | "rebase" | "cherry-pick" | "revert";

function mergeOpLabel(op: MergeOp): string {
  switch (op) {
    case "merge":
      return "合并";
    case "rebase":
      return "变基";
    case "cherry-pick":
      return "拣选";
    case "revert":
      return "反做";
  }
}

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
  let refreshSeq = 0;

  const notify = (m: string) => opts.onMessage?.(m);

  async function refresh(): Promise<void> {
    const seq = ++refreshSeq;
    const repoPath = opts.getRepoPath();
    if (!repoPath) {
      mergeState.value = null;
      return;
    }
    try {
      const next = await commands.getMergeState(repoPath);
      if (seq !== refreshSeq || opts.getRepoPath() !== repoPath) return;
      mergeState.value = next;
    } catch (e: unknown) {
      if (seq !== refreshSeq || opts.getRepoPath() !== repoPath) return;
      console.error("getMergeState failed:", errMsg(e));
      mergeState.value = null;
    }
  }

  async function continueOp(): Promise<void> {
    const repoPath = opts.getRepoPath();
    if (!repoPath || !mergeState.value || mergeState.value.state === "none") return;
    const op = mergeState.value.state;
    mergeBusy.value = true;
    try {
      const result = await commands.continueOperation(repoPath, op);
      if (!result.success) notify(`继续失败：${translateGitError(result.message)}`);
      else notify(`${mergeOpLabel(op)} 已继续完成`);
      await refresh();
      await opts.onAfterAction?.();
    } catch (e: unknown) {
      notify(`继续失败：${errText(e)}`);
    } finally {
      mergeBusy.value = false;
    }
  }

  async function abortOp(): Promise<void> {
    const repoPath = opts.getRepoPath();
    if (!repoPath || !mergeState.value || mergeState.value.state === "none") return;
    const op = mergeState.value.state;
    mergeBusy.value = true;
    try {
      await commands.abortOperation(repoPath, op);
      notify(`${mergeOpLabel(op)} 已中止`);
      await refresh();
      await opts.onAfterAction?.();
    } catch (e: unknown) {
      notify(`中止失败：${errText(e)}`);
    } finally {
      mergeBusy.value = false;
    }
  }

  return { mergeState, mergeBusy, refresh, continueOp, abortOp };
}
