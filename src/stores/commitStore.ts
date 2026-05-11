import { defineStore } from "pinia";
import { ref } from "vue";
import { useRepoStore } from "./repoStore";
import { commands } from "@/utils/commands";
import type { FileStatus } from "@/utils/commands";

export const useCommitStore = defineStore("commit", () => {
  const stagedFiles = ref<FileStatus[]>([]);
  const unstagedFiles = ref<FileStatus[]>([]);
  const untrackedFiles = ref<FileStatus[]>([]);
  const commitMessage = ref("");
  const isAmend = ref(false);
  const loading = ref(false);
  const messageHistory = ref<string[]>([]);

  const repoStore = useRepoStore();

  async function loadStatus() {
    if (!repoStore.activeRepo) return;
    loading.value = true;
    try {
      console.log('About to call getStatus for path:', repoStore.activeRepo.path); // Debug log
      const result = await commands.getStatus(repoStore.activeRepo.path);
      console.log('getStatus result:', result); // Debug log
      stagedFiles.value = result.staged;
      unstagedFiles.value = result.unstaged;
      untrackedFiles.value = result.untracked;
      console.log(`Loaded status: ${result.staged.length} staged, ${result.unstaged.length} unstaged, ${result.untracked.length} untracked`);
    } catch (error) {
      console.error('Error in loadStatus:', error); // More detailed error logging
      // Re-throw the error so upper layer can handle it
      throw error;
    } finally {
      loading.value = false;
    }
  }

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
      } catch (e: any) {
        result.failed.push({ path: p, error: e?.message ?? String(e) });
      }
    }
    await loadStatus();
    return result;
  }

  async function commit() {
    if (!repoStore.activeRepo || !commitMessage.value.trim()) return;
    await commands.commit(
      repoStore.activeRepo.path,
      commitMessage.value,
      isAmend.value
    );
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

  return {
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    commitMessage,
    isAmend,
    loading,
    messageHistory,
    loadStatus,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    stageFiles,
    unstageFiles,
    discardFiles,
    commit,
    commitAndPush,
  };
});
