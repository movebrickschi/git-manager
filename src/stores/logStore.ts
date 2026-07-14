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

/** filter 指纹：判断缓存的日志结果是否仍匹配当前筛选条件（不一致则不回填、强制重拉）。 */
function filterKey(f: LogFilter): string {
  return JSON.stringify([
    f.branch,
    f.author,
    f.dateFrom,
    f.dateTo,
    f.path,
    f.searchText,
    f.useRegex,
    f.matchCase,
  ]);
}

/** 每仓库的日志结果缓存条目（含分页进度），支撑切回仓库时 stale-while-revalidate。 */
interface LogCacheEntry {
  commits: CommitInfo[];
  graphRows: GraphRow[];
  page: number;
  hasMore: boolean;
  filterKey: string;
}

export const useLogStore = defineStore("log", () => {
  const commits = ref<CommitInfo[]>([]);
  const graphRows = ref<GraphRow[]>([]);
  const selectedCommitId = ref<string | null>(null);
  const selectedCommitIds = ref<string[]>([]);
  /** 日志快照刷新后，即使选中 SHA 未变，也驱动详情/文件面板重拉。 */
  const selectionRefreshToken = ref(0);
  const loading = ref(false);
  const hasMore = ref(true);
  const page = ref(0);
  const pageSize = 100;

  const filter = ref<LogFilter>(defaultFilter());

  // 每仓库独立的 filter 快照：切换仓库时存旧/取新，避免 searchText/author/date 等被带到另一仓库
  const filterCache = new Map<string, LogFilter>();

  // 每仓库的日志结果缓存：切回已访问仓库时立即回填（0 延迟显示），再后台刷新（SWR）。
  const logCache = new Map<string, LogCacheEntry>();

  const repoStore = useRepoStore();
  let loadSeq = 0;

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

    const repoPath = repoStore.activeRepo.path;
    const targetPage = reset ? 0 : page.value;
    const seq = ++loadSeq;

    loading.value = true;
    try {
      const result = await runFetchLog(repoPath, {
        skip: targetPage * pageSize,
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

      if (reset) {
        // 替换式刷新：不在请求前清空，避免「切回已缓存仓库」回填的内容闪一下空白
        // （stale-while-revalidate：先展示缓存，结果到达后整体替换）。
        commits.value = result.commits;
        graphRows.value = result.graphRows;
        page.value = 1;

        const available = new Set(result.commits.map((commit) => commit.id));
        selectedCommitIds.value = selectedCommitIds.value.filter((id) => available.has(id));
        if (selectedCommitId.value && !available.has(selectedCommitId.value)) {
          clearSelection();
        } else if (selectedCommitId.value) {
          selectionRefreshToken.value += 1;
        }
      } else {
        commits.value.push(...result.commits);
        graphRows.value.push(...result.graphRows);
        page.value++;
      }
      hasMore.value = result.commits.length === pageSize;

      // 写入每仓库结果缓存：下次切回该仓库可立即回填，配合 needsReload 后台刷新形成 SWR。
      logCache.set(repoPath, {
        commits: commits.value.slice(),
        graphRows: graphRows.value.slice(),
        page: page.value,
        hasMore: hasMore.value,
        filterKey: filterKey(filter.value),
      });
    } catch (e) {
      if (isAbortError(e)) {
        return; // 旧请求被新调用顶替，安静退出
      }
      throw e;
    } finally {
      if (seq === loadSeq) loading.value = false;
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
      loadSeq += 1;
      loading.value = false;
      selectedCommitId.value = null;
      selectedCommitIds.value = [];

      // 恢复新仓库的 filter；新仓库或未缓存过 → 用默认值（避免跨仓库污染）
      const restored = newPath ? filterCache.get(newPath) : undefined;
      filter.value = restored ? { ...restored } : defaultFilter();

      // 结果缓存命中且 filter 指纹一致 → 立即回填，切回 0 延迟显示；否则清空等待重拉。
      // 无论是否命中都置 needsReload，由 ensureLoaded 触发一次后台刷新（SWR）。
      const cached = newPath ? logCache.get(newPath) : undefined;
      if (cached && cached.filterKey === filterKey(filter.value)) {
        commits.value = cached.commits.slice();
        graphRows.value = cached.graphRows.slice();
        page.value = cached.page;
        hasMore.value = cached.hasMore;
      } else {
        commits.value = [];
        graphRows.value = [];
        page.value = 0;
        hasMore.value = true;
      }

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
    selectionRefreshToken,
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
