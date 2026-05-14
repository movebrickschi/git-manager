<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import { onClickOutside } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { useCommitStore } from "@/stores/commitStore";
import { useFilterStore } from "@/stores/filterStore";
import { useRepoStore } from "@/stores/repoStore";
import { commands } from "@/utils/commands";
import type { DiffResult, FileStatus } from "@/utils/commands";
import DiffViewer from "@/components/diff/DiffViewer.vue";
import ContextMenu from "@/components/common/ContextMenu.vue";
import type { MenuItem } from "@/components/common/ContextMenu.vue";
import PushDialog from "@/components/common/PushDialog.vue";
import AiSettingsDialog from "@/components/commit/AiSettingsDialog.vue";
import { errMsg } from "@/utils/error";
import { useBulkActions } from "@/composables/useBulkActions";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useFilterRules } from "@/composables/useFilterRules";
import { useMergeState } from "@/composables/useMergeState";
import { useMultiSelect } from "@/composables/useMultiSelect";
import { useStatusPolling } from "@/composables/useStatusPolling";
import { useToast } from "@/composables/useToast";
import type { AiErrorCode } from "../../../shared/ai/types";
import ChangesToolbar from "./ChangesToolbar.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import FileSection, { type SectionData, type SectionKey } from "./FileSection.vue";
import FilterRulesDialog from "./FilterRulesDialog.vue";
import MergeStateBar from "./MergeStateBar.vue";

const { t } = useI18n();

const ThreeWayMerge = defineAsyncComponent(() => import("@/components/merge/ThreeWayMerge.vue"));

const commitStore = useCommitStore();
const repoStore = useRepoStore();
const filterStore = useFilterStore();

const selectedFile = ref<FileStatus | null>(null);
const selectedSection = ref<SectionKey>("unstaged");
const diffResult = ref<DiffResult | null>(null);
const loading = ref(false);
const errorMessage = ref<string | null>(null);

const { toastMessage, toastVisible, show: showToast } = useToast();
const confirmDialog = useConfirmDialog();
const filterRules = useFilterRules({
  getRepoPath: () => repoPathOrEmpty(),
  onMessage: showToast,
});

const {
  mergeState,
  mergeBusy,
  refresh: refreshMergeState,
  continueOp: onContinueMerge,
  abortOp: onAbortMerge,
} = useMergeState({
  getRepoPath: () => repoStore.activeRepo?.path,
  onAfterAction: () => commitStore.loadStatus(),
  onMessage: showToast,
});

const contextMenuRef = ref<InstanceType<typeof ContextMenu>>();
const contextFile = ref<FileStatus | null>(null);
const contextSection = ref<SectionKey>("unstaged");

const showDiffDialog = ref(false);
const diffDialogResult = ref<DiffResult | null>(null);
const diffDialogFilePath = ref("");
const diffDialogLoading = ref(false);

const showPushDialog = ref(false);
const showCommitDialog = ref(false);
const quickCommitMessage = ref("");
const quickCommitLoading = ref(false);

const showMergeDialog = ref(false);
const mergeFilePath = ref("");
const mergeConflictFiles = ref<string[]>([]);

const showAiMenu = ref(false);
const showAiSettings = ref(false);
const showAiOverwriteConfirm = ref(false);
const aiGroupRef = ref<HTMLElement | null>(null);
onClickOutside(aiGroupRef, () => {
  showAiMenu.value = false;
});

const AI_ERROR_I18N_KEY: Record<AiErrorCode, string> = {
  NO_API_KEY: "ai.err.no_api_key",
  NO_STAGED: "ai.err.no_staged",
  NETWORK: "ai.err.network",
  AUTH: "ai.err.auth",
  RATE_LIMIT: "ai.err.rate_limit",
  SERVER: "ai.err.server",
  TIMEOUT: "ai.err.timeout",
  EMPTY: "ai.err.empty",
  ABORT: "ai.err.abort",
  UNKNOWN: "ai.err.unknown",
};

function formatAiError(e: { code: AiErrorCode; reason: string }): string {
  return `${t(AI_ERROR_I18N_KEY[e.code] ?? "ai.err.unknown")}：${e.reason}`;
}

async function runAiGenerate(mode: "replace" | "append"): Promise<void> {
  showAiOverwriteConfirm.value = false;
  showAiMenu.value = false;
  await commitStore.generateMessage(mode);
  if (commitStore.aiError && commitStore.aiError.code !== "ABORT") {
    showToast(formatAiError(commitStore.aiError));
  }
}

async function handleAiMainAction(): Promise<void> {
  if (commitStore.isGeneratingAI) {
    await commitStore.cancelGenerate();
    return;
  }
  showAiMenu.value = false;
  if (commitStore.commitMessage.trim().length > 0) {
    showAiOverwriteConfirm.value = true;
    return;
  }
  await runAiGenerate("replace");
}

