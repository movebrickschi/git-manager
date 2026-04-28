import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { commands } from "@/utils/commands";

export interface RepoInfo {
  path: string;
  name: string;
  currentBranch: string;
  color: string;
}

const REPO_COLORS = [
  "#d73a49",
  "#22863a",
  "#b08800",
  "#0366d6",
  "#6f42c1",
  "#0086b3",
  "#cb2431",
  "#188038",
];

export const useRepoStore = defineStore("repo", () => {
  const repos = ref<RepoInfo[]>([]);
  const activeRepoIndex = ref(0);

  const activeRepo = computed(() => repos.value[activeRepoIndex.value] ?? null);

  async function openRepo(path: string) {
    const info = await commands.openRepo(path);
    const existing = repos.value.findIndex((r) => r.path === path);
    if (existing >= 0) {
      activeRepoIndex.value = existing;
      repos.value[existing].currentBranch = info.currentBranch;
      return;
    }
    repos.value.push({
      path: info.path,
      name: info.name,
      currentBranch: info.currentBranch,
      color: REPO_COLORS[repos.value.length % REPO_COLORS.length],
    });
    activeRepoIndex.value = repos.value.length - 1;
  }

  function closeRepo(index: number) {
    repos.value.splice(index, 1);
    if (activeRepoIndex.value >= repos.value.length) {
      activeRepoIndex.value = Math.max(0, repos.value.length - 1);
    }
  }

  function setActiveRepo(index: number) {
    if (index >= 0 && index < repos.value.length) {
      activeRepoIndex.value = index;
    }
  }

  return {
    repos,
    activeRepoIndex,
    activeRepo,
    openRepo,
    closeRepo,
    setActiveRepo,
  };
});
