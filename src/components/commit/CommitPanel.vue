<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useCommitStore } from "@/stores/commitStore";
import { useRepoStore } from "@/stores/repoStore";
import Toolbar from "@/components/common/Toolbar.vue";
import ToolbarButton from "@/components/common/ToolbarButton.vue";
import FileTree from "@/components/common/FileTree.vue";
import PushDialog from "@/components/common/PushDialog.vue";
import type { FileStatus } from "@/utils/commands";

const props = defineProps<{
  mode?: "full";
}>();

const commitStore = useCommitStore();
const repoStore = useRepoStore();

const selectedFile = ref<FileStatus | null>(null);
const showPushDialog = ref(false);

onMounted(() => {
  if (repoStore.activeRepo) {
    commitStore.loadStatus();
  }
});

watch(
  () => repoStore.activeRepo?.path,
  () => {
    if (repoStore.activeRepo) {
      commitStore.loadStatus();
    }
  }
);

function onSelectFile(file: FileStatus) {
  selectedFile.value = file;
}

async function handleCommit() {
  try {
    await commitStore.commit();
    await commitStore.loadStatus();
  } catch (e: any) {
    console.error("Commit failed:", e);
  }
}

async function handleCommitAndPush() {
  try {
    await commitStore.commit();
    await commitStore.loadStatus();
    showPushDialog.value = true;
  } catch (e: any) {
    console.error("Commit failed:", e);
  }
}

async function onPushConfirmed() {
  showPushDialog.value = false;
  await commitStore.loadStatus();
}

function onPushCancelled() {
  showPushDialog.value = false;
}
</script>

<template>
  <div class="commit-panel">
    <!-- Staged files -->
    <div class="file-section">
      <Toolbar compact>
        <span class="section-title">Staged</span>
        <span class="file-count">{{ commitStore.stagedFiles.length }}</span>
        <div style="flex: 1" />
        <ToolbarButton title="Unstage All" @click="commitStore.unstageAll">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="17 11 12 6 7 11" /><line x1="12" y1="18" x2="12" y2="6" />
          </svg>
        </ToolbarButton>
      </Toolbar>
      <div class="file-list">
        <div
          v-for="file in commitStore.stagedFiles"
          :key="'s-' + file.path"
          class="file-item"
          :class="{ selected: selectedFile?.path === file.path }"
          @click="onSelectFile(file)"
          @dblclick="commitStore.unstageFile(file.path)"
        >
          <span class="file-name">{{ file.path }}</span>
          <span class="file-status" :class="'status-' + file.status">
            {{ file.status === 'added' ? 'A' : file.status === 'modified' ? 'M' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : '?' }}
          </span>
        </div>
        <div v-if="commitStore.stagedFiles.length === 0" class="empty-hint">
          双击文件或使用 Stage All 暂存变更
        </div>
      </div>
    </div>

    <!-- Unstaged files -->
    <div class="file-section">
      <Toolbar compact>
        <span class="section-title">Changes</span>
        <span class="file-count">{{ commitStore.unstagedFiles.length + commitStore.untrackedFiles.length }}</span>
        <div style="flex: 1" />
        <ToolbarButton title="Stage All" @click="commitStore.stageAll">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="7 13 12 18 17 13" /><line x1="12" y1="6" x2="12" y2="18" />
          </svg>
        </ToolbarButton>
      </Toolbar>
      <div class="file-list">
        <div
          v-for="file in [...commitStore.unstagedFiles, ...commitStore.untrackedFiles]"
          :key="'u-' + file.path"
          class="file-item"
          :class="{ selected: selectedFile?.path === file.path }"
          @click="onSelectFile(file)"
          @dblclick="commitStore.stageFile(file.path)"
        >
          <span class="file-name">{{ file.path }}</span>
          <span class="file-status" :class="'status-' + file.status">
            {{ file.status === 'added' ? 'A' : file.status === 'modified' ? 'M' : file.status === 'deleted' ? 'D' : file.status === 'untracked' ? 'U' : file.status === 'conflicted' ? '!' : '?' }}
          </span>
        </div>
        <div v-if="commitStore.unstagedFiles.length === 0 && commitStore.untrackedFiles.length === 0" class="empty-hint">
          工作区无变更
        </div>
      </div>
    </div>

    <!-- Commit message -->
    <div class="commit-message-section">
      <textarea
        v-model="commitStore.commitMessage"
        class="commit-textarea"
        placeholder="提交信息..."
        rows="4"
      />
      <div class="commit-options">
        <label class="amend-checkbox">
          <input type="checkbox" v-model="commitStore.isAmend" />
          <span>Amend</span>
        </label>
      </div>
      <div class="commit-actions">
        <button
          class="commit-btn"
          :disabled="!commitStore.commitMessage.trim() || commitStore.stagedFiles.length === 0"
          @click="handleCommit"
        >
          Commit
        </button>
        <button
          class="commit-btn push"
          :disabled="!commitStore.commitMessage.trim() || commitStore.stagedFiles.length === 0"
          @click="handleCommitAndPush"
        >
          Commit and Push
        </button>
      </div>
    </div>

    <PushDialog
      :visible="showPushDialog"
      :repo-path="repoStore.activeRepo?.path ?? ''"
      :repo-name="repoStore.activeRepo?.name"
      @confirm="onPushConfirmed"
      @close="onPushCancelled"
    />
  </div>
</template>

<style scoped>
.commit-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface);
}

.file-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid var(--color-border);
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-foreground-muted);
}

.file-count {
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  padding: 0 6px;
  border-radius: 8px;
  margin-left: 4px;
}

.file-list {
  flex: 1;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 12px;
}

.file-item:hover {
  background: var(--color-surface-hover);
}

.file-item.selected {
  background: var(--color-surface-active);
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-status {
  flex-shrink: 0;
  font-weight: 600;
  font-size: 11px;
  min-width: 14px;
  text-align: center;
}

.status-added { color: var(--color-git-added); }
.status-modified { color: var(--color-git-modified); }
.status-deleted { color: var(--color-git-deleted); }
.status-renamed { color: var(--color-git-renamed); }
.status-untracked { color: var(--color-git-untracked); }
.status-conflicted { color: var(--color-error); }

.empty-hint {
  padding: 12px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 11px;
}

.commit-message-section {
  flex-shrink: 0;
  padding: 8px;
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
  min-height: 60px;
}

.commit-options {
  display: flex;
  align-items: center;
  gap: 12px;
}

.amend-checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
  color: var(--color-foreground-muted);
}

.amend-checkbox input {
  margin: 0;
}

.commit-actions {
  display: flex;
  gap: 6px;
}

.commit-btn {
  flex: 1;
  padding: 6px 12px;
  background: var(--color-primary);
  color: white;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 500;
}

.commit-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.commit-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.commit-btn.push {
  background: var(--color-surface-active);
  color: var(--color-foreground);
}

.commit-btn.push:hover:not(:disabled) {
  background: var(--color-surface-hover);
}
</style>