function handleRegenerateFromMenu(): void {
  showAiMenu.value = false;
  if (commitStore.commitMessage.trim().length > 0) {
    showAiOverwriteConfirm.value = true;
    return;
  }
  void runAiGenerate("replace");
}

function openAiSettings(): void {
  showAiMenu.value = false;
  showAiSettings.value = true;
}

function onAiSettingsSaved(): void {
  showToast(t("ai.settings.saved_toast"));
}

function useHistoryMessage(msg: string): void {
  showAiMenu.value = false;
  commitStore.commitMessage = msg;
}

function onTextareaKeydown(e: KeyboardEvent): void {
  const isPrimary = e.ctrlKey || e.metaKey;
  if (isPrimary && e.shiftKey && e.key.toLowerCase() === "g") {
    e.preventDefault();
    void handleAiMainAction();
  }
}

const COMMIT_HEIGHT_KEY = "git-manager.commit-textarea-height";
const COMMIT_HEIGHT_MIN = 56;
const COMMIT_HEIGHT_MAX = 480;

function loadInitialCommitHeight(): number {
  try {
    const raw = Number(localStorage.getItem(COMMIT_HEIGHT_KEY));
    if (Number.isFinite(raw) && raw > 0) {
      return Math.max(COMMIT_HEIGHT_MIN, Math.min(COMMIT_HEIGHT_MAX, raw));
    }
  } catch {
    // localStorage 不可用
  }
  return 72;
}

const commitTextareaHeight = ref<number>(loadInitialCommitHeight());
const isResizingCommit = ref(false);
let resizeStartY = 0;
let resizeStartHeight = 0;

function onResizeMove(e: MouseEvent): void {
  if (!isResizingCommit.value) return;
  const delta = resizeStartY - e.clientY;
  const next = Math.max(
    COMMIT_HEIGHT_MIN,
    Math.min(COMMIT_HEIGHT_MAX, resizeStartHeight + delta)
  );
  commitTextareaHeight.value = next;
}

function onResizeEnd(): void {
  if (!isResizingCommit.value) return;
  isResizingCommit.value = false;
  document.removeEventListener("mousemove", onResizeMove);
  document.removeEventListener("mouseup", onResizeEnd);
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
  try {
    localStorage.setItem(COMMIT_HEIGHT_KEY, String(commitTextareaHeight.value));
  } catch {
    // localStorage 不可用
  }
}

function startResizeCommit(e: MouseEvent): void {
  isResizingCommit.value = true;
  resizeStartY = e.clientY;
  resizeStartHeight = commitTextareaHeight.value;
  document.addEventListener("mousemove", onResizeMove);
  document.addEventListener("mouseup", onResizeEnd);
  document.body.style.userSelect = "none";
  document.body.style.cursor = "ns-resize";
  e.preventDefault();
}

function resetCommitHeight(): void {
  commitTextareaHeight.value = 72;
  try {
    localStorage.setItem(COMMIT_HEIGHT_KEY, "72");
  } catch {
    // localStorage 不可用
  }
}

function repoPathOrEmpty(): string {
  return repoStore.activeRepo?.path ?? "";
}

function filterFiles(files: FileStatus[]): { visible: FileStatus[]; hidden: number } {
  const repoPath = repoPathOrEmpty();
  if (!repoPath || filterStore.showFiltered || !filterStore.hasRules(repoPath)) {
    return { visible: files, hidden: 0 };
  }
  const visible: FileStatus[] = [];
  let hidden = 0;
  for (const f of files) {
    if (filterStore.isFiltered(repoPath, f.path)) hidden += 1;
    else visible.push(f);
  }
  return { visible, hidden };
}

const sections = computed<SectionData[]>(() => {
  const raw = [
    { key: "staged" as const, title: "已暂存", files: commitStore.stagedFiles },
    { key: "unstaged" as const, title: "未暂存", files: commitStore.unstagedFiles },
    { key: "untracked" as const, title: "未跟踪", files: commitStore.untrackedFiles },
  ];
  return raw.map((s) => {
    const { visible, hidden } = filterFiles(s.files);
    return { key: s.key, title: s.title, files: visible, hiddenCount: hidden };
  });
});

const totalCount = computed(() => sections.value.reduce((sum, s) => sum + s.files.length, 0));
const totalHiddenCount = computed(() =>
  sections.value.reduce((sum, s) => sum + s.hiddenCount, 0)
);

function makeKey(section: SectionKey, path: string): string {
  return `${section}:${path}`;
}

const flatFileKeys = computed<string[]>(() => {
  const keys: string[] = [];
  for (const s of sections.value) {
    for (const f of s.files) keys.push(makeKey(s.key, f.path));
  }
  return keys;
});

