<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import { useCommitStore } from "@/stores/commitStore";
import { useFilterStore } from "@/stores/filterStore";
import { useRepoStore } from "@/stores/repoStore";
import { commands } from "@/utils/commands";
import type { DiffResult, FileStatus } from "@/utils/commands";
import DiffViewer from "@/components/diff/DiffViewer.vue";
import ContextMenu from "@/components/common/ContextMenu.vue";
import type { MenuItem } from "@/components/common/ContextMenu.vue";
import PushDialog from "@/components/common/PushDialog.vue";
import { errMsg } from "@/utils/error";
import { useBulkActions } from "@/composables/useBulkActions";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useFilterRules } from "@/composables/useFilterRules";
import { useMergeState } from "@/composables/useMergeState";
import { useMultiSelect } from "@/composables/useMultiSelect";
import { useStatusPolling } from "@/composables/useStatusPolling";
import { useToast } from "@/composables/useToast";
import ChangesToolbar from "./ChangesToolbar.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import FileSection, { type SectionData, type SectionKey } from "./FileSection.vue";
import FilterRulesDialog from "./FilterRulesDialog.vue";
import MergeStateBar from "./MergeStateBar.vue";

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
                @row-click="onRowClick"
                @row-toggle="onRowToggle"
                @row-context="onContextMenu"
              />
            </template>
          </div>

          <div v-if="selectedTotal > 0" class="bulk-bar">
            <span class="bulk-label">已选 {{ selectedTotal }} 项</span>
            <div class="bulk-btns">
              <button
                class="bulk-btn"
                :disabled="stageablePaths.length === 0"
                :title="`将 ${stageablePaths.length} 个文件添加到暂存区`"
                @click="bulkStage"
              >
                添加到 VCS ({{ stageablePaths.length }})
              </button>
              <button
                class="bulk-btn"
                :disabled="unstageablePaths.length === 0"
                :title="`取消暂存 ${unstageablePaths.length} 个文件`"
                @click="bulkUnstage"
              >
                取消暂存 ({{ unstageablePaths.length }})
              </button>
              <button
                class="bulk-btn danger"
                :disabled="discardablePaths.length === 0"
                :title="`回滚 ${discardablePaths.length} 个文件的本地修改（untracked 不参与）`"
                @click="bulkDiscard"
              >
                回滚 ({{ discardablePaths.length }})
              </button>
              <button
                class="bulk-btn ghost"
                :disabled="copyablePaths.length === 0"
                :title="`复制 ${copyablePaths.length} 个文件路径到剪贴板`"
                @click="bulkCopyPath"
              >
                复制路径 ({{ copyablePaths.length }})
              </button>
              <button
                class="bulk-btn danger"
                :disabled="deletablePaths.length === 0"
                :title="`从磁盘删除 ${deletablePaths.length} 个文件（不可撤销）`"
                @click="bulkDelete"
              >
                删除 ({{ deletablePaths.length }})
              </button>
              <button class="bulk-btn ghost" title="清除选择" @click="clearSelection">清除</button>
            </div>
          </div>

          <div class="commit-area">
            <textarea
              v-model="commitStore.commitMessage"
              class="commit-textarea"
              placeholder="提交信息..."
              rows="3"
            />
            <div class="commit-actions">
              <label class="amend-label">
                <input type="checkbox" v-model="commitStore.isAmend" />
                <span>Amend</span>
              </label>
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
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.commit-textarea {
  width: 100%;
  resize: vertical;
  padding: 6px 8px;
  font-size: 12px;
  font-family: var(--font-sans);
  border-radius: 3px;
  min-height: 56px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
}

.commit-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
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

/* ---- 批量操作栏 ---- */
.bulk-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--color-surface-active);
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
  font-size: 11px;
}

.bulk-label {
  color: var(--color-foreground-muted);
  white-space: nowrap;
}

.bulk-btns {
  display: flex;
  gap: 4px;
  flex: 1;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.bulk-btn {
  padding: 3px 8px;
  font-size: 11px;
  background: var(--color-primary);
  color: white;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
  border: none;
}

.bulk-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.bulk-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.bulk-btn.ghost {
  background: transparent;
  color: var(--color-foreground-muted);
  border: 1px solid var(--color-border);
}

.bulk-btn.ghost:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.bulk-btn.danger {
  background: var(--color-error, #e05252);
  color: white;
  border: none;
}

.bulk-btn.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-error, #e05252) 85%, black);
}
</style>
