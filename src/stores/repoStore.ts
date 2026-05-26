import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useSettingsStore } from "./settingsStore";
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
export interface RecentRepo {
  path: string;
  branch?: string;
}

const RECENT_REPOS_KEY = "gm.recentRepos";
const MAX_RECENT_REPOS = 20;

function loadRecentRepos(): RecentRepo[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_REPOS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v: unknown): RecentRepo => {
      if (typeof v === "string") return { path: v };
      if (v && typeof v === "object" && "path" in v && typeof (v as RecentRepo).path === "string")
        return v as RecentRepo;
      return null!;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function saveRecentRepos(repos: RecentRepo[]) {
  try {
    localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(repos));
  } catch {
    /* ignore quota */
  }
}

export const useRepoStore = defineStore("repo", () => {
  const repos = ref<RepoInfo[]>([]);
  const recentRepos = ref<RecentRepo[]>(loadRecentRepos());
  const activeRepoIndex = ref(0);

  const activeRepo = computed(() => repos.value[activeRepoIndex.value] ?? null);

  function rememberRepo(path: string, branch?: string) {
    recentRepos.value = [
      { path, branch },
      ...recentRepos.value.filter((r) => r.path !== path),
    ].slice(0, MAX_RECENT_REPOS);
    saveRecentRepos(recentRepos.value);
  }

  function clearRecentRepos() {
    recentRepos.value = [];
    saveRecentRepos(recentRepos.value);
  }

  function syncOpenReposToRecent() {
    if (repos.value.length === 0) return;
    const openPaths = new Set(repos.value.map((r) => r.path));
    const openEntries: RecentRepo[] = repos.value.map((r) => ({
      path: r.path,
      branch: r.currentBranch,
    }));
    recentRepos.value = [
      ...openEntries,
      ...recentRepos.value.filter((r) => !openPaths.has(r.path)),
    ].slice(0, MAX_RECENT_REPOS);
    saveRecentRepos(recentRepos.value);
  }

  async function openRepo(path: string) {
    const settings = useSettingsStore();
    const info = await commands.openRepo(path);
    if (settings.fetchOnOpen) {
      await commands.fetchAll(info.path);
    }
    rememberRepo(info.path, info.currentBranch);
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
    clearRecentRepos,
  };
});
