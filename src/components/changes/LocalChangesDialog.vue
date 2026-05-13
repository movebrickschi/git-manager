<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useCommitStore } from "@/stores/commitStore";
import { useRepoStore } from "@/stores/repoStore";
import { useFilterStore } from "@/stores/filterStore";
import { commands } from "@/utils/commands";
import type { FileStatus, DiffResult } from "@/utils/commands";
import DiffViewer from "@/components/diff/DiffViewer.vue";
import Toolbar from "@/components/common/Toolbar.vue";
import ToolbarButton from "@/components/common/ToolbarButton.vue";
import ContextMenu from "@/components/common/ContextMenu.vue";
import type { MenuItem } from "@/components/common/ContextMenu.vue";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const commitStore = useCommitStore();
const repoStore = useRepoStore();
const filterStore = useFilterStore();

const selectedFile = ref<FileStatus | null>(null);
const selectedSection = ref<"staged" | "unstaged" | "untracked">("unstaged");
const diffResult = ref<DiffResult | null>(null);
const showInlineDiff = ref(false);
const treeView = ref(false);
const loading = ref(false);
const errorMessage = ref<string | null>(null);
const contextMenuRef = ref<InstanceType<typeof ContextMenu>>();
const contextFile = ref<FileStatus | null>(null);
const contextSection = ref<"staged" | "unstaged" | "untracked">("unstaged");

interface SectionInfo {
  key: "staged" | "unstaged" | "untracked";
  title: string;
  files: FileStatus[];
}

function applyFilter(files: FileStatus[]): FileStatus[] {
  const repoPath = repoStore.activeRepo?.path ?? "";
  if (!repoPath || filterStore.showFiltered || !filterStore.hasRules(repoPath)) {
    return files;
  }
  return files.filter((f) => !filterStore.isFiltered(repoPath, f.path));
}

const sections = computed<SectionInfo[]>(() => [
  { key: "staged", title: "已暂存", files: applyFilter(commitStore.stagedFiles) },
  { key: "unstaged", title: "未暂存", files: applyFilter(commitStore.unstagedFiles) },
  { key: "untracked", title: "未跟踪", files: applyFilter(commitStore.untrackedFiles) },
]);

const allFilesWithSections = computed(() => {
  const result: { file: FileStatus; section: SectionInfo }[] = [];
  for (const section of sections.value) {
    for (const file of section.files) {
      result.push({ file, section });
    }
  }
  return result;
});

function getStatusLetter(status: FileStatus["status"]): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "U";
    case "conflicted":
      return "!";
    case "ignored":
      return "I";
    default:
      return "?";
  }
}

function getStatusClass(status: FileStatus["status"]): string {
  switch (status) {
    case "added":
      return "status-added";
    case "modified":
      return "status-modified";
    case "deleted":
      return "status-deleted";
    case "renamed":
      return "status-renamed";
    case "copied":
      return "status-renamed";
    case "untracked":
      return "status-untracked";
    case "conflicted":
      return "status-conflicted";
    case "ignored":
      return "status-ignored";
    default:
      return "";
  }
}

watch(
  () => props.visible,
  async (val) => {
    if (val) {
      loading.value = true;
      errorMessage.value = null;
      try {
        await commitStore.loadStatus();
      } catch (error: any) {
        errorMessage.value = `加载状态失败: ${error.message}`;
        console.error("Failed to load status:", error);
      } finally {
        loading.value = false;
      }
    } else {
      selectedFile.value = null;
      diffResult.value = null;
      showInlineDiff.value = false;
      errorMessage.value = null;
    }
  }
);