const {
  selectedKeys,
  lastClickedKey,
  selectedCount: selectedTotal,
  isSelected,
  toggle,
  selectRange: _selectRangeByKey,
  clear: clearSelection,
  removeKeys,
  toggleKeys,
} = useMultiSelect(flatFileKeys);

const selectedFilesBySection = computed(() => {
  const result = { staged: [] as string[], unstaged: [] as string[], untracked: [] as string[] };
  for (const key of selectedKeys.value) {
    const idx = key.indexOf(":");
    if (idx < 0) continue;
    const sec = key.slice(0, idx) as SectionKey;
    const path = key.slice(idx + 1);
    if (sec in result) result[sec].push(path);
  }
  return result;
});

const {
  stageablePaths,
  unstageablePaths,
  discardablePaths,
  copyablePaths,
  deletablePaths,
  bulkStage,
  bulkUnstage,
  bulkDiscard,
  bulkCopyPath,
  bulkDelete,
} = useBulkActions({
  selectedFilesBySection,
  selectedFile,
  diffResult,
  clearSelection,
  removeKeys,
  makeKey,
  onMessage: showToast,
  openConfirm: confirmDialog.open,
});

function isRowChecked(section: SectionKey, path: string): boolean {
  return isSelected(makeKey(section, path));
}

function onRowToggle(section: SectionKey, path: string): void {
  toggle(makeKey(section, path));
}

function sectionKeysOf(section: SectionData): string[] {
  return section.files.map((f) => makeKey(section.key, f.path));
}

function sectionAllChecked(section: SectionData): boolean {
  if (section.files.length === 0) return false;
  return sectionKeysOf(section).every((k) => selectedKeys.value.has(k));
}

function sectionSomeChecked(section: SectionData): boolean {
  if (section.files.length === 0) return false;
  return sectionKeysOf(section).some((k) => selectedKeys.value.has(k));
}

function onSectionToggleAll(key: SectionKey): void {
  const section = sections.value.find((s) => s.key === key);
  if (!section || section.files.length === 0) return;
  toggleKeys(sectionKeysOf(section));
}

function onRowClick(event: MouseEvent, file: FileStatus, section: SectionData): void {
  if (event.shiftKey) {
    event.preventDefault();
    _selectRangeByKey(makeKey(section.key, file.path));
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    onRowToggle(section.key, file.path);
    return;
  }
  void onSelectFile(file, section);
  lastClickedKey.value = makeKey(section.key, file.path);
}

async function onSelectFile(file: FileStatus, section: SectionData): Promise<void> {
  selectedFile.value = file;
  selectedSection.value = section.key;
  diffResult.value = null;
  if (!repoStore.activeRepo) return;
  try {
    diffResult.value = await commands.getFileDiff(
      repoStore.activeRepo.path,
      file.path,
      section.key === "staged"
    );
  } catch (e) {
    console.error("Failed to load diff:", e);
  }
}

function onContextMenu(event: MouseEvent, file: FileStatus, section: SectionData): void {
  event.preventDefault();
  event.stopPropagation();
  contextFile.value = file;
  contextSection.value = section.key;
  contextMenuRef.value?.show(event);
}

async function handleCommitAndPush(): Promise<void> {
  try {
    await commitStore.commit();
    showPushDialog.value = true;
  } catch (e: unknown) {
    console.error("Commit failed:", e);
  }
}

async function handleStageFile(): Promise<void> {
  if (!contextFile.value) return;
  await commitStore.stageFile(contextFile.value.path);
}

async function handleUnstageFile(): Promise<void> {
  if (!contextFile.value) return;
  await commitStore.unstageFile(contextFile.value.path);
}

function handleShowDiff(): void {
  if (!contextFile.value) return;
  const section = sections.value.find((s) => s.key === contextSection.value)!;
  void onSelectFile(contextFile.value, section);
}

async function handleShowDiffInDialog(): Promise<void> {
  if (!contextFile.value || !repoStore.activeRepo) return;
  diffDialogFilePath.value = contextFile.value.path;
  diffDialogLoading.value = true;
  showDiffDialog.value = true;
  try {
    diffDialogResult.value = await commands.getFileDiff(
      repoStore.activeRepo.path,
      contextFile.value.path,
      contextSection.value === "staged"
    );
  } catch (e) {
    console.error("Failed to load diff for dialog:", e);
    diffDialogResult.value = null;
  } finally {
    diffDialogLoading.value = false;
  }
}

function handleOpenQuickCommit(): void {
  if (!contextFile.value) return;
  quickCommitMessage.value = "";
  showCommitDialog.value = true;
}

