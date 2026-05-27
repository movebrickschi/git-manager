import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useRepoStore } from "./repoStore";
import { commands } from "@/utils/commands";
import type { CommitInfo, GraphRow, LogResult } from "@/utils/commands";
import { useAbortable } from "@/composables/useAbortable";

function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    (e as { name?: unknown }).name === "AbortError"
  );
}

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

function defaultFilter(): LogFilter {
  return {
    branch: null,
    author: null,
    dateFrom: null,
    dateTo: null,
    path: null,
    searchText: "",
    useRegex: false,
    matchCase: false,
  };
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

  const filter = ref<LogFilter>(defaultFilter());

  // 每仓库独立的 filter 快照：切换仓库时存旧/取新，避免 searchText/author/date 等被带到另一仓库
  const filterCache = new Map<string, LogFilter>();

  const repoStore = useRepoStore();

  const { run: runFetchLog, cancel: cancelFetchLog } = useAbortable(
    async (
      signal: AbortSignal,
      repoPath: string,
      params: Parameters<typeof commands.getLog>[1]
    ): Promise<LogResult> => {
      const result = await commands.getLog(repoPath, params);
      // 即便底层 fetch/IPC 不感知 signal，结果到达时若已被新调用顶替则丢弃，避免污染 state
      if (signal.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return result;
    }
  );

  async function loadCommits(reset = false): Promise<void> {
    if (!repoStore.activeRepo) return;
    // reset 调用会顶替任何 in-flight 请求；分页加载（reset=false）仍走 loading guard 防止重复触底
    if (!reset && loading.value) return;

    loading.value = true;
    try {
      if (reset) {
        page.value = 0;
        commits.value = [];
        graphRows.value = [];
      }

      const result = await runFetchLog(repoStore.activeRepo.path, {
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
    } catch (e) {
      if (isAbortError(e)) return; // 旧请求被新调用顶替，安静退出
      throw e;
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

  function clearSelection() {
    selectedCommitIds.value = [];
    selectedCommitId.value = null;
  }

  const needsReload = ref(false);

  watch(
    () => repoStore.activeRepo?.path,
    (newPath, oldPath) => {
      // 把旧仓库的 filter 快照入缓存（branch/author/date/searchText/path/正则等全量保留）
      if (oldPath) {
        filterCache.set(oldPath, { ...filter.value });
      }

      cancelFetchLog("repo switched");
      commits.value = [];
      graphRows.value = [];
      selectedCommitId.value = null;
      selectedCommitIds.value = [];

      // 恢复新仓库的 filter；新仓库或未缓存过 → 用默认值（避免跨仓库污染）
      const restored = newPath ? filterCache.get(newPath) : undefined;
      filter.value = restored ? { ...restored } : defaultFilter();

      if (newPath) {
        needsReload.value = true;
      }
    }
  );

  function ensureLoaded() {
    if (needsReload.value && repoStore.activeRepo) {
      needsReload.value = false;
      loadCommits(true);
    }
  }

  return {
    commits,
    graphRows,
    selectedCommitId,
    selectedCommitIds,
    loading,
    hasMore,
    filter,
    needsReload,
    loadCommits,
    ensureLoaded,
    cancelFetchLog,
    selectCommit,
    clearSelection,
  };
});
