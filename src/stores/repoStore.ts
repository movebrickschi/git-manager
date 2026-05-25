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
const RECENT_REPOS_KEY = "gm.recentRepos";
const MAX_RECENT_REPOS = 8;

function loadRecentRepos(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_REPOS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveRecentRepos(paths: string[]) {
  try {
    localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(paths));
  } catch {
    /* ignore quota */
  }
}

export const useRepoStore = defineStore("repo", () => {
  const repos = ref<RepoInfo[]>([]);
  const recentRepos = ref<string[]>(loadRecentRepos());
  const activeRepoIndex = ref(0);

  const activeRepo = computed(() => repos.value[activeRepoIndex.value] ?? null);

  function rememberRepo(path: string) {
    recentRepos.value = [
      path,
      ...recentRepos.value.filter((p) => p !== path),
    ].slice(0, MAX_RECENT_REPOS);
    saveRecentRepos(recentRepos.value);
  }

  function syncOpenReposToRecent() {
    const paths = repos.value.map((repo) => repo.path);
    if (paths.length === 0) return;
    recentRepos.value = [
      ...paths,
      ...recentRepos.value.filter((path) => !paths.includes(path)),
    ].slice(0, MAX_RECENT_REPOS);
    saveRecentRepos(recentRepos.value);
  }

  async function openRepo(path: string) {
    const info = await commands.openRepo(path);
    rememberRepo(info.path);
    const existing = repos.value.findIndex((r) => r.path === info.path);
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
    recentRepos,
    activeRepoIndex,
    activeRepo,
    openRepo,
    closeRepo,
    setActiveRepo,
    syncOpenReposToRecent,
  };
});
