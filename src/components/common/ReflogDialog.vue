<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { commands } from "@/utils/commands";
import type { ReflogEntry } from "@/utils/commands";
import { translateGitError } from "@/utils/git-error";
import { formatTimestamp } from "@/utils/format";

const props = defineProps<{
  visible: boolean;
  repoPath: string;
}>();

const emit = defineEmits<{
  close: [];
  /** 用户在某个 reflog entry 上做了不可撤销的操作（reset --hard），调用方应刷新 UI */
  changed: [];
}>();

const loading = ref(false);
const entries = ref<ReflogEntry[]>([]);
const selectedIndex = ref<number | null>(null);
const errorMsg = ref<string>("");
const busy = ref(false);
const limit = ref(200);

const selectedEntry = computed<ReflogEntry | null>(() =>
  selectedIndex.value == null ? null : (entries.value[selectedIndex.value] ?? null)
);

const filterText = ref("");
const filteredEntries = computed<ReflogEntry[]>(() => {
  const q = filterText.value.trim().toLowerCase();
  if (!q) return entries.value;
  return entries.value.filter(
    (e) =>
      e.action.toLowerCase().includes(q) ||
      e.subject.toLowerCase().includes(q) ||
      e.shortId.toLowerCase().includes(q) ||
      e.ref.toLowerCase().includes(q)
  );
});

