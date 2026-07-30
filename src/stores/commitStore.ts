import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useRepoStore } from "./repoStore";
import { commands } from "@/utils/commands";
import type { FileStatus, StatusResult, BatchFileResult } from "@/utils/commands";
import { errMsg } from "@/utils/error";
import { refreshGit } from "@/composables/useGitRefresh";
import { useAbortable } from "@/composables/useAbortable";
import { aiBridge } from "@/services/ai";
import type { AiErrorCode } from "../../shared/ai/types";

function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    (e as { name?: unknown }).name === "AbortError"
  );
}

/**
 * 文件列表指纹。用于跳过「内容完全没变」的 ref 赋值。
 *
 * 10s 轮询 + 文件监听事件在绝大多数 tick 上拿到的都是与当前完全一致的列表，若照旧
 * 整体替换三个数组，Vue 会把整份文件列表重新 diff/patch，并连带重算多选勾选、过滤
 * 分组等一串 computed——文件数量一多就是可感知的周期性卡顿。指纹一致就直接不写 ref。
 */
function fileListSignature(files: FileStatus[]): string {
  let sig = `${files.length}`;
  for (const f of files) sig += `\u0001${f.status}\u0002${f.path}\u0002${f.oldPath ?? ""}`;
  return sig;
}

export const useCommitStore = defineStore("commit", () => {
  const stagedFiles = ref<FileStatus[]>([]);
  const unstagedFiles = ref<FileStatus[]>([]);
  const untrackedFiles = ref<FileStatus[]>([]);
  const commitMessage = ref("");
  const isAmend = ref(false);
  const loading = ref(false);
  const messageHistory = ref<string[]>([]);
  const isGeneratingAI = ref(false);
  const aiError = ref<{ code: AiErrorCode; reason: string } | null>(null);

  const repoStore = useRepoStore();

  /**
   * 每仓库的状态结果缓存，支撑切回已访问仓库时的 stale-while-revalidate：
   * 先把上次的列表立即回填（0 延迟出内容，不再闪一屏「加载中…」），随后的
   * loadStatus 拿到新结果再整体替换。与 logStore 的日志缓存同一套思路。
   */
  const statusCache = new Map<string, StatusResult>();

  /**
   * 同仓库并发 loadStatus 的归并槽。
   *
   * 首屏与切仓库时有 4 个视图各自调一次 loadStatus（LocalChangesView / CommitPanel /
   * ChangedFilesPane / GitLogView），再叠上 10s 轮询、watcher 事件与写后 refreshGit。
   * 过去每次都发一条 IPC，后端串行队列上就排起 N 个 git status 进程，首屏耗时 =
   * N × 单次耗时；useAbortable 只是丢弃迟到的结果，并不能阻止进程已被 spawn。
   * 归并后同一仓库同一时刻只有一次在途请求，其余调用方共享它。
   */
  let inFlight: { repoPath: string; task: Promise<StatusResult> } | null = null;

  /** 已落库的三组列表指纹，用于 O(n) 判定「本次结果与当前显示完全一致」。 */
  let appliedSig = { staged: "", unstaged: "", untracked: "" };

  const { run: runFetchStatus, cancel: cancelFetchStatus } = useAbortable(
    async (signal: AbortSignal, repoPath: string): Promise<StatusResult> => {
      const result = await commands.getStatus(repoPath);
      if (signal.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return result;
    }
  );

  /** 无条件替换三组列表并重置指纹（切仓库回填 / 清空时用）。 */
  function setLists(result: StatusResult | null): void {
    const next = result ?? { staged: [], unstaged: [], untracked: [] };
    stagedFiles.value = next.staged.slice();
    unstagedFiles.value = next.unstaged.slice();
    untrackedFiles.value = next.untracked.slice();
    appliedSig = {
      staged: fileListSignature(next.staged),
      unstaged: fileListSignature(next.unstaged),
      untracked: fileListSignature(next.untracked),
    };
  }

  /** 按指纹逐组增量落库：只有真正变化的那一组才写 ref，避免无谓的整表 re-render。 */
  function applyStatus(repoPath: string, result: StatusResult): void {
    statusCache.set(repoPath, {
      staged: result.staged.slice(),
      unstaged: result.unstaged.slice(),
      untracked: result.untracked.slice(),
    });
    const nextSig = {
      staged: fileListSignature(result.staged),
      unstaged: fileListSignature(result.unstaged),
      untracked: fileListSignature(result.untracked),
    };
    if (nextSig.staged !== appliedSig.staged) stagedFiles.value = result.staged;
    if (nextSig.unstaged !== appliedSig.unstaged) unstagedFiles.value = result.unstaged;
    if (nextSig.untracked !== appliedSig.untracked) untrackedFiles.value = result.untracked;
    appliedSig = nextSig;
  }

  async function loadStatus(): Promise<void> {
    const repoPath = repoStore.activeRepo?.path;
    if (!repoPath) return;

    // 已有同仓库请求在途 → 直接搭车，不再 spawn 第二个 git status。
    // 结果由发起方负责落库，这里只需等它完成，保持 await loadStatus() 的语义。
    if (inFlight && inFlight.repoPath === repoPath) {
      try {
        await inFlight.task;
      } catch (error) {
        if (isAbortError(error)) return;
        throw error;
      }
      return;
    }

    loading.value = true;
    const task = runFetchStatus(repoPath);
    inFlight = { repoPath, task };
    try {
      const result = await task;
      if (repoStore.activeRepo?.path !== repoPath) return; // 切仓库后迟到的结果不落库
      applyStatus(repoPath, result);
    } catch (error) {
      if (isAbortError(error)) return; // 仓库切换 / 新 loadStatus 顶替时安静退出
      console.error("[commitStore] loadStatus failed:", errMsg(error));
      throw error;
    } finally {
      if (inFlight?.task === task) inFlight = null;
      loading.value = false;
    }
  }

  // 仓库切换时取消未完成的 getStatus，并清掉跨仓库会污染/误操作的脏状态。
  // 保留：messageHistory（跨项目复用 commit 习惯）；不在此处 loadStatus，由调用方触发。
  watch(
    () => repoStore.activeRepo?.path,
    (newPath) => {
      cancelFetchStatus("repo switched");
      inFlight = null;
      commitMessage.value = "";
      isAmend.value = false;
      aiError.value = null;
      // 命中缓存 → 立即回填旧结果（SWR，调用方随后触发的 loadStatus 会刷新它）；
      // 未命中 → 清空，等首次结果到达。
      setLists(newPath ? (statusCache.get(newPath) ?? null) : null);
    }
  );



  async function stageFile(path: string) {
    if (!repoStore.activeRepo) return;
    await commands.stageFile(repoStore.activeRepo.path, path);
    await loadStatus();
  }

  async function unstageFile(path: string) {
    if (!repoStore.activeRepo) return;
    await commands.unstageFile(repoStore.activeRepo.path, path);
    await loadStatus();
  }

  async function stageAll() {
    if (!repoStore.activeRepo) return;
    await commands.stageAll(repoStore.activeRepo.path);
    await loadStatus();
  }

  async function unstageAll() {
    if (!repoStore.activeRepo) return;
    await commands.unstageAll(repoStore.activeRepo.path);
    await loadStatus();
  }

  async function stageFiles(paths: string[]) {
    if (!repoStore.activeRepo || paths.length === 0) return;
    const repoPath = repoStore.activeRepo.path;
    await commands.stageFilesBatch(repoPath, paths);
    await loadStatus();
  }

  async function unstageFiles(paths: string[]) {
    if (!repoStore.activeRepo || paths.length === 0) return;
    const repoPath = repoStore.activeRepo.path;
    await commands.unstageFilesBatch(repoPath, paths);
    await loadStatus();
  }

  async function discardFiles(paths: string[]): Promise<BatchFileResult> {
    if (!repoStore.activeRepo || paths.length === 0) return { ok: [], failed: [] };
    // 一次 IPC 批量回滚（后端 pathspec 处理全部），替代逐个文件 N 次 IPC + N 次 git 进程。
    const result = await commands.discardFilesBatch(repoStore.activeRepo.path, paths);
    await loadStatus();
    return result;
  }

  async function deleteFiles(paths: string[]): Promise<BatchFileResult> {
    if (!repoStore.activeRepo || paths.length === 0) return { ok: [], failed: [] };
    // 一次 IPC 批量删除（后端并发 unlink），替代逐个文件 N 次 IPC。
    const result = await commands.deleteFilesBatch(repoStore.activeRepo.path, paths);
    await loadStatus();
    return result;
  }

  async function commit() {
    if (!repoStore.activeRepo || !commitMessage.value.trim()) return;
    await commands.commit(repoStore.activeRepo.path, commitMessage.value, isAmend.value);
    messageHistory.value.unshift(commitMessage.value);
    if (messageHistory.value.length > 20) messageHistory.value.pop();
    commitMessage.value = "";
    isAmend.value = false;
    await refreshGit();
  }

  /** 仅提交指定 N 个文件（pathspec），不影响其它 staged 内容；返回新 commit 短 id。 */
  async function commitFiles(paths: string[], message: string): Promise<string> {
    if (!repoStore.activeRepo || paths.length === 0 || !message.trim()) return "";
    const head = await commands.commitFiles(
      repoStore.activeRepo.path,
      paths,
      message.trim()
    );
    messageHistory.value.unshift(message.trim());
    if (messageHistory.value.length > 20) messageHistory.value.pop();
    await refreshGit();
    return head;
  }

  /** 仅 stash 指定 N 个文件，其余 dirty 不动；产生 1 个 stash entry。 */
  async function stashFiles(paths: string[], message?: string): Promise<void> {
    if (!repoStore.activeRepo || paths.length === 0) return;
    await commands.stashFiles(repoStore.activeRepo.path, paths, message);
    await loadStatus();
  }

  async function commitAndPush() {
    await commit();
    if (!repoStore.activeRepo) return;
    await commands.push(repoStore.activeRepo.path);
  }

  async function generateMessage(mode: "replace" | "append" = "replace"): Promise<boolean> {
    aiError.value = null;
    if (!repoStore.activeRepo) {
      aiError.value = { code: "NO_STAGED", reason: "未打开仓库" };
      return false;
    }
    if (stagedFiles.value.length === 0) {
      aiError.value = { code: "NO_STAGED", reason: "请先暂存文件" };
      return false;
    }
    isGeneratingAI.value = true;
    try {
      const result = await aiBridge.generate(repoStore.activeRepo.path);
      if (result.ok) {
        if (mode === "append" && commitMessage.value.trim()) {
          commitMessage.value = commitMessage.value.trimEnd() + "\n\n" + result.message;
        } else {
          commitMessage.value = result.message;
        }
        return true;
      }
      aiError.value = { code: result.code, reason: result.reason };
      return false;
    } catch (e: unknown) {
      aiError.value = { code: "UNKNOWN", reason: errMsg(e) };
      return false;
    } finally {
      isGeneratingAI.value = false;
    }
  }

  async function cancelGenerate(): Promise<void> {
    try {
      await aiBridge.abort();
    } catch (e: unknown) {
      console.warn("[commitStore] cancelGenerate failed:", errMsg(e));
    }
  }

  return {
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    commitMessage,
    isAmend,
    loading,
    messageHistory,
    isGeneratingAI,
    aiError,
    loadStatus,
    cancelFetchStatus,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    stageFiles,
    unstageFiles,
    discardFiles,
    deleteFiles,
    commit,
    commitFiles,
    stashFiles,
    commitAndPush,
    generateMessage,
    cancelGenerate,
  };
});
