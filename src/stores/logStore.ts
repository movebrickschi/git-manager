import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useRepoStore } from "./repoStore";
import { commands } from "@/utils/commands";
import type { CommitInfo, GraphRow } from "@/utils/commands";

export interface LogFilter {
  branch: string | null;
  author: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  path: string | null;
  searchText: string;
  useRegex: boolean;
  matchCase: boolean;
}

export const useLogStore = defineStore("log", () => {
  const commits = ref<CommitInfo[]>([]);
  const graphRows = ref<GraphRow[]>([]);
  const selectedCommitId = ref<string | null>(null);
  const selectedCommitIds = ref<string[]>([]);
  const loading = ref(false);
  const hasMore = ref(true);
  const page = ref(0);
  const pageSize = 100;

  const filter = ref<LogFilter>({
    branch: null,
    author: null,
    dateFrom: null,
    dateTo: null,
    path: null,
    searchText: "",
    useRegex: false,
    matchCase: false,
  });

  const repoStore = useRepoStore();

  async function loadCommits(reset = false) {
    if (!repoStore.activeRepo) return;
    if (loading.value) return;

    loading.value = true;
    try {
      if (reset) {
        page.value = 0;
        commits.value = [];
        graphRows.value = [];
      }

      const result = await commands.getLog(repoStore.activeRepo.path, {
        skip: page.value * pageSize,
        limit: pageSize,
        branch: filter.value.branch,
        author: filter.value.author,
        dateFrom: filter.value.dateFrom,
        dateTo: filter.value.dateTo,
        path: filter.value.path,
        searchText: filter.value.searchText,
        useRegex: filter.value.useRegex,
        matchCase: filter.value.matchCase,
      });

      commits.value.push(...result.commits);
      graphRows.value.push(...result.graphRows);
      hasMore.value = result.commits.length === pageSize;
      page.value++;
    } finally {
      loading.value = false;
    }
  }

  function selectCommit(id: string, multi = false) {
    if (multi) {
      const idx = selectedCommitIds.value.indexOf(id);
      if (idx >= 0) {
        selectedCommitIds.value.splice(idx, 1);
      } else {
        selectedCommitIds.value.push(id);
      }
    } else {
      selectedCommitIds.value = [id];
    }
    selectedCommitId.value = id;
  }

  watch(
    () => repoStore.activeRepo?.path,
    () => {
      if (repoStore.activeRepo) {
        loadCommits(true);
      }
    }
  );

  return {
    commits,
    graphRows,
    selectedCommitId,
    selectedCommitIds,
    loading,
    hasMore,
    filter,
    loadCommits,
    selectCommit,
  };
});
