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

  const { run: runFetchStatus, cancel: cancelFetchStatus } = useAbortable(
    async (signal: AbortSignal, repoPath: string): Promise<StatusResult> => {
      const result = await commands.getStatus(repoPath);
      if (signal.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return result;
    }
  );

  async function loadStatus(): Promise<void> {
    if (!repoStore.activeRepo) return;
    loading.value = true;
    try {
      const result = await runFetchStatus(repoStore.activeRepo.path);
      stagedFiles.value = result.staged;
      unstagedFiles.value = result.unstaged;
      untrackedFiles.value = result.untracked;
    } catch (error) {
      if (isAbortError(error)) return; // 仓库切换 / 新 loadStatus 顶替时安静退出
      console.error("[commitStore] loadStatus failed:", errMsg(error));
      throw error;
    } finally {
      loading.value = false;
    }
  }

  // 仓库切换时取消未完成的 getStatus，并清掉跨仓库会污染/误操作的脏状态。
  // 保留：messageHistory（跨项目复用 commit 习惯）；不在此处 loadStatus，由调用方触发。
  watch(
    () => repoStore.activeRepo?.path,
    () => {
      cancelFetchStatus("repo switched");
      commitMessage.value = "";
      isAmend.value = false;
      stagedFiles.value = [];
      unstagedFiles.value = [];
      untrackedFiles.value = [];
      aiError.value = null;
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
