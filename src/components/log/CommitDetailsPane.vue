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

// 请求序号守卫：快速切 commit 时，只让最新一次请求的结果落库，避免迟到的旧请求覆盖当前详情
let detailLoadSeq = 0;
watch(
  () => [logStore.selectedCommitId, logStore.selectionRefreshToken] as const,
  async ([commitId]) => {
    const seq = ++detailLoadSeq;
    const repoPath = repoStore.activeRepo?.path;
    if (!commitId || !repoPath) {
      selectedCommit.value = null;
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const detail = await commands.getCommitDetail(repoPath, commitId);
      if (seq === detailLoadSeq) selectedCommit.value = detail;
    } catch {
      if (seq === detailLoadSeq) {
        const fallback = logStore.commits.find((c) => c.id === commitId);
        selectedCommit.value = fallback ?? null;
      }
    } finally {
      if (seq === detailLoadSeq) loading.value = false;
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
      <span class="pane-title">提交详情</span>
    </div>

    <div v-if="loading" class="empty">加载中...</div>

    <div v-else-if="!selectedCommit" class="empty">选择一个提交查看详情</div>

    <div v-else class="details-content">
      <div class="commit-message">{{ selectedCommit.message }}</div>

      <div class="detail-rows">
        <div class="detail-row">
          <span class="detail-label">哈希</span>
          <span class="detail-value mono hash-value" @click="copyHash" title="点击复制">
            {{ selectedCommit.id }}
          </span>
        </div>

        <div class="detail-row">
          <span class="detail-label">作者</span>
          <span class="detail-value">
            {{ selectedCommit.author }}
            <span class="email">&lt;{{ selectedCommit.authorEmail }}&gt;</span>
          </span>
        </div>

        <div class="detail-row">
          <span class="detail-label">日期</span>
          <span class="detail-value">{{ formatFullDate(selectedCommit.authorTime) }}</span>
        </div>

        <div v-if="selectedCommit.author !== selectedCommit.committer" class="detail-row">
          <span class="detail-label">提交者</span>
          <span class="detail-value">
            {{ selectedCommit.committer }}
            <span class="email">&lt;{{ selectedCommit.committerEmail }}&gt;</span>
          </span>
        </div>

        <div v-if="selectedCommit.parents.length > 0" class="detail-row">
          <span class="detail-label">父提交</span>
          <span class="detail-value">
            <span
              v-for="parent in selectedCommit.parents"
              :key="parent"
              class="parent-hash mono"
              @click="logStore.selectCommit(parent)"
              >{{ shortenHash(parent) }}</span
            >
          </span>
        </div>

        <div v-if="selectedCommit.refs.length > 0" class="detail-row">
          <span class="detail-label">引用</span>
          <span class="detail-value refs-value">
            <span
              v-for="commitRef in selectedCommit.refs"
              :key="commitRef.name"
              class="ref-badge"
              :class="'ref-' + commitRef.refType"
              >{{ commitRef.name }}</span
            >
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
  background: var(--color-background);
}

.pane-header {
  display: flex;
  align-items: center;
  min-height: var(--panel-header-height);
  padding: 0 8px;
  background: var(--color-surface-emphasis);
  flex-shrink: 0;
}

.pane-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-foreground-muted);
  user-select: none;
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
  padding: 10px;
  user-select: text;
  cursor: text;
}

.details-content ::selection {
  background: var(--color-primary, #007acc);
  color: #fff;
}

.commit-message {
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 10px;
  padding: 8px 10px;
  background: var(--color-surface-muted);
  border-radius: var(--radius-md);
  color: var(--color-foreground-bright);
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
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: 10px;
  font-weight: 500;
}

.ref-head {
  background: color-mix(in srgb, var(--color-branch-head) 18%, transparent);
  color: var(--color-branch-head);
  border-color: color-mix(in srgb, var(--color-branch-head) 42%, transparent);
}
.ref-local {
  background: color-mix(in srgb, var(--color-branch-local) 14%, transparent);
  color: var(--color-branch-local);
  border-color: color-mix(in srgb, var(--color-branch-local) 36%, transparent);
}
.ref-remote {
  background: color-mix(in srgb, var(--color-branch-remote) 14%, transparent);
  color: var(--color-branch-remote);
  border-color: color-mix(in srgb, var(--color-branch-remote) 36%, transparent);
}
.ref-tag {
  background: color-mix(in srgb, var(--color-branch-tag) 14%, transparent);
  color: var(--color-branch-tag);
  border-color: color-mix(in srgb, var(--color-branch-tag) 36%, transparent);
}
</style>
