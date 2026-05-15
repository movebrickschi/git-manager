import { defineStore } from "pinia";
import { ref } from "vue";
import { useRepoStore } from "./repoStore";
import { commands } from "@/utils/commands";
import type { BranchInfo, Submodule } from "@/utils/commands";

export const useBranchStore = defineStore("branch", () => {
  const localBranches = ref<BranchInfo[]>([]);
  const remoteBranches = ref<BranchInfo[]>([]);
  const tags = ref<string[]>([]);
  const submodules = ref<Submodule[]>([]);
  const submodulesLoading = ref(false);
  const loading = ref(false);
  const searchQuery = ref("");
  const favorites = ref<string[]>([]);

  const repoStore = useRepoStore();

  async function loadBranches() {
    if (!repoStore.activeRepo) return;
    loading.value = true;
    try {
      const result = await commands.getBranches(repoStore.activeRepo.path);
      localBranches.value = result.local;
      remoteBranches.value = result.remote;
      tags.value = result.tags;
    } finally {
      loading.value = false;
    }
  }

  async function createBranch(name: string, startPoint?: string) {
    if (!repoStore.activeRepo) return;
    await commands.createBranch(repoStore.activeRepo.path, name, startPoint);
    await loadBranches();
  }

  async function checkoutBranch(name: string) {
    if (!repoStore.activeRepo) return;
    await commands.checkoutBranch(repoStore.activeRepo.path, name);
    repoStore.activeRepo.currentBranch = name;
    await loadBranches();
  }

  async function deleteBranch(name: string, force = false) {
    if (!repoStore.activeRepo) return;
    await commands.deleteBranch(repoStore.activeRepo.path, name, force);
    await loadBranches();
  }

  async function renameBranch(oldName: string, newName: string) {
    if (!repoStore.activeRepo) return;
    await commands.renameBranch(repoStore.activeRepo.path, oldName, newName);
    await loadBranches();
  }

  async function mergeBranch(name: string) {
    if (!repoStore.activeRepo) return;
    return await commands.mergeBranch(repoStore.activeRepo.path, name);
  }

  async function createTag(name: string, commitId?: string, message?: string) {
    if (!repoStore.activeRepo) return;
    await commands.createTag(repoStore.activeRepo.path, name, commitId, message);
    await loadBranches();
  }

  async function deleteTag(name: string) {
    if (!repoStore.activeRepo) return;
    await commands.deleteTag(repoStore.activeRepo.path, name);
    await loadBranches();
  }

  async function pushTag(remote: string, name: string) {
    if (!repoStore.activeRepo) return;
    await commands.pushTag(repoStore.activeRepo.path, remote, name);
  }

  async function deleteRemoteTag(remote: string, name: string) {
    if (!repoStore.activeRepo) return;
    await commands.deleteRemoteTag(repoStore.activeRepo.path, remote, name);
  }

  async function checkoutTag(name: string) {
    if (!repoStore.activeRepo) return;
    await commands.checkoutTag(repoStore.activeRepo.path, name);
    await loadBranches();
  }

  function toggleFavorite(name: string) {
    const idx = favorites.value.indexOf(name);
    if (idx >= 0) {
      favorites.value.splice(idx, 1);
    } else {
      favorites.value.push(name);
    }
  }

  async function loadSubmodules() {
    if (!repoStore.activeRepo) return;
    submodulesLoading.value = true;
    try {
      submodules.value = await commands.getSubmodules(repoStore.activeRepo.path);
    } finally {
      submodulesLoading.value = false;
    }
  }

  async function initSubmodule(path?: string) {
    if (!repoStore.activeRepo) return;
    await commands.initSubmodules(repoStore.activeRepo.path, path ? [path] : undefined);
    await loadSubmodules();
  }

  async function updateSubmodule(path?: string) {
    if (!repoStore.activeRepo) return;
    await commands.updateSubmodules(repoStore.activeRepo.path, path ? [path] : undefined);
    await loadSubmodules();
  }

  async function syncSubmodule(path?: string) {
    if (!repoStore.activeRepo) return;
    await commands.syncSubmodules(repoStore.activeRepo.path, path ? [path] : undefined);
    await loadSubmodules();
  }

  return {
    localBranches,
    remoteBranches,
    tags,
    submodules,
    submodulesLoading,
    loading,
    searchQuery,
    favorites,
    loadBranches,
    createBranch,
    checkoutBranch,
    deleteBranch,
    renameBranch,
    mergeBranch,
    createTag,
    deleteTag,
    pushTag,
    deleteRemoteTag,
    checkoutTag,
    toggleFavorite,
    loadSubmodules,
    initSubmodule,
    updateSubmodule,
    syncSubmodule,
  };
});
