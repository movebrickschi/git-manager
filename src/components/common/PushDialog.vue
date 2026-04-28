<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { commands } from "@/utils/commands";
import type { CommitInfo, FileStatus } from "@/utils/commands";
import { formatTimestamp } from "@/utils/format";

const props = defineProps<{
  visible: boolean;
  repoPath: string;
  repoName?: string;
  remote?: string;
  branch?: string;
  targetBranch?: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const loading = ref(false);
const pushing = ref(false);
const commits = ref<CommitInfo[]>([]);
const selectedCommit = ref<CommitInfo | null>(null);
const commitFiles = ref<FileStatus[]>([]);
const filesLoading = ref(false);

const remoteName = computed(() => props.remote ?? "origin");
const branchName = computed(() => props.branch ?? props.targetBranch ?? "");
const destination = computed(() =>
  branchName.value ? `${remoteName.value}/${branchName.value}` : remoteName.value
);
const repoLabel = computed(() => props.repoName ?? props.repoPath.split(/[\\/]/).pop() ?? props.repoPath);

async function loadCommits() {
  if (!props.repoPath) return;
  loading.value = true;
  commits.value = [];
  selectedCommit.value = null;
  commitFiles.value = [];
  try {
    commits.value = await commands.getUnpushedCommits(
      props.repoPath,
      props.remote,
      props.branch
    );
    if (commits.value.length > 0) {
      await selectCommit(commits.value[0]!);
    }
  } finally {
    loading.value = false;
  }
}

async function selectCommit(commit: CommitInfo) {
  selectedCommit.value = commit;
  filesLoading.value = true;
  try {
    commitFiles.value = await commands.getCommitFiles(props.repoPath, commit.id);
  } catch {
    commitFiles.value = [];
  } finally {
    filesLoading.value = false;
  }
}

async function handlePush() {
  pushing.value = true;
  try {
    await commands.push(props.repoPath, props.remote, props.branch);
    emit("confirm");
  } finally {
    pushing.value = false;
  }
}

function handleClose() {
  emit("close");
}

function fileStatusLabel(status: FileStatus["status"]) {
  const map: Record<string, string> = {
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    copied: "C",
    untracked: "?",
    conflicted: "!",
    ignored: "I",
  };
  return map[status] ?? "?";
}

watch(
  () => props.visible,
  (v) => {
    if (v) loadCommits();
  },
  { immediate: true }
);
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="push-overlay" @click.self="handleClose">
      <div class="push-dialog">
        <!-- Header -->
        <div class="push-header">
          <span class="push-title">推送提交</span>
          <button class="push-close" @click="handleClose">✕</button>
        </div>

        <!-- Body -->
        <div class="push-body">
          <!-- Left: commit list -->
          <div class="push-left">
            <!-- Repo / branch row -->
            <div class="repo-row">
              <svg class="repo-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
              </svg>
              <span class="repo-name">{{ repoLabel }}</span>
              <svg class="arrow-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
              <span class="dest-name">{{ destination }}</span>
              <span v-if="commits.length > 0" class="commit-count">{{ commits.length }} 个提交</span>
            </div>

            <!-- Commit list -->
            <div class="commit-list-area">
              <div v-if="loading" class="list-empty">加载中...</div>
              <div v-else-if="commits.length === 0" class="list-empty">无待推送的提交</div>
              <div
                v-for="commit in commits"
                :key="commit.id"
                class="commit-row"
                :class="{ selected: selectedCommit?.id === commit.id }"
                @click="selectCommit(commit)"
              >
                <span class="commit-hash">{{ commit.shortId }}</span>
                <span class="commit-summary">{{ commit.summary }}</span>
                <span class="commit-meta">{{ commit.author }} · {{ formatTimestamp(commit.authorTime) }}</span>
              </div>
            </div>
          </div>

          <!-- Divider -->
          <div class="push-divider" />

          <!-- Right: files of selected commit -->
          <div class="push-right">
            <div class="files-header">
              <span v-if="selectedCommit">
                {{ selectedCommit.shortId }}
                <span class="files-count">&nbsp;{{ commitFiles.length }} 个文件</span>
              </span>
              <span v-else class="files-placeholder">选择提交以查看变更文件</span>
            </div>
            <div class="files-area">
              <div v-if="filesLoading" class="list-empty">加载中...</div>
              <div
                v-for="file in commitFiles"
                :key="file.path"
                class="file-row"
              >
                <span class="file-status" :class="'status-' + file.status">{{ fileStatusLabel(file.status) }}</span>
                <span class="file-path">{{ file.path }}</span>
              </div>
              <div v-if="!filesLoading && selectedCommit && commitFiles.length === 0" class="list-empty">无变更文件</div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="push-footer">
          <button class="push-btn" :disabled="pushing" @click="handleClose">取消</button>
          <button
            class="push-btn primary"
            :disabled="pushing || commits.length === 0"
            @click="handlePush"
          >
            <span v-if="pushing">推送中...</span>
            <span v-else>推送(P)</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.push-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.push-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  width: 720px;
  max-width: 95vw;
  height: 460px;
  max-height: 90vh;
}

/* Header */
.push-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.push-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-foreground);
}

.push-close {
  background: none;
  border: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
  line-height: 1;
}

.push-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

/* Body */
.push-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Left panel */
.push-left {
  width: 55%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--color-border);
}

.repo-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  font-size: 12px;
  background: var(--color-background);
}

.repo-icon {
  color: var(--color-foreground-muted);
  flex-shrink: 0;
}

.arrow-icon {
  color: var(--color-foreground-muted);
  flex-shrink: 0;
}

.repo-name {
  font-weight: 600;
  color: var(--color-foreground);
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dest-name {
  color: var(--color-primary, #4a9eff);
  font-weight: 500;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-count {
  margin-left: auto;
  color: var(--color-foreground-muted);
  flex-shrink: 0;
}

.commit-list-area {
  flex: 1;
  overflow-y: auto;
}

.list-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--color-foreground-muted);
}

.commit-row {
  display: flex;
  flex-direction: column;
  padding: 6px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border);
  gap: 2px;
}

.commit-row:hover {
  background: var(--color-surface-hover);
}

.commit-row.selected {
  background: var(--color-surface-active);
}

.commit-hash {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-foreground-muted);
  flex-shrink: 0;
}

.commit-summary {
  font-size: 12px;
  color: var(--color-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-meta {
  font-size: 11px;
  color: var(--color-foreground-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Divider */
.push-divider {
  width: 0;
  flex-shrink: 0;
}

/* Right panel */
.push-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.files-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-foreground);
  background: var(--color-background);
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-count {
  font-weight: normal;
  color: var(--color-foreground-muted);
}

.files-placeholder {
  color: var(--color-foreground-muted);
  font-weight: normal;
}

.files-area {
  flex: 1;
  overflow-y: auto;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--color-border);
}

.file-row:hover {
  background: var(--color-surface-hover);
}

.file-status {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}

.file-status.status-added { color: #4caf50; }
.file-status.status-modified { color: #2196f3; }
.file-status.status-deleted { color: #f44336; }
.file-status.status-renamed { color: #ff9800; }
.file-status.status-copied { color: #9c27b0; }

.file-path {
  font-size: 12px;
  color: var(--color-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Footer */
.push-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.push-btn {
  padding: 5px 16px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
}

.push-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.push-btn.primary {
  background: var(--color-primary, #4a9eff);
  color: white;
  border-color: var(--color-primary, #4a9eff);
}

.push-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.push-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