async function doQuickCommit(): Promise<void> {
  if (!contextFile.value || !repoStore.activeRepo || !quickCommitMessage.value.trim()) return;
  quickCommitLoading.value = true;
  try {
    if (contextSection.value !== "staged") {
      await commands.stageFile(repoStore.activeRepo.path, contextFile.value.path);
    }
    await commands.commit(repoStore.activeRepo.path, quickCommitMessage.value.trim(), false);
    showCommitDialog.value = false;
    quickCommitMessage.value = "";
    await commitStore.loadStatus();
    showToast("提交成功");
  } catch (e: unknown) {
    showToast(`提交失败: ${errMsg(e)}`);
  } finally {
    quickCommitLoading.value = false;
  }
}

function handleDiscardChanges(): void {
  if (!contextFile.value) return;
  const filePath = contextFile.value.path;
  const ctxFile = contextFile.value;
  confirmDialog.open({
    title: "回滚更改",
    text: `确定要丢弃 "${filePath}" 的本地修改吗？此操作不可撤销。`,
    action: async () => {
      if (!repoStore.activeRepo) return;
      try {
        await commands.discardFileChanges(repoStore.activeRepo.path, ctxFile.path);
        await commitStore.loadStatus();
        if (selectedFile.value?.path === ctxFile.path) {
          selectedFile.value = null;
          diffResult.value = null;
        }
        showToast("已回滚更改");
      } catch (e: unknown) {
        showToast(`回滚失败: ${errMsg(e)}`);
      }
    },
  });
}

async function handleStashFile(): Promise<void> {
  if (!contextFile.value || !repoStore.activeRepo) return;
  try {
    const msg = `搁置 ${contextFile.value.path}`;
    await commands.stashFile(repoStore.activeRepo.path, contextFile.value.path, msg);
    await commitStore.loadStatus();
    if (selectedFile.value?.path === contextFile.value.path) {
      selectedFile.value = null;
      diffResult.value = null;
    }
    showToast("已搁置更改");
  } catch (e: unknown) {
    showToast(`搁置失败: ${errMsg(e)}`);
  }
}

async function handleCopyAsPatch(): Promise<void> {
  if (!contextFile.value || !repoStore.activeRepo) return;
  try {
    const raw = await commands.getFileDiffRaw(
      repoStore.activeRepo.path,
      contextFile.value.path,
      contextSection.value === "staged"
    );
    if (!raw.trim()) {
      showToast("没有可用的差异内容");
      return;
    }
    await navigator.clipboard.writeText(raw);
    showToast("补丁已复制到剪贴板");
  } catch (e: unknown) {
    showToast(`复制失败: ${errMsg(e)}`);
  }
}

async function handleCreatePatch(): Promise<void> {
  if (!contextFile.value || !repoStore.activeRepo) return;
  try {
    const raw = await commands.getFileDiffRaw(
      repoStore.activeRepo.path,
      contextFile.value.path,
      contextSection.value === "staged"
    );
    if (!raw.trim()) {
      showToast("没有可用的差异内容");
      return;
    }
    const safeName = contextFile.value.path.replace(/[/\\]/g, "_");
    const fileName = `${safeName}.patch`;
    const blob = new Blob([raw], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`补丁文件已下载: ${fileName}`);
  } catch (e: unknown) {
    showToast(`创建补丁失败: ${errMsg(e)}`);
  }
}

function handleDeleteFile(): void {
  if (!contextFile.value) return;
  const filePath = contextFile.value.path;
  const ctxFile = contextFile.value;
  confirmDialog.open({
    title: "删除文件",
    text: `确定要从磁盘删除 "${filePath}" 吗？此操作不可撤销。`,
    action: async () => {
      if (!repoStore.activeRepo) return;
      try {
        await commands.deleteFile(repoStore.activeRepo.path, ctxFile.path);
        await commitStore.loadStatus();
        if (selectedFile.value?.path === ctxFile.path) {
          selectedFile.value = null;
          diffResult.value = null;
        }
        showToast("文件已删除");
      } catch (e: unknown) {
        showToast(`删除失败: ${errMsg(e)}`);
      }
    },
  });
}

function handleCopyPath(): void {
  if (!contextFile.value) return;
  navigator.clipboard.writeText(contextFile.value.path);
  showToast("路径已复制");
}

function openMergeDialog(filePath: string): void {
  const allConflicted = [...commitStore.stagedFiles, ...commitStore.unstagedFiles]
    .filter((f) => f.status === "conflicted")
    .map((f) => f.path);
  mergeConflictFiles.value = allConflicted.length > 0 ? allConflicted : [filePath];
  mergeFilePath.value = filePath;
  showMergeDialog.value = true;
}

async function onMergeResolved(): Promise<void> {
  showMergeDialog.value = false;
  await commitStore.loadStatus();
}

