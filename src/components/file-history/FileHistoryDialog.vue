<script setup lang="ts">
/**
 * 文件历史弹窗 · IDEA "Show File History" 同款
 *
 * 给定 repoPath + filePath，加载该文件的全部 commit history（git log -- <file>）
 * 左侧列表显示 commit，右侧选中后显示该 commit 中该文件的 diff。
 *
 * 复用现有 `commands.getLog(repoPath, { path })` —— LogFilter.path 已支持 pathspec 过滤。
 * Diff 走 `commands.getCommitDiff(repoPath, commitId, filePath)`。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import DiffViewer from "@/components/diff/DiffViewer.vue";
import { commands } from "@/utils/commands";
import type { CommitInfo, DiffResult, LogFilter } from "@/utils/commands";
import { errText } from "@/utils/error";
import { useRepoChangeEvents } from "@/composables/useRepoWatcher";

const props = defineProps<{
  visible: boolean;
  repoPath: string;
  filePath: string;
}>();

const emit = defineEmits<{ (e: "update:visible", v: boolean): void }>();

const PAGE_LIMIT = 100;

const loading = ref(false);
const error = ref<string | null>(null);
const commits = ref<CommitInfo[]>([]);
const selectedCommitId = ref<string | null>(null);
const diff = ref<DiffResult | null>(null);
const diffLoading = ref(false);
const diffError = ref<string | null>(null);
const hasMore = ref(true);
const loadingMore = ref(false);
let historyLoadSeq = 0;
let diffLoadSeq = 0;

const fileName = computed(() => {
  if (!props.filePath) return "";
  const parts = props.filePath.split(/[/\\]/);
  return parts[parts.length - 1] ?? props.filePath;
});

async function loadHistory(skip: number, append: boolean) {
  if (!props.visible || !props.repoPath || !props.filePath) return;
  const repoPath = props.repoPath;
  const filePath = props.filePath;
  const seq = ++historyLoadSeq;
  if (append) loadingMore.value = true;
  else loading.value = true;
  error.value = null;
  try {
    const filter: LogFilter = {
      skip,
      limit: PAGE_LIMIT,
      branch: null,
      author: null,
      dateFrom: null,
      dateTo: null,
      path: filePath,
      searchText: "",
      useRegex: false,
      matchCase: false,
    };
    const result = await commands.getLog(repoPath, filter);
    if (
      seq !== historyLoadSeq ||
      !props.visible ||
      props.repoPath !== repoPath ||
      props.filePath !== filePath
    ) {
      return;
    }
    if (append) commits.value.push(...result.commits);
    else {
      const previousId = selectedCommitId.value;
      commits.value = result.commits;
      selectedCommitId.value =
        (previousId && result.commits.some((commit) => commit.id === previousId)
          ? previousId
          : result.commits[0]?.id) ?? null;
    }
    hasMore.value = result.commits.length === PAGE_LIMIT;
  } catch (e) {
    if (seq === historyLoadSeq) error.value = errText(e);
  } finally {
    if (seq === historyLoadSeq) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

async function loadDiff(commitId: string) {
  const repoPath = props.repoPath;
  const filePath = props.filePath;
  const seq = ++diffLoadSeq;
  diffLoading.value = true;
  diffError.value = null;
  diff.value = null;
  try {
    const next = await commands.getCommitDiff(repoPath, commitId, filePath);
    if (
      seq === diffLoadSeq &&
      props.visible &&
      props.repoPath === repoPath &&
      props.filePath === filePath &&
      selectedCommitId.value === commitId
    ) {
      diff.value = next;
    }
  } catch (e) {
    if (seq === diffLoadSeq) diffError.value = errText(e);
  } finally {
    if (seq === diffLoadSeq) diffLoading.value = false;
  }
}

async function refreshHistorySnapshot(): Promise<void> {
  if (!props.visible) return;
  const selectedId = selectedCommitId.value;
  await loadHistory(0, false);
  // 同一 SHA 仍存在时 ref 标签可能已变；watch 不会触发，主动重拉右侧快照。
  if (selectedId && selectedCommitId.value === selectedId) {
    await loadDiff(selectedId);
  }
}

watch(
  () => [props.visible, props.repoPath, props.filePath].join("|"),
  () => {
    if (!props.visible) return;
    commits.value = [];
    selectedCommitId.value = null;
    diff.value = null;
    void loadHistory(0, false);
  },
  { immediate: true }
);

watch(selectedCommitId, (id) => {
  if (id) void loadDiff(id);
  else {
    diffLoadSeq += 1;
    diff.value = null;
  }
});

useRepoChangeEvents({
  repoPath: () => props.repoPath,
  kinds: ["head", "refs"],
  onEvent: () => {
    void refreshHistorySnapshot();
  },
});

function selectCommit(c: CommitInfo) {
  selectedCommitId.value = c.id;
}

function close() {
  emit("update:visible", false);
}

function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return;
  if (e.key === "Escape") {
    e.preventDefault();
    close();
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!commits.value.length) return;
    const idx = commits.value.findIndex((c) => c.id === selectedCommitId.value);
    const next =
      e.key === "ArrowDown"
        ? Math.min(idx + 1, commits.value.length - 1)
        : Math.max(idx - 1, 0);
    selectedCommitId.value = commits.value[next]!.id;
    e.preventDefault();
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
  { immediate: true }
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function fmtTime(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleString();
}

function shortenSha(sha: string): string {
  return (sha ?? "").substring(0, 7);
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value) return;
  await loadHistory(commits.value.length, true);
}

function copyCommitId(sha: string) {
  void navigator.clipboard.writeText(sha);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.visible" class="fh-mask" @click.self="close">
      <div class="fh-dialog" role="dialog" :aria-label="`${fileName} 的历史`">
        <header class="fh-header">
          <div class="fh-title">
            <span class="fh-title-text">文件历史</span>
            <span class="fh-file-path" :title="props.filePath">{{ props.filePath }}</span>
          </div>
          <button class="fh-close" @click="close" title="关闭 (Esc)">✕</button>
        </header>

        <div class="fh-body">
          <aside class="fh-commits">
            <div v-if="loading" class="fh-loading">加载中…</div>
            <div v-else-if="error" class="fh-error">加载失败：{{ error }}</div>
            <div v-else-if="commits.length === 0" class="fh-empty">
              该文件没有提交历史（或仅在工作区，尚未跟踪）
            </div>
            <ul v-else class="fh-list">
              <li
                v-for="c in commits"
                :key="c.id"
                class="fh-item"
                :class="{ active: selectedCommitId === c.id }"
                @click="selectCommit(c)"
                @contextmenu.prevent="copyCommitId(c.id)"
                :title="`双击/右键复制 ${c.id}`"
              >
                <span class="fh-item-sha">{{ shortenSha(c.shortId || c.id) }}</span>
                <div class="fh-item-main">
                  <div class="fh-item-subject">{{ c.summary }}</div>
                  <div class="fh-item-meta">
                    <span class="fh-item-author">{{ c.author }}</span>
                    <span class="fh-item-time">{{ fmtTime(c.authorTime) }}</span>
                  </div>
                </div>
              </li>
              <li v-if="hasMore" class="fh-more">
                <button class="fh-more-btn" :disabled="loadingMore" @click="loadMore">
                  {{ loadingMore ? "加载中…" : `加载更多（已显示 ${commits.length}）` }}
                </button>
              </li>
            </ul>
          </aside>

          <section class="fh-diff">
            <div v-if="!selectedCommitId" class="fh-diff-empty">选择左侧提交查看差异</div>
            <div v-else-if="diffLoading" class="fh-diff-loading">读取差异…</div>
            <div v-else-if="diffError" class="fh-diff-error">差异加载失败：{{ diffError }}</div>
            <div v-else-if="diff && diff.binary" class="fh-diff-binary">
              二进制文件 · 不显示文本差异
            </div>
            <div v-else-if="diff && diff.hunks && diff.hunks.length > 0" class="fh-diff-content">
              <DiffViewer :diff="diff" />
            </div>
            <div v-else class="fh-diff-empty">
              该提交中此文件无可显示的差异（新增空文件或纯重命名）
            </div>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.fh-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8800;
}

.fh-dialog {
  width: min(1280px, 96vw);
  height: min(820px, 92vh);
  background: var(--color-surface);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg, 10px);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.fh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  background: var(--color-background);
  border-bottom: 1px solid var(--color-border);
  gap: 12px;
}

.fh-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}

.fh-title-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-foreground-bright);
  white-space: nowrap;
}

.fh-file-path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-foreground-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fh-close {
  background: transparent;
  border: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm, 4px);
}

.fh-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.fh-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.fh-commits {
  width: 380px;
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  background: var(--color-background);
}

.fh-loading,
.fh-error,
.fh-empty,
.fh-diff-empty,
.fh-diff-loading,
.fh-diff-error,
.fh-diff-binary {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--color-foreground-muted);
}

.fh-error,
.fh-diff-error {
  color: var(--color-error);
}

.fh-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}

.fh-item {
  display: flex;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background var(--transition-fast, 100ms ease);
}

.fh-item:hover {
  background: var(--color-surface-hover);
}

.fh-item.active {
  background: var(--color-surface-active);
  border-left-color: var(--color-primary);
}

.fh-item-sha {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-foreground-muted);
  padding-top: 2px;
  flex-shrink: 0;
}

.fh-item-main {
  flex: 1;
  min-width: 0;
}

.fh-item-subject {
  font-size: 13px;
  color: var(--color-foreground-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fh-item-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--color-foreground-muted);
  margin-top: 2px;
}

.fh-item-author {
  flex-shrink: 0;
}

.fh-item-time {
  flex-shrink: 0;
}

.fh-more {
  padding: 8px;
}

.fh-more-btn {
  width: 100%;
  background: transparent;
  border: 1px dashed var(--color-border-strong);
  color: var(--color-foreground-muted);
  border-radius: var(--radius-sm, 4px);
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.fh-more-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.fh-diff {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-surface);
}

.fh-diff-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