async function loadEntries(): Promise<void> {
  if (!props.repoPath) return;
  loading.value = true;
  errorMsg.value = "";
  try {
    entries.value = await commands.getReflog(props.repoPath, limit.value);
    selectedIndex.value = entries.value.length > 0 ? 0 : null;
  } catch (e: unknown) {
    errorMsg.value = translateGitError(e instanceof Error ? e.message : String(e));
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleResetHard(entry: ReflogEntry): Promise<void> {
  if (busy.value) return;
  const ok = window.confirm(
    `⚠ 不可撤销操作\n\n` +
      `将执行 git reset --hard ${entry.shortId}\n\n` +
      `→ HEAD 跳到：${entry.subject}\n` +
      `→ ${entry.ref}（${entry.action}）\n\n` +
      `** 这会丢弃当前工作区所有未提交的改动 **，无法回退。继续吗？`
  );
  if (!ok) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    await commands.resetToCommit(props.repoPath, entry.commitId, "hard");
    await loadEntries();
    emit("changed");
  } catch (e: unknown) {
    errorMsg.value = translateGitError(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

async function handleCheckoutInNewBranch(entry: ReflogEntry): Promise<void> {
  if (busy.value) return;
  const suggested = `recovery/${entry.shortId}`;
  const name = window.prompt(
    `在 ${entry.shortId}（${entry.subject}）上创建新分支：\n` +
      `（这会在该 commit 上新建分支并切换过去，安全无损）`,
    suggested
  );
  if (!name || !name.trim()) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    await commands.createBranch(props.repoPath, name.trim(), entry.commitId);
    await commands.checkoutBranch(props.repoPath, name.trim());
    emit("changed");
    emit("close");
  } catch (e: unknown) {
    errorMsg.value = translateGitError(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

function handleCopyHash(entry: ReflogEntry): void {
  void navigator.clipboard?.writeText(entry.commitId);
}

function handleClose(): void {
  emit("close");
}

function actionBadgeClass(action: string): string {
  const a = action.toLowerCase();
  if (a.startsWith("reset")) return "action-reset";
  if (a.startsWith("commit")) return "action-commit";
  if (a.startsWith("merge")) return "action-merge";
  if (a.startsWith("rebase")) return "action-rebase";
  if (a.startsWith("checkout")) return "action-checkout";
  if (a.startsWith("pull")) return "action-pull";
  if (a.startsWith("cherry-pick")) return "action-cherry";
  if (a.startsWith("revert")) return "action-revert";
  return "action-other";
}

function actionShort(action: string): string {
  const colon = action.indexOf(":");
  return colon > 0 ? action.slice(0, colon) : action;
}

watch(
  () => props.visible,
  (v) => {
    if (v) loadEntries();
  },
  { immediate: true }
);
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="reflog-overlay" @click.self="handleClose">
      <div class="reflog-panel">
        <div class="reflog-header">
          <span class="reflog-title">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            迷路 · Git Reflog
          </span>
          <button class="reflog-close" :title="'关闭'" @click="handleClose">✕</button>
        </div>

        <div class="reflog-toolbar">
          <input
            v-model="filterText"
            class="reflog-filter"
            placeholder="过滤：动作 / commit 摘要 / hash"
            spellcheck="false"
          />
          <span class="reflog-stats">{{ filteredEntries.length }} / {{ entries.length }}</span>
          <button class="reflog-refresh" :disabled="loading" :title="'刷新'" @click="loadEntries">
            <span v-if="loading">刷新中…</span><span v-else>刷新</span>
          </button>
        </div>

        <div v-if="errorMsg" class="reflog-error">{{ errorMsg }}</div>

        <div class="reflog-body">
          <div class="reflog-list">
            <div v-if="loading" class="reflog-empty">加载中…</div>
            <div v-else-if="entries.length === 0" class="reflog-empty">
              当前仓库尚无 reflog 记录
            </div>
            <div
              v-for="(entry, idx) in filteredEntries"
              :key="entry.ref + '_' + entry.commitId"
              class="reflog-row"
              :class="{ selected: selectedEntry?.ref === entry.ref }"
              @click="selectedIndex = entries.indexOf(entry)"
              @dblclick="handleCheckoutInNewBranch(entry)"
            >
              <span class="reflog-ref">{{ entry.ref }}</span>
              <span class="reflog-action" :class="actionBadgeClass(entry.action)">
                {{ actionShort(entry.action) }}
              </span>
              <span class="reflog-hash">{{ entry.shortId }}</span>
              <span class="reflog-subject">{{ entry.subject }}</span>
              <span class="reflog-time">{{ formatTimestamp(entry.time) }}</span>
              <span
                v-if="idx === 0 && !filterText"
                class="reflog-current"
                title="当前 HEAD 位置"
                >当前</span
              >
            </div>
          </div>

          <div class="reflog-detail">
            <template v-if="selectedEntry">
              <div class="detail-row">
                <span class="detail-label">Ref</span>
                <span class="detail-value mono">{{ selectedEntry.ref }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">动作</span>
                <span class="detail-value">{{ selectedEntry.action }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Commit</span>
                <span class="detail-value mono">{{ selectedEntry.commitId }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">摘要</span>
                <span class="detail-value">{{ selectedEntry.subject }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">时间</span>
                <span class="detail-value">{{ formatTimestamp(selectedEntry.time) }}</span>
              </div>
              <div class="detail-actions">
                <button
                  class="detail-btn detail-btn--safe"
                  :disabled="busy"
                  title="在该 commit 上新建分支并切换过去（推荐 · 无损恢复）"
                  @click="handleCheckoutInNewBranch(selectedEntry)"
                >
                  ✚ 在新分支签出此 commit
                </button>
                <button
                  class="detail-btn detail-btn--danger"
                  :disabled="busy"
                  title="git reset --hard 跳回此 commit（会丢弃当前工作区改动）"
                  @click="handleResetHard(selectedEntry)"
                >
                  ⚠ Reset --hard 跳回这里
                </button>
                <button
                  class="detail-btn"
                  :disabled="busy"
                  title="复制完整 commit hash"
                  @click="handleCopyHash(selectedEntry)"
                >
                  复制 hash
                </button>
              </div>
              <p class="detail-tip">
                提示：上面的 <strong>「在新分支签出」</strong> 是无损恢复方式，
                推荐用它把误丢的提交拉回到独立分支上做 review；
                <strong>Reset --hard</strong> 会改变 HEAD 且丢弃当前未提交的工作区改动。
              </p>
            </template>
            <p v-else class="detail-empty">左侧选一条 reflog 记录查看可执行操作</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.reflog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reflog-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  width: 900px;
  max-width: 95vw;
  height: 560px;
  max-height: 90vh;
  overflow: hidden;
}

.reflog-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
}

.reflog-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-foreground);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.reflog-close {
  background: none;
  border: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
}

.reflog-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.reflog-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
}

.reflog-filter {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-foreground);
}

.reflog-filter:focus {
  outline: none;
  border-color: var(--color-primary);
}

.reflog-stats {
  font-size: 11px;
  color: var(--color-foreground-muted);
  font-family: var(--font-mono);
}

.reflog-refresh {
  padding: 4px 10px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-foreground);
  font-size: 11px;
  cursor: pointer;
}

.reflog-refresh:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.reflog-error {
  padding: 6px 14px;
  background: color-mix(in srgb, var(--color-error, #e05252) 12%, transparent);
  color: var(--color-error, #e05252);
  font-size: 11px;
  border-bottom: 1px solid var(--color-border);
}

.reflog-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.reflog-list {
  flex: 1.6;
  overflow-y: auto;
  border-right: 1px solid var(--color-border);
  background: var(--color-background);
}

.reflog-empty {
  padding: 16px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

.reflog-row {
  display: grid;
  grid-template-columns: 64px 80px 60px 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 40%, transparent);
  cursor: pointer;
  font-size: 11px;
}

.reflog-row:hover {
  background: var(--color-surface-hover);
}

.reflog-row.selected {
  background: var(--color-surface-active);
}

.reflog-ref {
  font-family: var(--font-mono);
  color: var(--color-foreground-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

.reflog-action {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  text-transform: lowercase;
  white-space: nowrap;
}

.action-reset {
  background: color-mix(in srgb, #e05252 18%, transparent);
  color: #e98787;
}
.action-commit {
  background: color-mix(in srgb, #4caf50 18%, transparent);
  color: #6cbf6f;
}
.action-merge {
  background: color-mix(in srgb, #ff9800 18%, transparent);
  color: #ffae3c;
}
.action-rebase {
  background: color-mix(in srgb, #9c27b0 18%, transparent);
  color: #b65fcb;
}
.action-checkout {
  background: color-mix(in srgb, #2196f3 18%, transparent);
  color: #4fa9f0;
}
.action-pull {
  background: color-mix(in srgb, #00bcd4 18%, transparent);
  color: #2dc9d8;
}
.action-cherry {
  background: color-mix(in srgb, #f06292 18%, transparent);
  color: #f3a0bb;
}
.action-revert {
  background: color-mix(in srgb, #795548 18%, transparent);
  color: #ad8d80;
}
.action-other {
  background: var(--color-surface-active);
  color: var(--color-foreground-muted);
}

.reflog-hash {
  font-family: var(--font-mono);
  color: var(--color-foreground-muted);
}

.reflog-subject {
  color: var(--color-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reflog-time {
  font-size: 10px;
  color: var(--color-foreground-muted);
  white-space: nowrap;
}

.reflog-current {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-primary) 20%, transparent);
  color: var(--color-primary);
}

.reflog-detail {
  flex: 1;
  padding: 14px;
  background: var(--color-surface);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-row {
  display: flex;
  gap: 8px;
  font-size: 11px;
}

.detail-label {
  width: 56px;
  color: var(--color-foreground-muted);
  flex-shrink: 0;
}

.detail-value {
  color: var(--color-foreground);
  word-break: break-all;
}

.detail-value.mono {
  font-family: var(--font-mono);
}

.detail-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.detail-btn {
  padding: 6px 10px;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
}

.detail-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.detail-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.detail-btn--safe {
  background: color-mix(in srgb, var(--color-primary) 18%, transparent);
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 30%, transparent);
}

.detail-btn--safe:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary) 28%, transparent);
}

.detail-btn--danger {
  background: color-mix(in srgb, var(--color-error, #e05252) 18%, transparent);
  color: var(--color-error, #e05252);
  border-color: color-mix(in srgb, var(--color-error, #e05252) 30%, transparent);
}

.detail-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-error, #e05252) 28%, transparent);
}

.detail-tip {
  margin: 8px 0 0;
  padding: 6px 8px;
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: color-mix(in srgb, var(--color-warning, #ffd54f) 8%, var(--color-background));
  border-radius: 3px;
  line-height: 1.5;
}

.detail-empty {
  color: var(--color-foreground-muted);
  font-size: 12px;
  text-align: center;
  margin-top: 32px;
}
</style>