const contextMenuItems = computed<MenuItem[]>(() => {
  if (!contextFile.value) return [];
  const section = contextSection.value;
  const items: MenuItem[] = [];

  const ctxKey = makeKey(section, contextFile.value.path);
  if (selectedTotal.value > 1 && selectedKeys.value.has(ctxKey)) {
    const n = selectedTotal.value;
    items.push({
      label: `对选中 ${n} 项 · 添加到 VCS (${stageablePaths.value.length})`,
      disabled: stageablePaths.value.length === 0,
      action: bulkStage,
    });
    items.push({
      label: `对选中 ${n} 项 · 取消暂存 (${unstageablePaths.value.length})`,
      disabled: unstageablePaths.value.length === 0,
      action: bulkUnstage,
    });
    items.push({
      label: `对选中 ${n} 项 · 回滚 (${discardablePaths.value.length})`,
      disabled: discardablePaths.value.length === 0,
      action: bulkDiscard,
    });
    items.push({
      label: `对选中 ${n} 项 · 复制路径 (${copyablePaths.value.length})`,
      disabled: copyablePaths.value.length === 0,
      action: bulkCopyPath,
    });
    items.push({
      label: `对选中 ${n} 项 · 删除文件… (${deletablePaths.value.length})`,
      disabled: deletablePaths.value.length === 0,
      action: bulkDelete,
    });
    items.push({ separator: true, label: "" });
  }

  if (contextFile.value.status === "conflicted") {
    items.push({ label: "解决冲突...", action: () => openMergeDialog(contextFile.value!.path) });
    items.push({ separator: true, label: "" });
  }

  items.push({ label: "显示差异", action: handleShowDiff });
  items.push({ label: "在新窗口中显示差异", action: handleShowDiffInDialog });
  items.push({ separator: true, label: "" });

  if (section === "unstaged" || section === "untracked") {
    items.push({ label: "添加到 VCS（暂存）", action: handleStageFile });
  }
  if (section === "staged") {
    items.push({ label: "取消暂存", action: handleUnstageFile });
  }
  items.push({ label: "提交文件…", action: handleOpenQuickCommit });
  items.push({ separator: true, label: "" });

  if (section !== "untracked") {
    items.push({ label: "回滚…", action: handleDiscardChanges });
  }
  items.push({ label: "搁置当前文件更改…", action: handleStashFile });
  items.push({ separator: true, label: "" });

  items.push({ label: "作为补丁复制到剪贴板", action: handleCopyAsPatch });
  items.push({ label: "从本地更改创建补丁…", action: handleCreatePatch });
  items.push({ separator: true, label: "" });

  items.push({ label: "删除文件…", action: handleDeleteFile });
  items.push({ label: "复制路径", action: handleCopyPath });

  return items;
});

useStatusPolling(async () => {
  if (!repoStore.activeRepo || commitStore.loading) return;
  await commitStore.loadStatus();
  await refreshMergeState();
});

onMounted(async () => {
  if (!repoStore.activeRepo) return;
  loading.value = true;
  errorMessage.value = null;
  try {
    await commitStore.loadStatus();
    await refreshMergeState();
  } catch (error: unknown) {
    errorMessage.value = `加载状态失败: ${errMsg(error)}`;
    console.error("Failed to load status:", error);
  } finally {
    loading.value = false;
  }
});

watch(
  () => repoStore.activeRepo?.path,
  async () => {
    if (!repoStore.activeRepo) return;
    loading.value = true;
    errorMessage.value = null;
    selectedFile.value = null;
    diffResult.value = null;
    clearSelection();
    try {
      await commitStore.loadStatus();
      await refreshMergeState();
    } catch (error: unknown) {
      errorMessage.value = `加载状态失败: ${errMsg(error)}`;
      console.error("Failed to load status:", error);
    } finally {
      loading.value = false;
    }
  }
);
</script>

