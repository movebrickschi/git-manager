<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useReportStore } from "@/stores/reportStore";
import { renderMarkdown } from "@/utils/markdown";
import { normalizeRepoBranches } from "../../../shared/report/report-filter";
import type { ReportKind, ReportRangePreset } from "../../../shared/report/types";
import type { ReportLang, ReportPolishStyle } from "../../../shared/ai/types";

const reportStore = useReportStore();

const reportKinds: { value: ReportKind; label: string }[] = [
  { value: "daily", label: "日报" },
  { value: "weekly", label: "周报" },
];

const dailyRangePresets: { value: ReportRangePreset; label: string }[] = [
  { value: "today", label: "今日" },
  { value: "yesterday", label: "昨日" },
  { value: "this-week", label: "本周" },
  { value: "last-week", label: "上周" },
  { value: "this-month", label: "本月" },
  { value: "last-month", label: "上月" },
  { value: "custom", label: "自定义" },
];

const weeklyRangePresets: { value: ReportRangePreset; label: string }[] = [
  { value: "this-week", label: "本周" },
  { value: "last-week", label: "上周" },
  { value: "this-month", label: "本月" },
  { value: "last-month", label: "上月" },
  { value: "today", label: "今日" },
  { value: "yesterday", label: "昨日" },
  { value: "custom", label: "自定义" },
];

const rangePresets = computed(() =>
  reportStore.filter.kind === "weekly" ? weeklyRangePresets : dailyRangePresets
);

const isWeekly = computed(() => reportStore.filter.kind === "weekly");

const polishStyles: { value: ReportPolishStyle; label: string }[] = [
  { value: "formal", label: "正式" },
  { value: "casual", label: "轻松" },
  { value: "bullet", label: "项目符号" },
  { value: "narrative", label: "叙事段落" },
];

const langOptions: { value: ReportLang; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "zh", label: "中文" },
  { value: "en", label: "英文" },
];

// 关键字字段（store 内是字符串数组）以单个 textarea 形式编辑，逗号分隔
const includeKeywordsText = ref("");
const excludeKeywordsText = ref("");

// 自定义范围时的本地日期输入（YYYY-MM-DD），转换为 ISO 由 watcher 完成
const customFromDate = ref("");
const customToDate = ref("");

// 多作者选择以"全部 / 当前用户 / 自选"三档表达
const authorMode = ref<"me" | "all" | "pick">("me");
const pickedAuthorEmails = ref<string[]>([]);

const copyHint = ref<string | null>(null);
const promptExpanded = ref(false);
const promptSaveHint = ref<string | null>(null);

type PreviewMode = "markdown" | "preview";
const VIEW_MODE_KEY = "git-manager.report-view-mode";

function loadInitialViewMode(): PreviewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    if (raw === "preview" || raw === "markdown") return raw;
  } catch {
    // localStorage 不可用时使用默认值
  }
  return "markdown";
}

const viewMode = ref<PreviewMode>(loadInitialViewMode());

function setViewMode(mode: PreviewMode): void {
  viewMode.value = mode;
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // 忽略写入失败
  }
}

const renderedPreviewHtml = computed(() => renderMarkdown(reportStore.previewMarkdown));

async function handleSavePolishConfig() {
  await reportStore.savePolishConfig();
  if (!reportStore.errorMsg) {
    promptSaveHint.value = "已保存（提交信息生成与日报共用同一份配置文件）";
    setTimeout(() => (promptSaveHint.value = null), 2400);
  }
}

function handleResetPrompt() {
  reportStore.customPrompt = "";
}

const selectedRepoOptions = computed(() =>
  reportStore.selectableRepos.filter((r) => reportStore.filter.repos.includes(r.path))
);

const unselectedOpenRepos = computed(() =>
  reportStore.selectableRepos.filter((r) => r.open && !reportStore.filter.repos.includes(r.path))
);

