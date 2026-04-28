<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { Splitpanes, Pane } from "splitpanes";
import { useRepoStore } from "@/stores/repoStore";
import Toolbar from "@/components/common/Toolbar.vue";
import ToolbarButton from "@/components/common/ToolbarButton.vue";
import ContextMenu from "@/components/common/ContextMenu.vue";
import DiffViewer from "@/components/diff/DiffViewer.vue";
import type { MenuItem } from "@/components/common/ContextMenu.vue";
import type { StashEntry, FileStatus, DiffResult } from "@/utils/commands";
import { commands } from "@/utils/commands";
import { formatTimestamp } from "@/utils/format";

const repoStore = useRepoStore();

const stashes = ref<StashEntry[]>([]);
const loading = ref(false);
const selectedStash = ref<StashEntry | null>(null);

const stashFiles = ref<FileStatus[]>([]);
const filesLoading = ref(false);
const selectedFile = ref<FileStatus | null>(null);

const diffResult = ref<DiffResult | null>(null);
const diffLoading = ref(false);

const showSaveDialog = ref(false);
const saveMessage = ref("");
const includeUntracked = ref(true);

const contextMenuRef = ref<InstanceType<typeof ContextMenu>>();
const contextStash = ref<StashEntry | null>(null);
const contextMenuItems = ref<MenuItem[]>([]);

// Toast
const toastMessage = ref("");
const toastVisible = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string) {
  toastMessage.value = msg;
  toastVisible.value = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastVisible.value = false; }, 2500);
}