<template>
  <div class="local-changes-view">
    <MergeStateBar
      :state="mergeState"
      :busy="mergeBusy"
      @continue="onContinueMerge"
      @abort="onAbortMerge"
    />
    <Splitpanes class="default-theme" style="height: 100%">
      <Pane :size="35" :min-size="20" :max-size="60">
        <div class="file-panel">
          <ChangesToolbar
            title="本地变更"
            :total-count="totalCount"
            :hidden-count="totalHiddenCount"
            :has-filter-rules="filterRules.hasRules.value"
            :show-filtered="filterStore.showFiltered"
            @open-filter="filterRules.open"
            @toggle-show-filtered="filterStore.toggleShowFiltered()"
            @stage-all="commitStore.stageAll()"
            @unstage-all="commitStore.unstageAll()"
            @refresh="commitStore.loadStatus()"
          />

          <div class="file-list">
            <div v-if="errorMessage" class="error-message">
              <span class="error-icon">⚠️</span> {{ errorMessage }}
            </div>
            <div v-else-if="loading" class="state-hint">加载中...</div>
            <div v-else-if="totalCount === 0" class="state-hint">工作区无变更</div>
            <template v-else>
              <FileSection
                v-for="section in sections"
                :key="section.key"
                :section="section"
                :selected-file-path="selectedFile?.path ?? null"
                :selected-section="selectedSection"
                :is-row-checked="isRowChecked"
                :section-all-checked="sectionAllChecked(section)"
                :section-some-checked="sectionSomeChecked(section)"
                @row-click="onRowClick"
                @row-toggle="onRowToggle"
                @row-context="onContextMenu"
                @section-toggle-all="onSectionToggleAll"
              />
            </template>
          </div>

          <div
            class="commit-resize-handle"
            :class="{ active: isResizingCommit }"
            role="separator"
            aria-orientation="horizontal"
            :aria-valuenow="commitTextareaHeight"
            :aria-valuemin="COMMIT_HEIGHT_MIN"
            :aria-valuemax="COMMIT_HEIGHT_MAX"
            title="拖动调整提交框高度 · 双击重置"
            @mousedown="startResizeCommit"
            @dblclick="resetCommitHeight"
          >
            <span class="commit-resize-grip" aria-hidden="true" />
          </div>
          <div class="commit-area">
            <textarea
              v-model="commitStore.commitMessage"
              class="commit-textarea"
              :placeholder="$t('ai.textarea_placeholder')"
              :style="{ height: commitTextareaHeight + 'px' }"
              @keydown="onTextareaKeydown"
            />
            <div
              v-if="showAiOverwriteConfirm"
              class="ai-confirm-bar"
              role="alertdialog"
              aria-live="polite"
            >
              <span class="ai-confirm-text">{{ $t("ai.confirm.overwrite_text") }}</span>
              <button class="ai-confirm-btn primary" @click="runAiGenerate('replace')">
                {{ $t("ai.confirm.replace") }}
              </button>
              <button class="ai-confirm-btn" @click="runAiGenerate('append')">
                {{ $t("ai.confirm.append") }}
              </button>
              <button class="ai-confirm-btn muted" @click="showAiOverwriteConfirm = false">
                {{ $t("ai.confirm.cancel") }}
              </button>
            </div>
            <div class="commit-actions">
              <label class="amend-label">
                <input type="checkbox" v-model="commitStore.isAmend" />
                <span>Amend</span>
              </label>
              <div ref="aiGroupRef" class="ai-btn-group">
                <button
                  class="ai-btn ai-btn-main"
                  :class="{ 'ai-btn-cancel': commitStore.isGeneratingAI }"
                  :disabled="
                    !commitStore.isGeneratingAI && commitStore.stagedFiles.length === 0
                  "
                  :title="
                    commitStore.isGeneratingAI
                      ? $t('ai.tip_cancel')
                      : commitStore.stagedFiles.length === 0
                        ? $t('ai.tip_need_stage')
                        : $t('ai.tip_generate')
                  "
                  @click="handleAiMainAction"
                >
                  <span v-if="commitStore.isGeneratingAI" class="ai-spinner" />
                  <span v-else aria-hidden="true">✨</span>
                  <span class="ai-btn-text">{{
                    commitStore.isGeneratingAI ? $t("ai.cancel_btn") : $t("ai.generate_btn")
                  }}</span>
                </button>
                <button
                  class="ai-btn ai-btn-chevron"
                  :disabled="commitStore.isGeneratingAI"
                  :aria-label="$t('ai.tip_more')"
                  :title="$t('ai.tip_more')"
                  @click="showAiMenu = !showAiMenu"
                >
                  ▾
                </button>
                <div v-if="showAiMenu" class="ai-menu" role="menu">
                  <button
                    :disabled="
                      commitStore.stagedFiles.length === 0 || commitStore.isGeneratingAI
                    "
                    @click="handleRegenerateFromMenu"
                  >
                    {{ $t("ai.menu.regenerate") }}
                  </button>
                  <button @click="openAiSettings">{{ $t("ai.menu.settings") }}</button>
                  <div
                    v-if="commitStore.messageHistory.length > 0"
                    class="ai-menu-divider"
                    aria-hidden="true"
                  />
                  <div v-if="commitStore.messageHistory.length > 0" class="ai-menu-section">
                    {{ $t("ai.menu.history_section") }}
                  </div>
                  <button
                    v-for="(m, idx) in commitStore.messageHistory.slice(0, 5)"
                    :key="`mh-${idx}`"
                    class="ai-menu-item-history"
                    :title="m"
                    @click="useHistoryMessage(m)"
                  >
                    {{ m.split("\n")[0] }}
                  </button>
                </div>
              </div>
              <div class="commit-btns">
                <button
                  class="commit-btn"
                  :disabled="
                    !commitStore.commitMessage.trim() || commitStore.stagedFiles.length === 0
                  "
                  @click="commitStore.commit()"
                >
                  提交
                </button>
                <button
                  class="commit-btn push-btn"
                  :disabled="
                    !commitStore.commitMessage.trim() || commitStore.stagedFiles.length === 0
                  "
                  @click="handleCommitAndPush()"
                >
                  提交并推送
                </button>
              </div>
            </div>
          </div>
        </div>
      </Pane>

      <Pane :size="65" :min-size="40">
        <div class="diff-area">
          <template v-if="selectedFile">
            <div class="diff-header">
              <span class="diff-file-path">{{ selectedFile.path }}</span>
            </div>
            <div v-if="diffResult" class="diff-content">
              <DiffViewer :diff="diffResult" />
            </div>
            <div v-else class="diff-loading">加载 Diff 中...</div>
          </template>
          <div v-else class="diff-empty">选择一个文件查看变更</div>
        </div>
      </Pane>
    </Splitpanes>

    <ContextMenu ref="contextMenuRef" :items="contextMenuItems" />

    <Teleport to="body">
      <div v-if="showDiffDialog" class="modal-overlay" @click.self="showDiffDialog = false">
        <div class="modal-dialog diff-modal">
          <div class="modal-header">
            <span class="modal-title">{{ diffDialogFilePath }}</span>
            <button class="modal-close" @click="showDiffDialog = false">✕</button>
          </div>
          <div class="modal-body">
            <div v-if="diffDialogLoading" class="modal-loading">加载中...</div>
            <div v-else-if="diffDialogResult" class="diff-modal-content">
              <DiffViewer :diff="diffDialogResult" />
            </div>
            <div v-else class="modal-loading">无差异内容</div>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showCommitDialog" class="modal-overlay" @click.self="showCommitDialog = false">
        <div class="modal-dialog commit-modal">
          <div class="modal-header">
            <span class="modal-title">提交文件：{{ contextFile?.path }}</span>
            <button class="modal-close" @click="showCommitDialog = false">✕</button>
          </div>
          <div class="modal-body">
            <textarea
              v-model="quickCommitMessage"
              class="modal-textarea"
              placeholder="输入提交信息…"
              rows="4"
              autofocus
              @keydown.ctrl.enter="doQuickCommit"
            />
            <p class="modal-hint">Ctrl+Enter 快速提交</p>
          </div>
          <div class="modal-footer">
            <button class="modal-btn" @click="showCommitDialog = false">取消</button>
            <button
              class="modal-btn primary"
              :disabled="!quickCommitMessage.trim() || quickCommitLoading"
              @click="doQuickCommit"
            >
              {{ quickCommitLoading ? "提交中…" : "提交" }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <FilterRulesDialog
      :visible="filterRules.visible.value"
      :draft="filterRules.draft.value"
      @update:draft="filterRules.draft.value = $event"
      @save="filterRules.save"
      @cancel="filterRules.close"
      @insert-example="filterRules.insertExample"
    />

    <ConfirmDialog
      :visible="confirmDialog.visible.value"
      :title="confirmDialog.title.value"
      :text="confirmDialog.text.value"
      @confirm="confirmDialog.confirm"
      @cancel="confirmDialog.cancel"
    />

    <AiSettingsDialog
      :visible="showAiSettings"
      @close="showAiSettings = false"
      @saved="onAiSettingsSaved"
    />

    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toastVisible" class="toast">{{ toastMessage }}</div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <div v-if="showMergeDialog" class="modal-overlay merge-overlay">
        <div class="merge-dialog-panel">
          <div class="merge-dialog-header">
            <span>解决合并冲突：{{ mergeFilePath }}</span>
            <button class="modal-close" @click="showMergeDialog = false">✕</button>
          </div>
          <div class="merge-dialog-body">
            <ThreeWayMerge
              :file-path="mergeFilePath"
              :conflict-files="mergeConflictFiles"
              @resolved="onMergeResolved"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>

  <PushDialog
    :visible="showPushDialog"
    :repo-path="repoStore.activeRepo?.path ?? ''"
    :repo-name="repoStore.activeRepo?.name"
    @confirm="showPushDialog = false"
    @close="showPushDialog = false"
  />
</template>

<style scoped>
.local-changes-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
}