const unselectedRecentRepos = computed(() =>
  reportStore.selectableRepos.filter((r) => !r.open && !reportStore.filter.repos.includes(r.path))
);

const hasUnselectedRepos = computed(
  () => unselectedOpenRepos.value.length + unselectedRecentRepos.value.length > 0
);

function onKindChange(kind: ReportKind) {
  reportStore.setKind(kind);
}

function onPresetChange(preset: ReportRangePreset) {
  reportStore.filter.range = {
    preset,
    fromISO: preset === "custom" ? reportStore.filter.range.fromISO : undefined,
    toISO: preset === "custom" ? reportStore.filter.range.toISO : undefined,
  };
}

watch(
  [customFromDate, customToDate],
  ([f, t]) => {
    if (reportStore.filter.range.preset !== "custom") return;
    reportStore.filter.range = {
      preset: "custom",
      fromISO: f ? new Date(f + "T00:00:00").toISOString() : undefined,
      toISO: t ? new Date(t + "T23:59:59.999").toISOString() : undefined,
    };
  }
);

function parseCsv(s: string): string[] {
  return s
    .split(/[,\u3001\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

watch(includeKeywordsText, (v) => {
  reportStore.filter.includeKeywords = parseCsv(v);
});
watch(excludeKeywordsText, (v) => {
  reportStore.filter.excludeKeywords = parseCsv(v);
});

watch(
  [authorMode, pickedAuthorEmails],
  ([mode, picked]) => {
    if (mode === "me") reportStore.filter.authors = [];
    else if (mode === "all") reportStore.filter.authors = ["*"];
    else reportStore.filter.authors = [...picked];
  },
  { deep: true }
);

async function handleGenerate() {
  await reportStore.generate();
}

async function handlePolish() {
  await reportStore.polish();
}

async function handleCopy() {
  const ok = await reportStore.copyToClipboard();
  copyHint.value = ok ? "已复制到剪贴板" : "复制失败（请手动选择 Ctrl+C）";
  setTimeout(() => (copyHint.value = null), 2400);
}

function handleExport() {
  const blob = new Blob([reportStore.previewMarkdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${isWeekly.value ? "weekly" : "daily"}-report-${stamp}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

onMounted(async () => {
  document.addEventListener("click", onDocClick);
  reportStore.syncReposFromActive();
  await Promise.all([
    reportStore.loadAuthors(),
    reportStore.loadBranches(),
    reportStore.loadPolishConfig(),
  ]);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
});

watch(
  () => reportStore.filter.repos,
  async (repos) => {
    if (repos.length > 0) {
      await Promise.all([reportStore.loadAuthors(), reportStore.loadBranches()]);
    }
  },
  { deep: true }
);

function branchOptionsFor(repoPath: string): string[] {
  const info = reportStore.branchesByRepo[repoPath];
  return info?.branches ?? [];
}

function selectedBranchesFor(repoPath: string): string[] {
  return normalizeRepoBranches(reportStore.filter.branchByRepo?.[repoPath]);
}

function branchSummary(repoPath: string): string {
  const selected = selectedBranchesFor(repoPath);
  const current = reportStore.branchesByRepo[repoPath]?.current;
  if (selected.length === 0) {
    return current ? `${current}（当前）` : "选择分支";
  }
  if (selected.length === 1) {
    return selected[0] === current ? `${selected[0]}（当前）` : (selected[0] ?? "选择分支");
  }
  return `${selected.length} 个分支`;
}

function allBranchesChecked(repoPath: string): boolean {
  const options = branchOptionsFor(repoPath);
  const selected = new Set(selectedBranchesFor(repoPath));
  return options.length > 0 && options.every((b) => selected.has(b));
}

const branchPickerRepo = ref<string | null>(null);
const pickerMenuStyle = ref<Record<string, string>>({});
const repoAddOpen = ref(false);
const repoAddStyle = ref<Record<string, string>>({});

function menuStyleFromEvent(e: MouseEvent, menuWidth: number): Record<string, string> {
  const btn = e.currentTarget as HTMLElement;
  const rect = btn.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - menuWidth - 8);
  return {
    top: `${rect.bottom + 2}px`,
    left: `${Math.max(8, left)}px`,
  };
}

function togglePicker(repoPath: string, e: MouseEvent) {
  repoAddOpen.value = false;
  if (branchPickerRepo.value === repoPath) {
    branchPickerRepo.value = null;
    return;
  }
  pickerMenuStyle.value = menuStyleFromEvent(e, 240);
  branchPickerRepo.value = repoPath;
}

function toggleRepoAdd(e: MouseEvent) {
  branchPickerRepo.value = null;
  if (repoAddOpen.value) {
    repoAddOpen.value = false;
    return;
  }
  repoAddStyle.value = menuStyleFromEvent(e, 260);
  repoAddOpen.value = true;
}

function addRepo(path: string) {
  reportStore.toggleRepo(path, true);
}

function removeRepo(path: string) {
  reportStore.toggleRepo(path, false);
}

function onDocClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (t?.closest(".branch-picker") || t?.closest(".repo-add")) return;
  branchPickerRepo.value = null;
  repoAddOpen.value = false;
}
</script>

<template>
  <div class="report-panel">
    <!-- 顶部过滤栏 -->
    <header class="filter-bar">
      <!-- 模式 + 时间范围 -->
      <div class="filter-row">
        <label class="filter-label">模式</label>
        <div class="preset-group" role="tablist" aria-label="报告模式">
          <button
            v-for="k in reportKinds"
            :key="k.value"
            class="chip"
            :class="{ active: (reportStore.filter.kind ?? 'daily') === k.value }"
            role="tab"
            :aria-selected="(reportStore.filter.kind ?? 'daily') === k.value"
            @click="onKindChange(k.value)"
          >
            {{ k.label }}
          </button>
        </div>
        <label class="filter-label">时间</label>
        <div class="preset-group">
          <button
            v-for="p in rangePresets"
            :key="p.value"
            class="chip"
            :class="{ active: reportStore.filter.range.preset === p.value }"
            @click="onPresetChange(p.value)"
          >
            {{ p.label }}
          </button>
        </div>
        <div v-if="reportStore.filter.range.preset === 'custom'" class="custom-range">
          <input v-model="customFromDate" type="date" />
          <span class="dash">→</span>
          <input v-model="customToDate" type="date" />
        </div>
      </div>

      <!-- 作者 -->
      <div class="filter-row">
        <label class="filter-label">作者</label>
        <div class="preset-group">
          <button
            class="chip"
            :class="{ active: authorMode === 'me' }"
            @click="authorMode = 'me'"
          >
            仅我
          </button>
          <button
            class="chip"
            :class="{ active: authorMode === 'all' }"
            @click="authorMode = 'all'"
          >
            全部
          </button>
          <button
            class="chip"
            :class="{ active: authorMode === 'pick' }"
            @click="authorMode = 'pick'"
          >
            指定
          </button>
        </div>
        <div v-if="authorMode === 'pick'" class="picker">
          <div v-if="reportStore.authorsLoading" class="hint">加载作者…</div>
          <div v-else-if="reportStore.authors.length === 0" class="hint">暂无作者建议</div>
          <label
            v-for="a in reportStore.authors"
            :key="a.email"
            class="picker-item"
          >
            <input
              type="checkbox"
              :value="a.email"
              v-model="pickedAuthorEmails"
            />
            <span>{{ a.name }} &lt;{{ a.email }}&gt;</span>
            <span class="count">×{{ a.count }}</span>
          </label>
        </div>
      </div>

      <!-- 仓库：已选以标签展示，未选收入下拉 -->
      <div class="filter-row filter-row-repos">
        <label class="filter-label">仓库</label>
        <div class="repo-list">
          <div v-for="r in selectedRepoOptions" :key="r.path" class="repo-item-row">
            <span class="repo-dot" :style="{ background: r.color }"></span>
            <span class="repo-name">{{ r.name }}</span>
            <div class="branch-picker">
              <button
                type="button"
                class="branch-picker-btn"
                :disabled="reportStore.branchesLoading"
                :title="`仓库 ${r.name} 的扫描分支（可多选，不会切换工作区）`"
                :aria-expanded="branchPickerRepo === r.path"
                aria-haspopup="listbox"
                @click.stop="togglePicker(r.path, $event)"
              >
                {{ branchSummary(r.path) }}
              </button>
              <div
                v-if="branchPickerRepo === r.path"
                class="branch-picker-menu"
                :style="pickerMenuStyle"
                role="listbox"
                :aria-label="`${r.name} 扫描分支`"
              >
                <label
                  v-if="branchOptionsFor(r.path).length > 0"
                  class="branch-picker-item"
                >
                  <input
                    type="checkbox"
                    :checked="allBranchesChecked(r.path)"
                    @change="
                      reportStore.toggleAllBranchesForRepo(
                        r.path,
                        branchOptionsFor(r.path)
                      )
                    "
                  />
                  全部
                </label>
                <label
                  v-for="b in branchOptionsFor(r.path)"
                  :key="b"
                  class="branch-picker-item"
                >
                  <input
                    type="checkbox"
                    :checked="selectedBranchesFor(r.path).includes(b)"
                    @change="
                      (e) =>
                        reportStore.toggleBranchForRepo(
                          r.path,
                          b,
                          (e.target as HTMLInputElement).checked
                        )
                    "
                  />
                  <span>{{ b }}</span>
                  <span
                    v-if="b === reportStore.branchesByRepo[r.path]?.current"
                    class="count"
                  >
                    当前
                  </span>
                </label>
                <div v-if="branchOptionsFor(r.path).length === 0" class="hint">
                  {{ reportStore.branchesLoading ? "加载中…" : "无可用分支" }}
                </div>
              </div>
            </div>
            <button
              type="button"
              class="repo-remove"
              :title="`移除 ${r.name}`"
              @click="removeRepo(r.path)"
            >
              ×
            </button>
          </div>
          <div v-if="hasUnselectedRepos" class="repo-add">
            <button
              type="button"
              class="repo-add-btn"
              :aria-expanded="repoAddOpen"
              aria-haspopup="listbox"
              title="从已打开或最近打开的仓库中添加"
              @click.stop="toggleRepoAdd($event)"
            >
              添加仓库
            </button>
            <div
              v-if="repoAddOpen"
              class="repo-add-menu"
              :style="repoAddStyle"
              role="listbox"
              aria-label="添加扫描仓库"
            >
              <div v-if="unselectedOpenRepos.length > 0" class="repo-group-label">
                已打开
              </div>
              <button
                v-for="r in unselectedOpenRepos"
                :key="r.path"
                type="button"
                class="repo-add-item"
                @click="addRepo(r.path)"
              >
                <span class="repo-dot" :style="{ background: r.color }"></span>
                <span>{{ r.name }}</span>
              </button>
              <div v-if="unselectedRecentRepos.length > 0" class="repo-group-label">
                最近打开
              </div>
              <button
                v-for="r in unselectedRecentRepos"
                :key="r.path"
                type="button"
                class="repo-add-item"
                @click="addRepo(r.path)"
              >
                <span class="repo-dot" :style="{ background: r.color }"></span>
                <span>{{ r.name }}</span>
              </button>
              <button
                v-if="unselectedOpenRepos.length > 0"
                type="button"
                class="repo-add-item repo-add-all"
                @click="reportStore.toggleAllOpenRepos()"
              >
                勾选全部已打开
              </button>
            </div>
          </div>
          <div v-if="reportStore.selectableRepos.length === 0" class="hint">
            尚未打开任何仓库
          </div>
          <div
            v-else-if="selectedRepoOptions.length === 0"
            class="hint"
          >
            点「添加仓库」选择要扫描的项目
          </div>
        </div>
      </div>

      <!-- 关键字 -->
      <div class="filter-row">
        <label class="filter-label">包含关键字</label>
        <input
          v-model="includeKeywordsText"
          class="text-input"
          placeholder="逗号分隔，命中其一即保留"
        />
        <label class="filter-label">排除</label>
        <input
          v-model="excludeKeywordsText"
          class="text-input"
          placeholder="逗号分隔"
        />
      </div>

      <!-- 选项 -->
      <div class="filter-row">
        <label class="check-inline">
          <input v-model="reportStore.filter.excludeMerge" type="checkbox" />
          排除合并
        </label>
        <label class="check-inline">
          <input v-model="reportStore.filter.excludeRevert" type="checkbox" />
          排除反做
        </label>
        <label class="check-inline">
          <input v-model="reportStore.filter.dedupMessage" type="checkbox" />
          消息去重
        </label>
        <button
          class="primary-btn"
          :disabled="reportStore.extracting"
          @click="handleGenerate"
        >
          {{
            reportStore.extracting
              ? "生成中…"
              : isWeekly
                ? "🚀 生成周报"
                : "🚀 生成日报"
          }}
        </button>
      </div>
    </header>

    <!-- 错误条 -->
    <div v-if="reportStore.errorMsg" class="error-banner">
      ⚠ {{ reportStore.errorMsg }}
    </div>

    <!-- 主体：预览 -->
    <section v-if="reportStore.hasResult" class="preview-area">
      <div class="preview-toolbar">
        <span class="stat">
          共 <b>{{ reportStore.result?.totalCommits }}</b> 条提交
          / <b>{{ reportStore.result?.groups.length }}</b> 个项目
        </span>
        <div
          class="view-mode-group"
          role="tablist"
          aria-label="预览模式切换"
        >
          <button
            class="view-mode-btn"
            :class="{ active: viewMode === 'preview' }"
            role="tab"
            :aria-selected="viewMode === 'preview'"
            title="渲染 Markdown"
            @click="setViewMode('preview')"
          >
            预览
          </button>
          <button
            class="view-mode-btn"
            :class="{ active: viewMode === 'markdown' }"
            role="tab"
            :aria-selected="viewMode === 'markdown'"
            title="编辑 Markdown 源码"
            @click="setViewMode('markdown')"
          >
            Markdown
          </button>
        </div>
        <div class="spacer"></div>
        <div class="polish-group" title="以下选项仅在点击「AI 润色」时生效">
          <span class="polish-label">✨ 润色为</span>
          <select v-model="reportStore.polishStyle" class="select-mini">
            <option v-for="s in polishStyles" :key="s.value" :value="s.value">
              {{ s.label }}
            </option>
          </select>
          <select v-model="reportStore.polishLang" class="select-mini">
            <option v-for="l in langOptions" :key="l.value" :value="l.value">
              {{ l.label }}
            </option>
          </select>
          <button
            class="secondary-btn polish-btn"
            :disabled="reportStore.polishing || !reportStore.previewMarkdown"
            @click="handlePolish"
          >
            {{ reportStore.polishing ? "润色中…" : "AI 润色" }}
          </button>
          <button
            v-if="reportStore.polishing"
            class="secondary-btn"
            @click="reportStore.abortPolish"
          >
            取消
          </button>
          <button
            class="link-btn"
            :title="promptExpanded ? '收起自定义提示词' : '展开自定义提示词'"
            @click="promptExpanded = !promptExpanded"
          >
            {{ promptExpanded ? "▾ 提示词" : "▸ 提示词" }}
          </button>
        </div>
        <button class="secondary-btn" @click="handleCopy">📋 复制</button>
        <button class="secondary-btn" @click="handleExport">💾 导出 .md</button>
      </div>

      <!-- 自定义提示词面板（折叠区域） -->
      <div v-if="promptExpanded" class="prompt-panel">
        <div class="prompt-header">
          <span class="prompt-title">自定义润色提示词</span>
          <span class="prompt-hint">
            非空时追加到系统提示词末尾（优先级高于固定模板规则）
          </span>
        </div>
        <textarea
          v-model="reportStore.customPrompt"
          class="prompt-textarea"
          spellcheck="false"
          autocomplete="off"
          rows="4"
          placeholder="例如：&#10;- 每条加上工时估算（小时）&#10;- 强调线上影响范围&#10;- 用第一人称叙述&#10;- 每个项目末尾给一行风险提示"
        ></textarea>
        <div class="prompt-actions">
          <button
            class="secondary-btn"
            :disabled="reportStore.polishConfigSaving"
            @click="handleSavePolishConfig"
          >
            {{ reportStore.polishConfigSaving ? "保存中…" : "💾 保存（持久化）" }}
          </button>
          <button class="link-btn" @click="handleResetPrompt">清空</button>
          <span v-if="promptSaveHint" class="prompt-save-hint">{{ promptSaveHint }}</span>
        </div>
      </div>
      <textarea
        v-show="viewMode === 'markdown'"
        v-model="reportStore.previewMarkdown"
        class="preview-editor"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
      ></textarea>
      <div
        v-show="viewMode === 'preview'"
        class="preview-rendered"
        v-html="renderedPreviewHtml"
      ></div>
      <div v-if="copyHint" class="copy-toast">{{ copyHint }}</div>
    </section>

    <section v-else class="empty-area">
      <div class="empty-tip">
        <div class="empty-icon">📅</div>
        <div>
          {{
            isWeekly
              ? "周报按「仓库 → 日期 → 模块」汇总本周提交，默认时间为本周"
              : "选择时间范围、作者、仓库后点「生成日报」"
          }}
        </div>
        <div class="empty-sub">
          AI 润色与提交信息生成共用同一份 API 密钥（设置面板配置）
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.report-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-background);
}

.filter-bar {
  padding: 8px 12px;
  background: var(--color-surface-muted);
  border-bottom: 1px solid var(--color-divider);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.filter-label {
  font-size: 12px;
  color: var(--color-foreground-muted);
  min-width: 56px;
}

.preset-group {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--color-surface-emphasis);
  border-radius: var(--radius-md);
}

.chip {
  font-size: 12px;
  min-height: 22px;
  padding: 2px 9px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-foreground-muted);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 120ms ease;
}

.chip.active {
  background: color-mix(in srgb, var(--color-primary) 14%, var(--color-surface-raised));
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 24%, transparent);
}