async function loadStashes() {
  if (!repoStore.activeRepo) return;
  loading.value = true;
  try {
    stashes.value = await commands.getStashList(repoStore.activeRepo.path);
    // If previously selected stash no longer exists, clear
    if (selectedStash.value && !stashes.value.find((s) => s.index === selectedStash.value!.index)) {
      selectedStash.value = null;
      stashFiles.value = [];
      selectedFile.value = null;
      diffResult.value = null;
    }
  } catch (e) {
    console.error("Failed to load stashes:", e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadStashes);
watch(() => repoStore.activeRepo?.path, loadStashes);

async function selectStash(stash: StashEntry) {
  if (selectedStash.value?.index === stash.index) return;
  selectedStash.value = stash;
  selectedFile.value = null;
  diffResult.value = null;
  stashFiles.value = [];
  filesLoading.value = true;
  try {
    stashFiles.value = await commands.getStashFiles(repoStore.activeRepo!.path, stash.index);
  } catch (e) {
    console.error("Failed to load stash files:", e);
  } finally {
    filesLoading.value = false;
  }
}

async function selectFile(file: FileStatus) {
  if (!selectedStash.value || !repoStore.activeRepo) return;
  selectedFile.value = file;
  diffResult.value = null;
  diffLoading.value = true;
  try {
    diffResult.value = await commands.getStashFileDiff(
      repoStore.activeRepo.path,
      selectedStash.value.index,
      file.path
    );
  } catch (e) {
    console.error("Failed to load stash file diff:", e);
  } finally {
    diffLoading.value = false;
  }
}

async function saveStash() {
  if (!repoStore.activeRepo) return;
  try {
    await commands.stashSave(repoStore.activeRepo.path, saveMessage.value, includeUntracked.value);
    saveMessage.value = "";
    showSaveDialog.value = false;
    await loadStashes();
    showToast("已创建 Stash");
  } catch (e: any) {
    showToast(`Stash 失败: ${e.message}`);
  }
}

async function applyStash(stash: StashEntry) {
  if (!repoStore.activeRepo) return;
  try {
    await commands.stashApply(repoStore.activeRepo.path, stash.index);
    await loadStashes();
    showToast(`已应用 stash@{${stash.index}}`);
  } catch (e: any) {
    showToast(`Apply 失败: ${e.message}`);
  }
}

async function popStash(stash: StashEntry) {
  if (!repoStore.activeRepo) return;
  try {
    await commands.stashPop(repoStore.activeRepo.path, stash.index);
    await loadStashes();
    showToast(`已弹出 stash@{${stash.index}}`);
  } catch (e: any) {
    showToast(`Pop 失败: ${e.message}`);
  }
}

async function dropStash(stash: StashEntry) {
  if (!repoStore.activeRepo) return;
  try {
    await commands.stashDrop(repoStore.activeRepo.path, stash.index);
    await loadStashes();
    showToast(`已删除 stash@{${stash.index}}`);
  } catch (e: any) {
    showToast(`Drop 失败: ${e.message}`);
  }
}

function showContextMenuForStash(event: MouseEvent, stash: StashEntry) {
  contextStash.value = stash;
  contextMenuItems.value = [
    { label: "Apply", action: () => applyStash(stash) },
    { label: "Pop（应用并删除）", action: () => popStash(stash) },
    { separator: true, label: "" },
    { label: "Drop（删除）", action: () => dropStash(stash) },
  ];
  contextMenuRef.value?.show(event);
}

function getStatusLetter(status: FileStatus["status"]): string {
  switch (status) {
    case "added": return "A";
    case "modified": return "M";
    case "deleted": return "D";
    case "renamed": return "R";
    case "copied": return "C";
    case "untracked": return "?";
    default: return "?";
  }
}

function getStatusClass(status: FileStatus["status"]): string {
  switch (status) {
    case "added": return "status-added";
    case "modified": return "status-modified";
    case "deleted": return "status-deleted";
    case "renamed": return "status-renamed";
    case "copied": return "status-renamed";
    case "untracked": return "status-untracked";
    default: return "";
  }
}
</script>

<template>
  <div class="stash-layout">
    <Splitpanes class="default-theme" style="height: 100%">

      <!-- 左栏：Stash 列表 -->
      <Pane :size="28" :min-size="18" :max-size="45">
        <div class="stash-panel">
          <div class="panel-header">
            <span class="panel-title">搁置</span>
            <span v-if="stashes.length > 0" class="panel-count">{{ stashes.length }}</span>
            <div class="header-actions">
              <button class="action-btn" title="新建 Stash" @click="showSaveDialog = true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button class="action-btn" title="刷新" @click="loadStashes">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
            </div>
          </div>

          <div class="stash-list">
            <div v-if="loading" class="state-hint">加载中...</div>
            <div v-else-if="stashes.length === 0" class="state-hint">无 Stash 记录</div>
            <div
              v-for="stash in stashes"
              :key="stash.index"
              class="stash-item"
              :class="{ selected: selectedStash?.index === stash.index }"
              @click="selectStash(stash)"
              @contextmenu.prevent="showContextMenuForStash($event, stash)"
            >
              <div class="stash-top">
                <span class="stash-ref">stash@{{ '{' }}{{ stash.index }}{{ '}' }}</span>
                <span class="stash-time">{{ formatTimestamp(stash.time) }}</span>
              </div>
              <div class="stash-message">{{ stash.message }}</div>
              <div class="stash-btn-row">
                <button class="stash-btn" @click.stop="applyStash(stash)">Apply</button>
                <button class="stash-btn" @click.stop="popStash(stash)">Pop</button>
                <button class="stash-btn danger" @click.stop="dropStash(stash)">Drop</button>
              </div>
            </div>
          </div>
        </div>
      </Pane>

      <!-- 中栏：Stash 内的文件列表 -->
      <Pane :size="25" :min-size="15" :max-size="40">
        <div class="files-panel">
          <div class="panel-header">
            <span class="panel-title">
                {{ selectedStash ? 'stash@{' + selectedStash.index + '} 文件' : '文件' }}
            </span>
            <span v-if="stashFiles.length > 0" class="panel-count">{{ stashFiles.length }}</span>
          </div>
          <div class="file-list">
            <div v-if="!selectedStash" class="state-hint">选择一个 Stash 查看文件</div>
            <div v-else-if="filesLoading" class="state-hint">加载中...</div>
            <div v-else-if="stashFiles.length === 0" class="state-hint">无文件</div>
            <div
              v-for="file in stashFiles"
              :key="file.path"
              class="file-item"
              :class="{ selected: selectedFile?.path === file.path }"
              @click="selectFile(file)"
            >
              <span class="status-letter" :class="getStatusClass(file.status)">
                {{ getStatusLetter(file.status) }}
              </span>
              <span class="file-path">{{ file.path }}</span>
            </div>
          </div>
        </div>
      </Pane>

      <!-- 右栏：Diff 预览 -->
      <Pane :size="47" :min-size="25">
        <div class="diff-panel">
          <div class="panel-header">
            <span class="panel-title">{{ selectedFile ? selectedFile.path : 'Diff' }}</span>
          </div>
          <div class="diff-content">
            <div v-if="!selectedFile" class="state-hint">选择一个文件查看变更</div>
            <div v-else-if="diffLoading" class="state-hint">加载中...</div>
            <DiffViewer v-else-if="diffResult" :diff="diffResult" />
            <div v-else class="state-hint">无差异内容</div>
          </div>
        </div>
      </Pane>

    </Splitpanes>

    <!-- 新建 Stash 对话框 -->
    <Teleport to="body">
      <div v-if="showSaveDialog" class="modal-overlay" @click.self="showSaveDialog = false">
        <div class="modal-dialog">
          <div class="modal-header">
            <span class="modal-title">新建 Stash</span>
            <button class="modal-close" @click="showSaveDialog = false">✕</button>
          </div>
          <div class="modal-body">
            <input
              v-model="saveMessage"
              class="modal-input"
              placeholder="Stash 描述（可选）"
              @keydown.enter="saveStash"
            />
            <label class="modal-checkbox">
              <input type="checkbox" v-model="includeUntracked" />
              <span>包含未跟踪文件</span>
            </label>
          </div>
          <div class="modal-footer">
            <button class="modal-btn" @click="showSaveDialog = false">取消</button>
            <button class="modal-btn primary" @click="saveStash">Stash</button>
          </div>
        </div>
      </div>
    </Teleport>

    <ContextMenu ref="contextMenuRef" :items="contextMenuItems" />

    <!-- Toast 通知 -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toastVisible" class="toast">{{ toastMessage }}</div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.stash-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
}

/* ---- 公共面板样式 ---- */
.stash-panel,
.files-panel,
.diff-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
}

