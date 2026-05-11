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

  const { run: runFetchLog, cancel: cancelFetchLog } = useAbortable(
    async (
      signal: AbortSignal,
      repoPath: string,
      params: Parameters<typeof commands.getLog>[1],
    ): Promise<LogResult> => {
      const result = await commands.getLog(repoPath, params);
      // 即便底层 fetch/IPC 不感知 signal，结果到达时若已被新调用顶替则丢弃，避免污染 state
      if (signal.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return result;
    },
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

  watch(
    () => repoStore.activeRepo?.path,
    () => {
      // 仓库切换时立即 abort 上一仓库未完成的 getLog，避免旧结果污染新仓库 commits
      cancelFetchLog("repo switched");
      if (repoStore.activeRepo) {
        loadCommits(true);
      }
    },
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
    cancelFetchLog,
    selectCommit,
  };
});