async function onSelectFile(file: FileStatus, section: SectionInfo) {
  selectedFile.value = file;
  selectedSection.value = section.key;
  showInlineDiff.value = false;
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

async function onDblClickFile(file: FileStatus, section: SectionInfo) {
  await onSelectFile(file, section);
  showInlineDiff.value = true;
}

function onContextMenu(event: MouseEvent, file: FileStatus, section: SectionInfo) {
  event.preventDefault();
  event.stopPropagation();
  contextFile.value = file;
  contextSection.value = section.key;
  contextMenuRef.value?.show(event);
}

function closeDialog() {
  emit("close");
}

async function handleStageFile() {
  if (!contextFile.value) return;
  await commitStore.stageFile(contextFile.value.path);
}

async function handleUnstageFile() {
  if (!contextFile.value) return;
  await commitStore.unstageFile(contextFile.value.path);
}

async function handleDiscardFile() {
  if (!contextFile.value || !repoStore.activeRepo) return;
  const file = contextFile.value;
  const section = contextSection.value;

  try {
    if (section === "staged") {
      await commands.unstageFile(repoStore.activeRepo.path, file.path);
    }
    // Note: discard operations need corresponding commands to be implemented
    // For now, just reload status
    await commitStore.loadStatus();

    if (selectedFile.value?.path === file.path) {
      selectedFile.value = null;
      diffResult.value = null;
      showInlineDiff.value = false;
    }
  } catch (e) {
    console.error("Failed to discard file:", e);
  }
}

// 新增功能函数
async function handleShowFileHistory() {
  if (!contextFile.value || !repoStore.activeRepo) return;
  // 需要实现打开文件历史记录的逻辑
  console.log("Showing history for file:", contextFile.value.path);
  // 这里需要跳转到文件历史页面，目前只是占位符
}

async function handleCompareWithBranch() {
  if (!contextFile.value || !repoStore.activeRepo) return;
  // 需要实现与分支比较的逻辑
  console.log("Comparing with branch for file:", contextFile.value.path);
  // 这里需要弹出分支选择对话框并比较
}

async function handleShowBlame() {
  if (!contextFile.value || !repoStore.activeRepo) return;
  // 需要实现 Blame 功能，显示每一行代码的作者信息
  console.log("Showing blame for file:", contextFile.value.path);
  try {
    const blameInfo = await commands.getBlame(repoStore.activeRepo.path, contextFile.value.path);
    console.log("Blame info:", blameInfo);
  } catch (e) {
    console.error("Failed to get blame info:", e);
  }
}

async function handleOpenInEditor() {
  if (!contextFile.value || !repoStore.activeRepo) return;
  // 打开文件在外部编辑器
  const fullPath = repoStore.activeRepo.path + "/" + contextFile.value.path;
  console.log("Opening file in editor:", fullPath);
  // 这里可能需要特定的编辑器协议
}

const contextMenuItems = computed<MenuItem[]>(() => {
  if (!contextFile.value) return [];
  const file = contextFile.value;
  const section = contextSection.value;
  const items: MenuItem[] = [];

  // 暂存/取消暂存选项
  if (section === "unstaged" || section === "untracked") {
    items.push({ label: "暂存", action: handleStageFile });
  }
  if (section === "staged") {
    items.push({ label: "取消暂存", action: handleUnstageFile });
  }

  // 添加 Git 操作分组
  items.push({ separator: true, label: "" });
  items.push({
    label: "Git 操作",
    children: [
      { label: "查看文件历史记录", action: handleShowFileHistory },
      { label: "显示注解 (Blame)", action: handleShowBlame },
      { label: "与分支比较", action: handleCompareWithBranch },
      { separator: true, label: "" },
      { label: "放弃更改", action: handleDiscardFile },
    ],
  });

  // 文件操作分组
  items.push({ separator: true, label: "" });
  items.push({
    label: "文件操作",
    children: [
      { label: "在编辑器中打开", action: handleOpenInEditor },
      {
        label: "查看 Diff",
        action: () => onDblClickFile(file, sections.value.find((s) => s.key === section)!),
      },
      { label: "复制路径", action: () => navigator.clipboard.writeText(file.path) },
    ],
  });

  return items;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="local-changes-overlay" @click.self="closeDialog">
      <div class="local-changes-panel">
        <div class="header">
          <span class="title">本地变更</span>
          <div class="header-actions">
            <ToolbarButton
              :title="treeView ? '平铺视图' : '树形视图'"
              :active="treeView"
              @click="treeView = !treeView"
            >
              <svg
                v-if="treeView"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              <svg
                v-else
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                />
              </svg>
            </ToolbarButton>
            <button class="close-btn" @click="closeDialog">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div class="content">
          <div class="file-list">
            <div v-if="errorMessage" class="error-message">
              <span class="error-icon">⚠️</span> {{ errorMessage }}
            </div>
            <div v-else-if="loading" class="loading">加载中...</div>
            <div v-else-if="allFilesWithSections.length === 0" class="empty">工作区无变更</div>
            <template v-else>
              <div v-for="section in sections" :key="section.key" class="section">
                <div v-if="section.files.length > 0" class="section-header">
                  <span>{{ section.title }}</span>
                  <span class="section-count">{{ section.files.length }}</span>
                </div>
                <div
                  v-for="file in section.files"
                  :key="file.path"
                  class="file-item"
                  :class="{
                    selected: selectedFile?.path === file.path && selectedSection === section.key,
                    ['section-' + section.key]: true,
                  }"
                  @click="onSelectFile(file, section)"
                  @dblclick="onDblClickFile(file, section)"
                  @contextmenu="onContextMenu($event, file, section)"
                >
                  <span class="status-letter" :class="getStatusClass(file.status)">
                    {{ getStatusLetter(file.status) }}
                  </span>
                  <span class="file-path">{{ file.path }}</span>
                </div>
              </div>
            </template>
          </div>

          <div v-if="selectedFile && diffResult" class="diff-panel">
            <div class="diff-header">
              <span>{{ selectedFile.path }}</span>
              <button v-if="showInlineDiff" class="close-diff-btn" @click="showInlineDiff = false">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <DiffViewer v-if="showInlineDiff" :diff="diffResult" />
            <div v-else class="diff-preview">
              <DiffViewer :diff="diffResult" :inline="true" />
            </div>
          </div>

          <div v-else-if="selectedFile" class="diff-panel">
            <div class="diff-header">
              <span>{{ selectedFile.path }}</span>
            </div>
            <div class="diff-loading">加载 Diff 中...</div>
          </div>

          <div v-else class="diff-empty">选择一个文件查看变更</div>
        </div>
      </div>
    </div>
  </Teleport>

  <ContextMenu ref="contextMenuRef" :items="contextMenuItems" />
</template>

<style scoped>
.local-changes-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.local-changes-panel {
  width: 100%;
  height: 100%;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.title {
  font-size: 13px;
  font-weight: 500;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.close-btn {
  display: flex;
  align-items: center;
  background: none;
  color: var(--color-foreground-muted);
  padding: 4px;
  border-radius: 3px;
}

.close-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.file-list {
  width: 280px;
  min-width: 200px;
  max-width: 400px;
  overflow-y: auto;
  border-right: 1px solid var(--color-border);
  flex-shrink: 0;
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

.section-header {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-foreground-muted);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.section-count {
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  padding: 0 6px;
  border-radius: 8px;
  margin-left: 6px;
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
  font-weight: 600;
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.status-added {
  color: var(--color-git-added);
}
.status-modified {
  color: var(--color-git-modified);
}
.status-deleted {
  color: var(--color-git-deleted);
}
.status-renamed {
  color: var(--color-git-renamed);
}
.status-untracked {
  color: var(--color-git-untracked);
}
.status-conflicted {
  color: var(--color-error);
}
.status-ignored {
  color: var(--color-foreground-muted);
}

.file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--color-foreground-muted);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.close-diff-btn {
  display: flex;
  align-items: center;
  background: none;
  color: var(--color-foreground-muted);
  padding: 2px;
  border-radius: 3px;
}

.close-diff-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.diff-preview {
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

.loading,
.empty {
  padding: 16px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}
</style>