.file-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
}

.file-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.error-message {
  padding: 12px;
  color: var(--color-error);
  background: var(--color-surface-error);
  border-left: 3px solid var(--color-error);
  display: flex;
  align-items: center;
  gap: 8px;
}

.error-icon {
  font-size: 16px;
}

.state-hint {
  padding: 16px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

.commit-area {
  flex-shrink: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.commit-textarea {
  width: 100%;
  resize: none;
  padding: 6px 8px;
  font-size: 12px;
  font-family: var(--font-sans);
  border-radius: 3px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
  box-sizing: border-box;
}

.commit-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.commit-resize-handle {
  height: 8px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ns-resize;
  border-top: 1px solid var(--color-border);
  background: transparent;
  transition: background-color 0.15s;
  user-select: none;
}

.commit-resize-handle:hover,
.commit-resize-handle.active {
  background: var(--color-surface-hover);
}

.commit-resize-grip {
  width: 40px;
  height: 3px;
  border-radius: 2px;
  background: var(--color-foreground-muted);
  opacity: 0.35;
  transition:
    background-color 0.15s,
    opacity 0.15s;
  pointer-events: none;
}

.commit-resize-handle:hover .commit-resize-grip,
.commit-resize-handle.active .commit-resize-grip {
  opacity: 0.9;
  background: var(--color-primary);
}

.commit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.amend-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  cursor: pointer;
  color: var(--color-foreground-muted);
  white-space: nowrap;
}

.amend-label input {
  margin: 0;
}

.commit-btns {
  display: flex;
  gap: 4px;
  flex: 1;
}

.commit-btn {
  flex: 1;
  padding: 5px 8px;
  background: var(--color-primary);
  color: white;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.commit-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.commit-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.push-btn {
  background: var(--color-surface-active);
  color: var(--color-foreground);
}

.push-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.diff-area {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
}

.diff-header {
  padding: 6px 10px;
  font-size: 11px;
  color: var(--color-foreground-muted);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.diff-file-path {
  font-family: var(--font-mono, monospace);
}

.diff-content {
  flex: 1;
  overflow: hidden;
}

.diff-loading,
.diff-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

:deep(.splitpanes__splitter) {
  background: var(--color-border) !important;
}

:deep(.splitpanes--vertical > .splitpanes__splitter) {
  width: 3px !important;
  min-width: 3px !important;
}

/* ---- 模态弹窗（diff / 快速提交 共用） ---- */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.diff-modal {
  width: 85vw;
  height: 80vh;
}

.commit-modal {
  width: 480px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.modal-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-foreground);
  font-family: var(--font-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-close {
  background: none;
  border: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
  line-height: 1;
}

.modal-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.modal-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.diff-modal-content {
  flex: 1;
  overflow: hidden;
}

.modal-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

.modal-textarea {
  width: calc(100% - 24px);
  margin: 12px;
  padding: 10px 12px;
  font-size: 12px;
  font-family: var(--font-sans);
  border-radius: 4px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
  resize: vertical;
  box-sizing: border-box;
}

.modal-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.modal-hint {
  margin: 0 12px 8px;
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.modal-btn {
  padding: 5px 14px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
}

.modal-btn:hover {
  background: var(--color-surface-hover);
}

.modal-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.modal-btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.modal-btn.primary:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ---- Toast ---- */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
  font-size: 12px;
  padding: 7px 16px;
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 9999;
  pointer-events: none;
  white-space: nowrap;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* ---- Merge conflict dialog ---- */
.merge-overlay {
  padding: 16px;
}

.merge-dialog-panel {
  width: 100%;
  height: 100%;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
}

.merge-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}

.merge-dialog-body {
  flex: 1;
  overflow: hidden;
  display: flex;
}

/* ---- AI 按钮组 ---- */
.ai-btn-group {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}

.ai-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.ai-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.ai-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.ai-btn-main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
}

.ai-btn-chevron {
  padding: 5px 5px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  min-width: 20px;
  font-size: 10px;
  line-height: 1;
  justify-content: center;
}

.ai-btn-cancel {
  background: var(--color-error, #c0392b);
  color: white;
  border-color: var(--color-error, #c0392b);
}

.ai-btn-cancel:hover {
  opacity: 0.85;
}

.ai-btn-text {
  font-size: 11px;
}

.ai-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ai-spin 0.8s linear infinite;
}

@keyframes ai-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  min-width: 200px;
  max-width: 320px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  padding: 4px 0;
  z-index: 50;
}

.ai-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: var(--color-foreground);
  font-size: 12px;
  cursor: pointer;
}

.ai-menu button:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.ai-menu button:disabled {
  opacity: 0.5;
  cursor: default;
}

.ai-menu-divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 0;
}

.ai-menu-section {
  padding: 4px 12px;
  font-size: 10px;
  color: var(--color-foreground-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ai-menu-item-history {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-confirm-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-primary);
  border-radius: 3px;
}

.ai-confirm-text {
  flex: 1;
  font-size: 11px;
  color: var(--color-foreground);
}

.ai-confirm-btn {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 3px;
  cursor: pointer;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-foreground);
}

.ai-confirm-btn:hover {
  background: var(--color-surface-hover);
}

.ai-confirm-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.ai-confirm-btn.primary:hover {
  background: var(--color-primary-hover);
}

.ai-confirm-btn.muted {
  color: var(--color-foreground-muted);
}
</style>