.diff-panel {
  border-right: none;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  min-height: 30px;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.panel-count {
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  padding: 0 6px;
  border-radius: 8px;
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  color: var(--color-foreground-muted);
  padding: 3px;
  border-radius: 3px;
  cursor: pointer;
}

.action-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.state-hint {
  padding: 16px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

/* ---- Stash 列表 ---- */
.stash-list {
  flex: 1;
  overflow-y: auto;
}

.stash-item {
  padding: 7px 8px;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
}

.stash-item:hover {
  background: var(--color-surface-hover);
}

.stash-item.selected {
  background: var(--color-surface-active);
}

.stash-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3px;
}

.stash-ref {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-primary);
  font-weight: 600;
}

.stash-time {
  font-size: 10px;
  color: var(--color-foreground-muted);
}

.stash-message {
  font-size: 12px;
  color: var(--color-foreground);
  margin-bottom: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stash-btn-row {
  display: flex;
  gap: 4px;
}

.stash-btn {
  padding: 2px 8px;
  background: var(--color-surface-hover);
  color: var(--color-foreground);
  border-radius: 3px;
  font-size: 10px;
  cursor: pointer;
}

.stash-btn:hover {
  background: var(--color-surface-active);
}

.stash-btn.danger:hover {
  background: var(--color-error, #e05252);
  color: white;
}

/* ---- 文件列表 ---- */
.file-list {
  flex: 1;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  padding: 3px 8px;
  cursor: pointer;
  gap: 6px;
  font-size: 12px;
}

.file-item:hover {
  background: var(--color-surface-hover);
}

.file-item.selected {
  background: var(--color-surface-active);
}

.status-letter {
  font-size: 10px;
  font-weight: 700;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.status-added    { color: var(--color-git-added); }
.status-modified { color: var(--color-git-modified); }
.status-deleted  { color: var(--color-git-deleted); }
.status-renamed  { color: var(--color-git-renamed); }
.status-untracked{ color: var(--color-git-untracked); }

.file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

/* ---- Diff 区域 ---- */
.diff-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ---- 模态弹窗 ---- */
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
  width: 380px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
}

.modal-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-foreground);
}

.modal-close {
  background: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
}

.modal-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.modal-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.modal-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 4px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
}

.modal-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.modal-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  color: var(--color-foreground);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
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

.modal-btn.primary:hover {
  opacity: 0.9;
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
  transition: opacity 0.2s, transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

:deep(.splitpanes__splitter) {
  background: var(--color-border) !important;
}

:deep(.splitpanes--vertical > .splitpanes__splitter) {
  width: 3px !important;
  min-width: 3px !important;
}
</style>