.custom-range {
  display: flex;
  align-items: center;
  gap: 4px;
}

.custom-range input[type="date"] {
  font-size: 12px;
  min-height: var(--control-height-compact);
  padding: 2px 6px;
  background: var(--color-surface-emphasis);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.dash {
  color: var(--color-foreground-muted);
}

.picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 80px;
  overflow-y: auto;
  flex: 1;
  background: var(--color-surface-emphasis);
  padding: 4px 6px;
  border-radius: var(--radius-md);
}

.picker-item {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.picker-item .count {
  color: var(--color-foreground-muted);
  font-size: 11px;
}

.filter-row-repos {
  align-items: flex-start;
  width: 100%;
}

.repo-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  flex: 1;
  min-width: 0;
}

.repo-group-label {
  font-size: 11px;
  color: var(--color-foreground-muted);
  padding: 6px 10px 2px;
}

.repo-name {
  font-size: 12px;
  max-width: 132px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-item-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 1px 4px 1px 8px;
  background: var(--color-surface-emphasis);
  border-radius: var(--radius-md);
}

.repo-remove {
  font-size: 14px;
  line-height: 1;
  min-width: 18px;
  min-height: 18px;
  padding: 0;
  color: var(--color-foreground-muted);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.repo-remove:hover {
  color: var(--color-foreground);
  background: var(--color-surface-hover);
}

.repo-add {
  position: relative;
}

.repo-add-btn {
  font-size: 12px;
  min-height: 24px;
  padding: 1px 10px;
  color: var(--color-primary);
  background: transparent;
  border: 1px dashed color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
  border-radius: var(--radius-md);
  cursor: pointer;
}

.repo-add-btn:hover {
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}

.repo-add-menu {
  position: fixed;
  z-index: 50;
  min-width: 220px;
  max-width: 280px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  padding: 4px 0;
}

.repo-add-item {
  width: 100%;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  color: var(--color-foreground);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
}

.repo-add-item:hover {
  background: var(--color-surface-hover);
}

.repo-add-all {
  margin-top: 2px;
  border-top: 1px solid var(--color-divider);
  color: var(--color-primary);
}

.branch-picker {
  position: relative;
  flex-shrink: 0;
}

.branch-picker-btn {
  font-size: 11px;
  min-height: 20px;
  max-width: 160px;
  padding: 1px 7px;
  background: var(--color-surface-raised);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-picker-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.branch-picker-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.branch-picker-menu {
  position: fixed;
  z-index: 50;
  min-width: 220px;
  max-width: 320px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  padding: 4px 0;
}

.branch-picker-item {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  cursor: pointer;
}

.branch-picker-item:hover {
  background: var(--color-surface-hover);
}

.branch-picker-item .count {
  color: var(--color-foreground-muted);
  font-size: 11px;
}

.repo-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.repo-add-item span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text-input {
  flex: 1;
  font-size: 12px;
  min-height: var(--control-height-compact);
  padding: 2px 8px;
  background: var(--color-surface-emphasis);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  min-width: 120px;
}

.check-inline {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.hint {
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.primary-btn {
  margin-left: auto;
  font-size: 12px;
  min-height: var(--control-height-regular);
  padding: 4px 14px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.primary-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.secondary-btn {
  font-size: 12px;
  min-height: var(--control-height-compact);
  padding: 3px 10px;
  background: var(--color-surface-emphasis);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.secondary-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.secondary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-banner {
  padding: 6px 14px;
  background: var(--color-surface-error);
  color: var(--color-error);
  font-size: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-error) 25%, transparent);
}

.preview-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.preview-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-height: var(--panel-header-height);
  padding: 4px 12px;
  background: var(--color-surface-muted);
}

.stat {
  font-size: 12px;
  color: var(--color-foreground-muted);
}

.spacer {
  flex: 1;
}

.select-mini {
  font-size: 12px;
  min-height: var(--control-height-compact);
  padding: 2px 6px;
  background: var(--color-surface-emphasis);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.polish-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 6px;
  background: color-mix(in srgb, var(--color-primary) 7%, var(--color-surface-emphasis));
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-md);
}

.polish-label {
  font-size: 11px;
  color: var(--color-foreground-muted);
  padding-right: 2px;
}

.polish-btn {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}

.polish-btn:disabled {
  opacity: 0.55;
}

.link-btn {
  font-size: 12px;
  color: var(--color-foreground-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  min-height: var(--control-height-compact);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.link-btn:hover {
  color: var(--color-foreground);
  background: var(--color-surface-hover);
}

.prompt-panel {
  padding: 8px 14px 10px;
  background: var(--color-surface-emphasis);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prompt-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.prompt-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-foreground);
}

.prompt-hint {
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.prompt-textarea {
  font-family: ui-monospace, "SF Mono", Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.5;
  padding: 6px 8px;
  background: var(--color-surface-raised);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  resize: vertical;
}

.prompt-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prompt-save-hint {
  font-size: 11px;
  color: #2e9a59;
}

.preview-editor {
  flex: 1;
  resize: none;
  border: none;
  outline: none;
  padding: 14px 18px;
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: ui-monospace, "SF Mono", Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.view-mode-group {
  display: inline-flex;
  margin-left: 8px;
  gap: 2px;
  padding: 2px;
  background: var(--color-surface-emphasis);
  border-radius: var(--radius-md);
}

.view-mode-btn {
  font-size: 11px;
  min-height: 22px;
  padding: 2px 10px;
  background: transparent;
  color: var(--color-foreground-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 120ms ease;
}

.view-mode-btn:last-child {
  border-right: 1px solid transparent;
}

.view-mode-btn:hover:not(.active) {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.view-mode-btn.active {
  background: color-mix(in srgb, var(--color-primary) 14%, var(--color-surface-raised));
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 24%, transparent);
}

.preview-rendered {
  flex: 1;
  overflow: auto;
  padding: 14px 18px;
  background: var(--color-background);
  color: var(--color-foreground);
  font-size: 13px;
  line-height: 1.7;
  /* 覆盖 #app 全局的 user-select: none，让用户可以在 Preview 中选中复制 */
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.preview-rendered :deep(*) {
  user-select: text;
  -webkit-user-select: text;
}

.preview-rendered :deep(h1),
.preview-rendered :deep(h2),
.preview-rendered :deep(h3),
.preview-rendered :deep(h4),
.preview-rendered :deep(h5),
.preview-rendered :deep(h6) {
  margin: 18px 0 8px;
  font-weight: 600;
  line-height: 1.3;
}

.preview-rendered :deep(h1) {
  font-size: 22px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-divider);
}

.preview-rendered :deep(h2) {
  font-size: 18px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--color-divider);
}

.preview-rendered :deep(h3) {
  font-size: 16px;
}

.preview-rendered :deep(h4) {
  font-size: 14px;
}

.preview-rendered :deep(p) {
  margin: 8px 0;
}

.preview-rendered :deep(ul),
.preview-rendered :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

/* 嵌套列表更紧凑，并切换到空心圆点以体现层级 */
.preview-rendered :deep(ul ul),
.preview-rendered :deep(ol ul),
.preview-rendered :deep(ul ol),
.preview-rendered :deep(ol ol) {
  margin: 2px 0 6px;
  padding-left: 22px;
}

.preview-rendered :deep(ul) {
  list-style: disc outside;
}

.preview-rendered :deep(ul ul) {
  list-style: circle outside;
}

.preview-rendered :deep(ul ul ul) {
  list-style: square outside;
}

.preview-rendered :deep(li) {
  margin: 2px 0;
}

.preview-rendered :deep(code) {
  font-family: ui-monospace, "SF Mono", Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  padding: 1px 5px;
  background: var(--color-surface-muted);
  border-radius: var(--radius-sm);
}

.preview-rendered :deep(pre) {
  margin: 10px 0;
  padding: 10px 12px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow-x: auto;
}

.preview-rendered :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 12px;
  line-height: 1.5;
}

.preview-rendered :deep(blockquote) {
  margin: 8px 0;
  padding: 6px 12px;
  border-left: 3px solid var(--color-primary);
  background: var(--color-surface-muted);
  color: var(--color-foreground-muted);
}

.preview-rendered :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-divider);
  margin: 14px 0;
}

.preview-rendered :deep(a) {
  color: var(--color-primary);
  text-decoration: none;
}

.preview-rendered :deep(a:hover) {
  text-decoration: underline;
}

.preview-rendered :deep(strong) {
  font-weight: 600;
}

.copy-toast {
  position: absolute;
  bottom: 12px;
  right: 14px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  color: var(--color-foreground);
  padding: 6px 12px;
  font-size: 12px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
}

.empty-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-tip {
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

.empty-icon {
  font-size: 36px;
  margin-bottom: 8px;
}

.empty-sub {
  margin-top: 8px;
  font-size: 11px;
  opacity: 0.6;
}
</style>
