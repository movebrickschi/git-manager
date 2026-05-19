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
  DEFAULT_REPORT_FILTER,
  type AuthorSuggestion,
  type RepoBranchInfo,
  type ReportFilter,
  type ReportResult,
} from "../../shared/report/types";
import {
  DEFAULT_REPORT_AI_SETTINGS,
  type AiSettings,
  type ReportLang,
  type ReportPolishStyle,
} from "../../shared/ai/types";

export const useReportStore = defineStore("report", () => {
  const repoStore = useRepoStore();

  // 持久于本会话内存；切换 repo 不重置（用户可能想跨仓库聚合）。
  const filter = ref<ReportFilter>({ ...DEFAULT_REPORT_FILTER });

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

  /** 默认把当前激活仓库注入到 filter.repos（首次使用）。 */
  function syncReposFromActive() {
    if (filter.value.repos.length === 0 && repoStore.activeRepo) {
      filter.value.repos = [repoStore.activeRepo.path];
    }
  }

  async function loadAuthors() {
    syncReposFromActive();
    if (filter.value.repos.length === 0) {
      authors.value = [];
      return;
    }
    authorsLoading.value = true;
    try {
      authors.value = await reportBridge.listAuthors(filter.value.repos);
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      errorMsg.value = `加载作者失败：${reason}`;
    } finally {
      authorsLoading.value = false;
    }
  }

  async function loadBranches() {
    syncReposFromActive();
    if (filter.value.repos.length === 0) {
      branchesByRepo.value = {};
      return;
    }
    branchesLoading.value = true;
    try {
      const map = await reportBridge.listBranches(filter.value.repos);
      branchesByRepo.value = map;
      // 把 branchByRepo 默认填为各仓库当前分支（仅在用户没选过的情况下）
      const next = { ...(filter.value.branchByRepo ?? {}) };
      for (const repo of filter.value.repos) {
        const info = map[repo];
        if (!info?.current) continue;
        if (!next[repo]) next[repo] = info.current;
      }
      filter.value.branchByRepo = next;
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      errorMsg.value = `加载分支失败：${reason}`;
    } finally {
      branchesLoading.value = false;
    }
  }

  /** 仅切换某仓库选定的分支；不触发 git checkout，工作区不变。 */
  function selectBranchForRepo(repo: string, branch: string) {
    const next = { ...(filter.value.branchByRepo ?? {}) };
    next[repo] = branch;
    filter.value.branchByRepo = next;
  }

  async function generate() {
    syncReposFromActive();
    if (filter.value.repos.length === 0) {
      errorMsg.value = "请先打开至少一个仓库再生成日报";
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
    syncReposFromActive,
    loadAuthors,
    loadBranches,
    selectBranchForRepo,
    generate,
    polish,
    abortPolish,
    loadPolishConfig,
    savePolishConfig,
    copyToClipboard,
    reset,
  };
});
