import { defineStore } from "pinia";
import { ref } from "vue";
import { useRepoStore } from "./repoStore";
import { commands } from "@/utils/commands";
import type { BranchInfo } from "@/utils/commands";

export const useBranchStore = defineStore("branch", () => {
  const localBranches = ref<BranchInfo[]>([]);
  const remoteBranches = ref<BranchInfo[]>([]);
  const tags = ref<string[]>([]);
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

  function toggleFavorite(name: string) {
    const idx = favorites.value.indexOf(name);
    if (idx >= 0) {
      favorites.value.splice(idx, 1);
    } else {
      favorites.value.push(name);
    }
  }

  return {
    localBranches,
    remoteBranches,
    tags,
    loading,
    searchQuery,
    favorites,
    loadBranches,
    createBranch,
    checkoutBranch,
    deleteBranch,
    renameBranch,
    mergeBranch,
    toggleFavorite,
  };
});
