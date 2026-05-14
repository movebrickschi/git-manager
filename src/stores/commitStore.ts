import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useRepoStore } from "./repoStore";
import { commands } from "@/utils/commands";
import type { FileStatus, StatusResult } from "@/utils/commands";
import { errMsg } from "@/utils/error";
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

  // 仓库切换时取消未完成的 getStatus，避免旧结果污染新仓库面板
  watch(
    () => repoStore.activeRepo?.path,
    () => {
      cancelFetchStatus("repo switched");
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
    for (const p of paths) {
      await commands.stageFile(repoPath, p);
    }
    await loadStatus();
  }

  async function unstageFiles(paths: string[]) {
    if (!repoStore.activeRepo || paths.length === 0) return;
    const repoPath = repoStore.activeRepo.path;
    for (const p of paths) {
      await commands.unstageFile(repoPath, p);
    }
    await loadStatus();
  }

  async function discardFiles(
    paths: string[]
  ): Promise<{ ok: string[]; failed: { path: string; error: string }[] }> {
    const result = { ok: [] as string[], failed: [] as { path: string; error: string }[] };
    if (!repoStore.activeRepo || paths.length === 0) return result;
    const repoPath = repoStore.activeRepo.path;
    for (const p of paths) {
      try {
        await commands.discardFileChanges(repoPath, p);
        result.ok.push(p);
      } catch (e: unknown) {
        result.failed.push({ path: p, error: errMsg(e) });
      }
    }
    await loadStatus();
    return result;
  }

  async function deleteFiles(
    paths: string[]
  ): Promise<{ ok: string[]; failed: { path: string; error: string }[] }> {
    const result = { ok: [] as string[], failed: [] as { path: string; error: string }[] };
    if (!repoStore.activeRepo || paths.length === 0) return result;
    const repoPath = repoStore.activeRepo.path;
    for (const p of paths) {
      try {
        await commands.deleteFile(repoPath, p);
        result.ok.push(p);
      } catch (e: unknown) {
        result.failed.push({ path: p, error: errMsg(e) });
      }
    }
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
    commitAndPush,
    generateMessage,
    cancelGenerate,
  };
});
