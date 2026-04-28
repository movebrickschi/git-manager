<script setup lang="ts">
import { ref, watch } from "vue";
import { useLogStore } from "@/stores/logStore";
import { useRepoStore } from "@/stores/repoStore";
import { commands, type CommitInfo } from "@/utils/commands";
import { formatFullDate, shortenHash } from "@/utils/format";

const logStore = useLogStore();
const repoStore = useRepoStore();

const selectedCommit = ref<CommitInfo | null>(null);
const loading = ref(false);

watch(
  () => logStore.selectedCommitId,
  async (commitId) => {
    const repoPath = repoStore.activeRepo?.path;
    if (!commitId || !repoPath) {
      selectedCommit.value = null;
      return;
    }
    loading.value = true;
    try {
      selectedCommit.value = await commands.getCommitDetail(repoPath, commitId);
    } catch {
      const fallback = logStore.commits.find((c) => c.id === commitId);
      selectedCommit.value = fallback ?? null;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);

function copyHash() {
  if (selectedCommit.value) {
    navigator.clipboard.writeText(selectedCommit.value.id);
  }
}
</script>

<template>
  <div class="commit-details-pane">
    <div class="pane-header">
      <span class="pane-title">Commit Details</span>
    </div>

    <div v-if="loading" class="empty">加载中...</div>

    <div v-else-if="!selectedCommit" class="empty">
      选择一个提交查看详情
    </div>

    <div v-else class="details-content">
      <div class="commit-message">{{ selectedCommit.message }}</div>

      <div class="detail-rows">
        <div class="detail-row">
          <span class="detail-label">Hash</span>
          <span class="detail-value mono hash-value" @click="copyHash" title="点击复制">
            {{ selectedCommit.id }}
          </span>
        </div>

        <div class="detail-row">
          <span class="detail-label">Author</span>
          <span class="detail-value">
            {{ selectedCommit.author }}
            <span class="email">&lt;{{ selectedCommit.authorEmail }}&gt;</span>
          </span>
        </div>

        <div class="detail-row">
          <span class="detail-label">Date</span>
          <span class="detail-value">{{ formatFullDate(selectedCommit.authorTime) }}</span>
        </div>

        <div v-if="selectedCommit.author !== selectedCommit.committer" class="detail-row">
          <span class="detail-label">Committer</span>
          <span class="detail-value">
            {{ selectedCommit.committer }}
            <span class="email">&lt;{{ selectedCommit.committerEmail }}&gt;</span>
          </span>
        </div>

        <div v-if="selectedCommit.parents.length > 0" class="detail-row">
          <span class="detail-label">Parents</span>
          <span class="detail-value">
            <span
              v-for="parent in selectedCommit.parents"
              :key="parent"
              class="parent-hash mono"
              @click="logStore.selectCommit(parent)"
            >{{ shortenHash(parent) }}</span>
          </span>
        </div>

        <div v-if="selectedCommit.refs.length > 0" class="detail-row">
          <span class="detail-label">Refs</span>
          <span class="detail-value refs-value">
            <span
              v-for="ref in selectedCommit.refs"
              :key="ref.name"
              class="ref-badge"
              :class="'ref-' + ref.refType"
            >{{ ref.name }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.commit-details-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface);
}

.pane-header {
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.pane-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-foreground-muted);
}

.empty {
  padding: 16px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

.details-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.commit-message {
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.4;
}

.detail-label {
  flex-shrink: 0;
  width: 70px;
  color: var(--color-foreground-muted);
  font-weight: 500;
}

.detail-value {
  flex: 1;
  word-break: break-all;
}

.hash-value {
  cursor: pointer;
  font-size: 11px;
}

.hash-value:hover {
  color: var(--color-primary);
}

.email {
  color: var(--color-foreground-muted);
  font-size: 11px;
}

.parent-hash {
  color: var(--color-primary);
  cursor: pointer;
  font-size: 11px;
  margin-right: 6px;
}

.parent-hash:hover {
  text-decoration: underline;
}

.refs-value {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ref-badge {
  padding: 0 6px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
}

.ref-head { background: var(--color-branch-head); color: #1e1e1e; }
.ref-local { background: rgba(78, 201, 176, 0.2); color: var(--color-branch-local); border: 1px solid var(--color-branch-local); }
.ref-remote { background: rgba(197, 134, 192, 0.2); color: var(--color-branch-remote); border: 1px solid var(--color-branch-remote); }
.ref-tag { background: rgba(220, 220, 170, 0.2); color: var(--color-branch-tag); border: 1px solid var(--color-branch-tag); }
</style>
