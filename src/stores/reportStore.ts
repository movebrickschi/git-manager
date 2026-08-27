/**
 * Daily Report · Pinia store。
 *
 * 状态：过滤条件、加载/润色 loading、抽取结果、错误信息、当前预览 Markdown。
 *
 * 与 reportBridge 配合：调用 extract / polish / listAuthors，
 * 把结果落到响应式状态供 ReportPanel 渲染。
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { reportBridge } from "@/services/report";
import { aiBridge } from "@/services/ai";
import { useRepoStore } from "@/stores/repoStore";
import {
  normalizeRepoBranches,
  rangeAfterKindSwitch,
  toggleRepoBranch,
} from "../../shared/report/report-filter";
import {
  buildReportRepoOptions,
  defaultSelectedRepos,
  toggleRepoSelection,
} from "../../shared/report/report-repos";
import {
  DEFAULT_REPORT_FILTER,
  type AuthorSuggestion,
  type RepoBranchInfo,
  type ReportFilter,
  type ReportKind,
  type ReportResult,
} from "../../shared/report/types";
import {
  DEFAULT_REPORT_AI_SETTINGS,
  type AiSettings,
  type ReportLang,
  type ReportPolishStyle,
} from "../../shared/ai/types";

const KIND_STORAGE_KEY = "git-manager.report-kind";
const REPOS_STORAGE_KEY = "git-manager.report-repos";

function loadPersistedKind(): ReportKind {
  try {
    const raw = localStorage.getItem(KIND_STORAGE_KEY);
    if (raw === "weekly" || raw === "daily") return raw;
  } catch {
    // localStorage 不可用（测试 / SSR）时回退日报
  }
  return "daily";
}

function persistKind(kind: ReportKind): void {
  try {
    localStorage.setItem(KIND_STORAGE_KEY, kind);
  } catch {
    // ignore
  }
}

interface PersistedRepoFilter {
  repos: string[];
  branchByRepo?: Record<string, string[]>;
}

function parsePersistedBranchByRepo(raw: unknown): Record<string, string[]> {
  const branches: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return branches;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const list = normalizeRepoBranches(value);
    if (list.length > 0) branches[key] = list;
  }
  return branches;
}

function loadPersistedRepoFilter(): PersistedRepoFilter | null {
  try {
    const raw = localStorage.getItem(REPOS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const repos = (parsed as { repos?: unknown }).repos;
    if (!Array.isArray(repos)) return null;
    return {
      repos: repos.filter((x): x is string => typeof x === "string" && x.length > 0),
      branchByRepo: parsePersistedBranchByRepo((parsed as { branchByRepo?: unknown }).branchByRepo),
    };
  } catch {
    return null;
  }
}

function persistRepoFilter(repos: string[], branchByRepo?: Record<string, string[]>): void {
  try {
    localStorage.setItem(
      REPOS_STORAGE_KEY,
      JSON.stringify({ repos, branchByRepo: branchByRepo ?? {} })
    );
  } catch {
    // ignore
  }
}

export const useReportStore = defineStore("report", () => {
  const repoStore = useRepoStore();

  // 持久于本会话内存；切换 repo 不重置（用户可能想跨仓库聚合）。
  const initialKind = loadPersistedKind();
  const filter = ref<ReportFilter>({
    ...DEFAULT_REPORT_FILTER,
    repos: [],
    branches: [],
    branchByRepo: {},
    authors: [],
    includeKeywords: [],
    excludeKeywords: [],
    kind: initialKind,
    range: {
      preset: initialKind === "weekly" ? "this-week" : DEFAULT_REPORT_FILTER.range.preset,
    },
  });

  /** 只在首次进入日报时自动填仓库勾选；之后用户取消全部也不再强行勾回一个。 */
  const reposInitialized = ref(false);

  const authors = ref<AuthorSuggestion[]>([]);
  const authorsLoading = ref(false);

  /** 各仓库的分支信息（含当前分支），用于 UI 下拉。 */
  const branchesByRepo = ref<Record<string, RepoBranchInfo>>({});
  const branchesLoading = ref(false);

  const extracting = ref(false);
  const polishing = ref(false);

  const result = ref<ReportResult | null>(null);
  /** 用户可编辑的预览 Markdown；初始 = result.markdown，润色后会替换。 */
  const previewMarkdown = ref<string>("");

  const errorMsg = ref<string | null>(null);

  // 润色独立配置（与 ai-settings.json 中 report 子段同 schema）。
  const polishStyle = ref<ReportPolishStyle>("formal");
  const polishLang = ref<ReportLang>("auto");
  /**
   * 用户自定义提示词。
   * - 启动 / panel 挂载时调 `loadPolishConfig()` 从 ai-settings.json 拉取
   * - 用户编辑后调 `savePolishConfig()` 写回（与 commit 共用同一份配置文件）
   */
  const customPrompt = ref<string>("");
  const polishConfigLoaded = ref(false);
  const polishConfigSaving = ref(false);

  const hasResult = computed(() => result.value !== null);

  /** 已打开 tab + 最近打开；勾选互不排斥。 */
  const selectableRepos = computed(() =>
    buildReportRepoOptions({
      openRepos: repoStore.repos,
      recentRepos: repoStore.recentRepos,
    })
  );

  const allOpenReposChecked = computed(() => {
    const openPaths = selectableRepos.value.filter((r) => r.open).map((r) => r.path);
    const targets =
      openPaths.length > 0 ? openPaths : selectableRepos.value.map((r) => r.path);
    return targets.length > 0 && targets.every((p) => filter.value.repos.includes(p));
  });

  function persistCurrentRepoFilter() {
    persistRepoFilter(filter.value.repos, filter.value.branchByRepo);
  }

  /** 首次使用：持久化勾选 ∩ 可选列表，否则默认勾上全部已打开仓库。 */
  function syncReposFromActive() {
    if (reposInitialized.value) return;
    reposInitialized.value = true;
    const options = selectableRepos.value;
    const persisted = loadPersistedRepoFilter();
    const selected = defaultSelectedRepos({
      openPaths: options.filter((r) => r.open).map((r) => r.path),
      availablePaths: options.map((r) => r.path),
      persisted: persisted?.repos ?? null,
    });
    if (selected.length > 0) {
      filter.value.repos = selected;
    } else if (repoStore.activeRepo) {
      filter.value.repos = [repoStore.activeRepo.path];
    }
    if (persisted?.branchByRepo && Object.keys(persisted.branchByRepo).length > 0) {
      filter.value.branchByRepo = {
        ...(filter.value.branchByRepo ?? {}),
        ...persisted.branchByRepo,
      };
    }
    persistCurrentRepoFilter();
  }

  function toggleRepo(path: string, checked: boolean) {
    filter.value.repos = toggleRepoSelection(filter.value.repos, path, checked);
    persistCurrentRepoFilter();
  }

  /** 「全部」只覆盖当前已打开的 tab；最近打开的仓库需单独勾选。 */
  function toggleAllOpenRepos() {
    const openPaths = selectableRepos.value.filter((r) => r.open).map((r) => r.path);
    const targets =
      openPaths.length > 0 ? openPaths : selectableRepos.value.map((r) => r.path);
    const allChecked =
      targets.length > 0 && targets.every((p) => filter.value.repos.includes(p));
    if (allChecked) {
      const drop = new Set(targets);
      filter.value.repos = filter.value.repos.filter((p) => !drop.has(p));
    } else {
      const set = new Set(filter.value.repos);
      for (const p of targets) set.add(p);
      filter.value.repos = [...set];
    }
    persistCurrentRepoFilter();
  }

  let authorsLoadSeq = 0;
  let branchesLoadSeq = 0;

  async function loadAuthors() {
    syncReposFromActive();
    const seq = ++authorsLoadSeq;
    const repos = [...filter.value.repos];
    if (repos.length === 0) {
      if (seq === authorsLoadSeq) authors.value = [];
      return;
    }
    authorsLoading.value = true;
    try {
      const list = await reportBridge.listAuthors(repos);
      if (seq !== authorsLoadSeq) return;
      authors.value = list;
    } catch (e: unknown) {
      if (seq !== authorsLoadSeq) return;
      const reason = e instanceof Error ? e.message : String(e);
      errorMsg.value = `加载作者失败：${reason}`;
    } finally {
      if (seq === authorsLoadSeq) authorsLoading.value = false;
    }
  }

  async function loadBranches() {
    syncReposFromActive();
    const seq = ++branchesLoadSeq;
    const repos = [...filter.value.repos];
    if (repos.length === 0) {
      if (seq === branchesLoadSeq) branchesByRepo.value = {};
      return;
    }
    branchesLoading.value = true;
    try {
      const map = await reportBridge.listBranches(repos);
      if (seq !== branchesLoadSeq) return;
      branchesByRepo.value = map;
      // 把 branchByRepo 默认填为各仓库当前分支（仅在用户没选过的情况下）
      const next: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(filter.value.branchByRepo ?? {})) {
        const list = normalizeRepoBranches(value);
        if (list.length > 0) next[key] = list;
      }
      for (const repo of repos) {
        const info = map[repo];
        if (!info?.current) continue;
        if (!next[repo] || next[repo].length === 0) next[repo] = [info.current];
      }
      filter.value.branchByRepo = next;
      persistCurrentRepoFilter();
    } catch (e: unknown) {
      if (seq !== branchesLoadSeq) return;
      const reason = e instanceof Error ? e.message : String(e);
      errorMsg.value = `加载分支失败：${reason}`;
    } finally {
      if (seq === branchesLoadSeq) branchesLoading.value = false;
    }
  }

  /** 勾选/取消某仓库的一根扫描分支；不触发 git checkout，工作区不变。 */
  function toggleBranchForRepo(repo: string, branch: string, checked: boolean) {
    const next = { ...(filter.value.branchByRepo ?? {}) };
    next[repo] = toggleRepoBranch(normalizeRepoBranches(next[repo]), branch, checked);
    filter.value.branchByRepo = next;
    persistCurrentRepoFilter();
  }

  /** 一键勾/取消该仓库全部本地分支。 */
  function toggleAllBranchesForRepo(repo: string, branches: readonly string[]) {
    const next = { ...(filter.value.branchByRepo ?? {}) };
    const current = new Set(normalizeRepoBranches(next[repo]));
    const allChecked = branches.length > 0 && branches.every((b) => current.has(b));
    next[repo] = allChecked ? [] : [...branches];
    filter.value.branchByRepo = next;
    persistCurrentRepoFilter();
  }

  /** 切换日报 / 周报；典型时间预设跟着走，自定义/按月范围保持。 */
  function setKind(kind: ReportKind) {
    const preset = rangeAfterKindSwitch(kind, filter.value.range.preset);
    filter.value.kind = kind;
    if (preset !== filter.value.range.preset) {
      filter.value.range = { preset };
    }
    persistKind(kind);
  }

  async function generate() {
    syncReposFromActive();
    if (filter.value.repos.length === 0) {
      errorMsg.value =
        filter.value.kind === "weekly"
          ? "请先打开至少一个仓库再生成周报"
          : "请先打开至少一个仓库再生成日报";
      return;
    }
    errorMsg.value = null;
    extracting.value = true;
    try {
      const res = await reportBridge.extract({ ...filter.value });
      if (res.ok) {
        result.value = res.result;
        previewMarkdown.value = res.result.markdown;
      } else {
        result.value = null;
        previewMarkdown.value = "";
        errorMsg.value = `抽取失败 (${res.code})：${res.reason}`;
      }
    } catch (e: unknown) {
      errorMsg.value = e instanceof Error ? e.message : String(e);
    } finally {
      extracting.value = false;
    }
  }

  async function polish() {
    if (!previewMarkdown.value.trim()) {
      errorMsg.value = "没有可润色的内容，请先生成";
      return;
    }
    errorMsg.value = null;
    polishing.value = true;
    try {
      const res = await reportBridge.polish({
        markdown: previewMarkdown.value,
        style: polishStyle.value,
        lang: polishLang.value,
        customPrompt: customPrompt.value || undefined,
        kind: filter.value.kind ?? "daily",
      });
      if (res.ok) {
        previewMarkdown.value = res.markdown;
      } else {
        errorMsg.value = `润色失败 (${res.code})：${res.reason}`;
      }
    } catch (e: unknown) {
      errorMsg.value = e instanceof Error ? e.message : String(e);
    } finally {
      polishing.value = false;
    }
  }

  async function loadPolishConfig() {
    if (polishConfigLoaded.value) return;
    try {
      const view = await aiBridge.getSettings();
      const r = { ...DEFAULT_REPORT_AI_SETTINGS, ...(view.report ?? {}) };
      polishStyle.value = r.style;
      polishLang.value = r.lang;
      customPrompt.value = r.customPrompt ?? "";
    } catch {
      // 设置未填或加载失败：保留默认值
    } finally {
      polishConfigLoaded.value = true;
    }
  }

  /**
   * 把当前 polish 配置（style / lang / customPrompt）写回 ai-settings.json，
   * 与 commit 共用同一份文件。apiKey 传空字符串，service 端会跳过 keychain 写入。
   */
  async function savePolishConfig() {
    polishConfigSaving.value = true;
    errorMsg.value = null;
    try {
      const view = await aiBridge.getSettings();
      const settings: AiSettings = {
        baseUrl: view.baseUrl,
        apiKey: "",
        model: view.model,
        commitStyle: view.commitStyle,
        lang: view.lang,
        timeout: view.timeout,
        maxDiffChars: view.maxDiffChars,
        report: {
          ...DEFAULT_REPORT_AI_SETTINGS,
          ...(view.report ?? {}),
          style: polishStyle.value,
          lang: polishLang.value,
          customPrompt: customPrompt.value,
        },
      };
      await aiBridge.saveSettings(settings);
    } catch (e: unknown) {
      errorMsg.value = `保存润色设置失败：${e instanceof Error ? e.message : String(e)}`;
    } finally {
      polishConfigSaving.value = false;
    }
  }

  async function abortPolish() {
    try {
      await reportBridge.abort();
    } catch {
      // ignore
    }
  }

  async function copyToClipboard(): Promise<boolean> {
    if (!previewMarkdown.value) return false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(previewMarkdown.value);
        return true;
      }
    } catch {
      // fall through
    }
    return false;
  }

  function reset() {
    result.value = null;
    previewMarkdown.value = "";
    errorMsg.value = null;
  }

  return {
    filter,
    authors,
    authorsLoading,
    branchesByRepo,
    branchesLoading,
    extracting,
    polishing,
    result,
    previewMarkdown,
    errorMsg,
    polishStyle,
    polishLang,
    customPrompt,
    polishConfigLoaded,
    polishConfigSaving,
    hasResult,
    selectableRepos,
    allOpenReposChecked,
    syncReposFromActive,
    toggleRepo,
    toggleAllOpenRepos,
    loadAuthors,
    loadBranches,
    toggleBranchForRepo,
    toggleAllBranchesForRepo,
    setKind,
    generate,
    polish,
    abortPolish,
    loadPolishConfig,
    savePolishConfig,
    copyToClipboard,
    reset,
  };
});
