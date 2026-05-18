<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useLogStore } from "@/stores/logStore";
import { useRepoStore } from "@/stores/repoStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRebaseStore } from "@/stores/rebaseStore";
import Toolbar from "@/components/common/Toolbar.vue";
import ToolbarButton from "@/components/common/ToolbarButton.vue";
import SearchBar from "@/components/common/SearchBar.vue";
import ContextMenu from "@/components/common/ContextMenu.vue";
import type { MenuItem } from "@/components/common/ContextMenu.vue";
import type { CommitInfo } from "@/utils/commands";
import { commands } from "@/utils/commands";
import { formatTimestamp } from "@/utils/format";

const logStore = useLogStore();
const repoStore = useRepoStore();
const settings = useSettingsStore();
const rebaseStore = useRebaseStore();

const listRef = ref<HTMLElement>();
const contextMenuRef = ref<InstanceType<typeof ContextMenu>>();
const contextCommit = ref<CommitInfo | null>(null);

// Reset 对话框
const showResetDialog = ref(false);
const resetMode = ref<"soft" | "mixed" | "hard">("mixed");

// 通用二次确认对话框
const showConfirmDialog = ref(false);
const confirmTitle = ref("");
const confirmText = ref("");
const pendingAction = ref<(() => Promise<void>) | null>(null);

// Toast
const toastMessage = ref("");
const toastVisible = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string) {
  toastMessage.value = msg;
  toastVisible.value = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 2500);
}

const ROW_HEIGHT = 24;
const OVERSCAN = 10;
const scrollTop = ref(0);
const viewportHeight = ref(600);
let resizeObserver: ResizeObserver | null = null;

const totalCount = computed(() => logStore.commits.length);
const totalHeight = computed(() => totalCount.value * ROW_HEIGHT);
const visibleStart = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN)
);
const visibleEnd = computed(() =>
  Math.min(
    totalCount.value,
    Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + OVERSCAN
  )
);
const offsetY = computed(() => visibleStart.value * ROW_HEIGHT);
const visibleCommits = computed(() => logStore.commits.slice(visibleStart.value, visibleEnd.value));

function onScroll(e: Event) {
  const el = e.target as HTMLElement;
  scrollTop.value = el.scrollTop;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    if (logStore.hasMore && !logStore.loading) {
      logStore.loadCommits();
    }
  }
}

onMounted(() => {
  if (!listRef.value) return;
  viewportHeight.value = listRef.value.clientHeight || 600;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        viewportHeight.value = entry.contentRect.height;
      }
    });
    resizeObserver.observe(listRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

function selectCommit(commit: CommitInfo, event: MouseEvent) {
  logStore.selectCommit(commit.id, event.ctrlKey || event.metaKey);
}

function showContextMenu(event: MouseEvent, commit: CommitInfo) {
  contextCommit.value = commit;
  contextMenuRef.value?.show(event);
}

// ---- Cherry-pick ----
async function handleCherryPick() {
  if (!contextCommit.value || !repoStore.activeRepo) return;
  const commit = contextCommit.value;
  try {
    const result = await commands.cherryPick(repoStore.activeRepo.path, commit.id);
    if (result.success) {
      await logStore.loadCommits(true);
      showToast(`Cherry-pick 成功：${commit.shortId}`);
    } else {
      showToast(`Cherry-pick 产生冲突，请手动解决：${result.conflicts.join(", ")}`);
    }
  } catch (e: any) {
    showToast(`Cherry-pick 失败：${e.message}`);
  }
}

// ---- Checkout Revision ----
function handleCheckoutRevision() {
  if (!contextCommit.value) return;
  const commit = contextCommit.value;
  confirmTitle.value = "Checkout Revision";
  confirmText.value = `将 HEAD 切换到提交 ${commit.shortId}（${commit.summary}）。\n\n这会进入"分离 HEAD"状态，新的提交不会属于任何分支。确定继续吗？`;
  pendingAction.value = async () => {
    if (!repoStore.activeRepo) return;
    try {
      await commands.checkoutBranch(repoStore.activeRepo.path, commit.id);
      await logStore.loadCommits(true);
      showToast(`已切换到 ${commit.shortId}`);
    } catch (e: any) {
      showToast(`Checkout 失败：${e.message}`);
    }
  };
  showConfirmDialog.value = true;
}

// ---- Revert Commit ----
function handleRevertCommit() {
  if (!contextCommit.value) return;
  const commit = contextCommit.value;
  confirmTitle.value = "Revert Commit";
  confirmText.value = `创建一个新提交来撤销 ${commit.shortId}（${commit.summary}）的变更。确定继续吗？`;
  pendingAction.value = async () => {
    if (!repoStore.activeRepo) return;
    try {
      const result = await commands.revertCommit(repoStore.activeRepo.path, commit.id);
      if (result.success) {
        await logStore.loadCommits(true);
        showToast(`已成功 Revert ${commit.shortId}`);
      } else {
        showToast(`Revert 产生冲突，请手动解决：${result.conflicts.join(", ")}`);
      }
    } catch (e: any) {
      showToast(`Revert 失败：${e.message}`);
    }
  };
  showConfirmDialog.value = true;
}

// ---- Reset Current Branch to Here ----
function handleResetToHere() {
  if (!contextCommit.value) return;
  resetMode.value = "mixed";
  showResetDialog.value = true;
}

async function doReset() {
  if (!contextCommit.value || !repoStore.activeRepo) return;
  const commit = contextCommit.value;
  showResetDialog.value = false;
  try {
    await commands.resetToCommit(repoStore.activeRepo.path, commit.id, resetMode.value);
    await logStore.loadCommits(true);
    showToast(`已 Reset（${resetMode.value}）到 ${commit.shortId}`);
  } catch (e: any) {
    showToast(`Reset 失败：${e.message}`);
  }
}

// ---- Squash N commits ----
/**
 * 判断当前选中是否满足 squash 前提：包含 HEAD 的连续 N 个 commit（N >= 2）。
 * 返回 N，不满足返回 0。
 */
function getSquashableCount(): number {
  const ids = new Set(logStore.selectedCommitIds);
  if (ids.size < 2) return 0;
  const commits = logStore.commits;
  if (commits.length < ids.size) return 0;
  // 必须包含 HEAD（commits[0]）以及紧随其后的连续 ids.size - 1 个
  for (let i = 0; i < ids.size; i++) {
    if (!ids.has(commits[i]!.id)) return 0;
  }
  return ids.size;
}

const squashableCount = computed(() => getSquashableCount());

async function handleSquashCommits() {
  const count = getSquashableCount();
  if (count < 2) return;
  if (!repoStore.activeRepo) return;
  const commits = logStore.commits.slice(0, count);
  const defaultMessage = `${commits[0]!.summary}\n\nSquashed ${count} commits:\n${commits
    .map((c) => `- ${c.shortId} ${c.summary}`)
    .join("\n")}`;
  const message = window.prompt(
    `合并最近 ${count} 个 commit（包含 HEAD）为一个新 commit。\n输入合并后的 commit message：`,
    defaultMessage
  );
  if (!message || message.trim().length === 0) return;
  try {
    await commands.squashCommits(repoStore.activeRepo.path, count, message);
    logStore.clearSelection();
    await logStore.loadCommits(true);
    showToast(`已合并 ${count} 个 commit`);
  } catch (e: any) {
    showToast(`Squash 失败：${e.message}`);
  }
}

// ---- Interactive Rebase from here ----
/**
 * 以右键的 commit 为 base（不含），rebase 其后所有 commit (baseRef..HEAD]。
 * 当前 commit 必须在 HEAD 之前（HEAD 自身或更晚则没有可编排的 commit）。
 */
async function handleInteractiveRebase() {
  if (!contextCommit.value) return;
  const commit = contextCommit.value;
  await rebaseStore.openSequencer(commit.id, `${commit.shortId} ${commit.summary}`);
}

// ---- Save as Patch ----
async function handleSaveAsPatch() {
  if (!contextCommit.value || !repoStore.activeRepo) return;
  const commit = contextCommit.value;
  try {
    const patch = await commands.createPatch(repoStore.activeRepo.path, commit.id);
    const filename = `${commit.shortId}-${commit.summary.slice(0, 40).replace(/[^\w.-]+/g, "_")}.patch`;
    const blob = new Blob([patch], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
    showToast(`已导出 patch：${filename}`);
  } catch (e: any) {
    showToast(`导出 patch 失败：${e.message}`);
  }
}

// ---- 二次确认 ----
async function doConfirmAction() {
  showConfirmDialog.value = false;
  if (pendingAction.value) {
    await pendingAction.value();
    pendingAction.value = null;
  }
}

function cancelConfirm() {
  showConfirmDialog.value = false;
  pendingAction.value = null;
}

const contextMenuItems = computed<MenuItem[]>(() => {
  if (!contextCommit.value) return [];
  return [
    {
      label: "复制 Revision",
      action: () => navigator.clipboard.writeText(contextCommit.value!.id),
    },
    {
      label: "复制提交信息",
      action: () => navigator.clipboard.writeText(contextCommit.value!.summary),
    },
    { separator: true, label: "" },
    { label: "Cherry-pick", action: handleCherryPick },
    { label: "Checkout Revision", action: handleCheckoutRevision },
    { separator: true, label: "" },
    { label: "新建分支...", action: () => {} },
    { label: "新建 Tag...", action: () => {} },
    { separator: true, label: "" },
    { label: "Save as Patch...", action: handleSaveAsPatch },
    ...(squashableCount.value >= 2
      ? [
          {
            label: `Squash ${squashableCount.value} commits 为一个...`,
            action: handleSquashCommits,
          },
        ]
      : []),
    { label: "Interactive Rebase from here...", action: handleInteractiveRebase },
    { separator: true, label: "" },
    { label: "Reset Current Branch to Here...", action: handleResetToHere },
    { label: "Revert Commit", action: handleRevertCommit },
  ];
});

function onSearch() {
  logStore.loadCommits(true);
}

// ---- Filter popovers (author / date) ----
const showAuthorPopover = ref(false);
const showDatePopover = ref(false);
const authorInput = ref("");
const dateFromInput = ref("");
const dateToInput = ref("");
const authorWrapRef = ref<HTMLElement>();
const dateWrapRef = ref<HTMLElement>();
const authorPopoverRef = ref<HTMLElement>();
const datePopoverRef = ref<HTMLElement>();
const authorPopoverPos = ref({ top: 0, left: 0 });
const datePopoverPos = ref({ top: 0, left: 0 });

const hasAuthorFilter = computed(() => !!logStore.filter.author);
const hasDateFilter = computed(
  () => !!(logStore.filter.dateFrom || logStore.filter.dateTo)
);

// 候选作者：基于当前已加载的 commits 去重，给 <datalist> 用
const authorSuggestions = computed(() => {
  const set = new Set<string>();
  for (const c of logStore.commits) {
    if (c.author) set.add(c.author);
  }
  return [...set].sort();
});

function computePopoverPos(anchor: HTMLElement | undefined): {
  top: number;
  left: number;
} {
  if (!anchor) return { top: 0, left: 0 };
  const rect = anchor.getBoundingClientRect();
  return { top: rect.bottom + 4, left: rect.left };
}

function toggleAuthorPopover() {
  showDatePopover.value = false;
  if (showAuthorPopover.value) {
    showAuthorPopover.value = false;
    return;
  }
  authorInput.value = logStore.filter.author ?? "";
  authorPopoverPos.value = computePopoverPos(authorWrapRef.value);
  showAuthorPopover.value = true;
}

function toggleDatePopover() {
  showAuthorPopover.value = false;
  if (showDatePopover.value) {
    showDatePopover.value = false;
    return;
  }
  dateFromInput.value = logStore.filter.dateFrom ?? "";
  dateToInput.value = logStore.filter.dateTo ?? "";
  datePopoverPos.value = computePopoverPos(dateWrapRef.value);
  showDatePopover.value = true;
}

function applyAuthor() {
  logStore.filter.author = authorInput.value.trim() || null;
  showAuthorPopover.value = false;
  logStore.loadCommits(true);
}

function clearAuthor() {
  logStore.filter.author = null;
  authorInput.value = "";
  showAuthorPopover.value = false;
  logStore.loadCommits(true);
}

function applyDate() {
  logStore.filter.dateFrom = dateFromInput.value || null;
  logStore.filter.dateTo = dateToInput.value || null;
  showDatePopover.value = false;
  logStore.loadCommits(true);
}

function clearDate() {
  logStore.filter.dateFrom = null;
  logStore.filter.dateTo = null;
  dateFromInput.value = "";
  dateToInput.value = "";
  showDatePopover.value = false;
  logStore.loadCommits(true);
}

function setDatePreset(days: number) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };
  dateFromInput.value = fmt(from);
  dateToInput.value = fmt(to);
}

function onPopoverDocClick(e: MouseEvent) {
  const target = e.target as Node;
  if (
    showAuthorPopover.value &&
    !authorWrapRef.value?.contains(target) &&
    !authorPopoverRef.value?.contains(target)
  ) {
    showAuthorPopover.value = false;
  }
  if (
    showDatePopover.value &&
    !dateWrapRef.value?.contains(target) &&
    !datePopoverRef.value?.contains(target)
  ) {
    showDatePopover.value = false;
  }
}

function onPopoverDocKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    showAuthorPopover.value = false;
    showDatePopover.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", onPopoverDocClick);
  document.addEventListener("keydown", onPopoverDocKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onPopoverDocClick);
  document.removeEventListener("keydown", onPopoverDocKeydown);
});

function getRefClass(refType: string): string {
  const classes: Record<string, string> = {
    head: "ref-head",
    local: "ref-local",
    remote: "ref-remote",
    tag: "ref-tag",
  };
  return classes[refType] || "ref-local";
}
</script>

<template>
  <div class="commits-pane">
    <!-- Filter toolbar -->
    <Toolbar compact>
      <SearchBar
        v-model="logStore.filter.searchText"
        placeholder="搜索提交..."
        style="flex: 1; max-width: 300px"
        @search="onSearch"
      />

      <div ref="authorWrapRef" class="filter-anchor">
        <ToolbarButton
          :title="hasAuthorFilter ? `作者：${logStore.filter.author}` : '按作者筛选'"
          :active="hasAuthorFilter || showAuthorPopover"
          @click="toggleAuthorPopover"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span v-if="hasAuthorFilter" class="filter-dot" />
        </ToolbarButton>
      </div>

      <div ref="dateWrapRef" class="filter-anchor">
        <ToolbarButton
          :title="
            hasDateFilter
              ? `日期：${logStore.filter.dateFrom ?? '*'} ~ ${
                  logStore.filter.dateTo ?? '*'
                }`
              : '按日期筛选'
          "
          :active="hasDateFilter || showDatePopover"
          @click="toggleDatePopover"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span v-if="hasDateFilter" class="filter-dot" />
        </ToolbarButton>
      </div>

      <div style="flex: 1" />

      <ToolbarButton title="刷新" @click="logStore.loadCommits(true)">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </ToolbarButton>
    </Toolbar>

    <!-- Commit list header -->
    <div class="list-header">
      <div class="col-author">Author</div>
      <div class="col-message">Commit</div>
      <div class="col-date">Date</div>
    </div>

    <!-- Commit list (virtual scrolling) -->
    <div ref="listRef" class="commit-list" @scroll="onScroll">
      <div class="virtual-spacer" :style="{ height: totalHeight + 'px' }">
        <div class="virtual-window" :style="{ transform: `translateY(${offsetY}px)` }">
          <div
            v-for="(commit, i) in visibleCommits"
            :key="commit.id"
            class="commit-row"
            :class="{
              selected: logStore.selectedCommitIds.includes(commit.id),
              'is-merge': commit.isMerge && settings.highlightMyCommits,
              'row-even': (visibleStart + i) % 2 === 0,
              'row-odd': (visibleStart + i) % 2 === 1,
            }"
            @click="selectCommit(commit, $event)"
            @contextmenu.prevent="showContextMenu($event, commit)"
          >
            <!-- Author column -->
            <div class="col-author">{{ commit.author }}</div>

            <!-- Message column -->
            <div class="col-message">
              <span class="commit-summary">{{ commit.summary }}</span>
              <template v-if="commit.refs.length > 0">
                <span
                  v-for="ref in commit.refs"
                  :key="ref.name"
                  class="ref-badge"
                  :class="getRefClass(ref.refType)"
                >
                  {{ settings.compactReferences ? ref.name.split("/").pop() : ref.name }}
                </span>
              </template>
            </div>

            <!-- Date column -->
            <div class="col-date">{{ formatTimestamp(commit.authorTime) }}</div>
          </div>
        </div>
      </div>

      <div v-if="logStore.loading" class="loading-indicator">加载中...</div>
    </div>

    <ContextMenu ref="contextMenuRef" :items="contextMenuItems" />

    <!-- Reset 模式选择对话框 -->
    <Teleport to="body">
      <div v-if="showResetDialog" class="modal-overlay" @click.self="showResetDialog = false">
        <div class="modal-dialog reset-modal">
          <div class="modal-header">
            <span class="modal-title">Reset Current Branch to Here</span>
            <button class="modal-close" @click="showResetDialog = false">✕</button>
          </div>
          <div class="modal-body">
            <p class="reset-target">
              目标提交：<code>{{ contextCommit?.shortId }}</code>
              {{ contextCommit?.summary }}
            </p>
            <div class="reset-modes">
              <label class="reset-mode-option" :class="{ active: resetMode === 'soft' }">
                <input v-model="resetMode" type="radio" value="soft" />
                <div class="mode-info">
                  <span class="mode-name">Soft</span>
                  <span class="mode-desc">保留所有更改到暂存区（可直接重新提交）</span>
                </div>
              </label>
              <label class="reset-mode-option" :class="{ active: resetMode === 'mixed' }">
                <input v-model="resetMode" type="radio" value="mixed" />
                <div class="mode-info">
                  <span class="mode-name">Mixed <span class="mode-default">（默认）</span></span>
                  <span class="mode-desc">保留更改到工作区，取消暂存</span>
                </div>
              </label>
              <label class="reset-mode-option" :class="{ active: resetMode === 'hard' }">
                <input v-model="resetMode" type="radio" value="hard" />
                <div class="mode-info">
                  <span class="mode-name mode-danger">Hard</span>
                  <span class="mode-desc mode-danger">丢弃所有本地更改，不可恢复</span>
                </div>
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="modal-btn" @click="showResetDialog = false">取消</button>
            <button
              class="modal-btn"
              :class="resetMode === 'hard' ? 'danger' : 'primary'"
              @click="doReset"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 通用二次确认对话框 -->
    <Teleport to="body">
      <div v-if="showConfirmDialog" class="modal-overlay" @click.self="cancelConfirm">
        <div class="modal-dialog confirm-modal">
          <div class="modal-header">
            <span class="modal-title">{{ confirmTitle }}</span>
          </div>
          <div class="modal-body">
            <p class="confirm-text">{{ confirmText }}</p>
          </div>
          <div class="modal-footer">
            <button class="modal-btn" @click="cancelConfirm">取消</button>
            <button class="modal-btn primary" @click="doConfirmAction">确定</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast 通知 -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toastVisible" class="toast">{{ toastMessage }}</div>
      </Transition>
    </Teleport>

    <!-- 作者筛选 popover -->
    <Teleport to="body">
      <div
        v-if="showAuthorPopover"
        ref="authorPopoverRef"
        class="filter-popover"
        :style="{
          top: authorPopoverPos.top + 'px',
          left: authorPopoverPos.left + 'px',
        }"
      >
        <div class="popover-title">按作者筛选</div>
        <input
          v-model="authorInput"
          class="popover-input"
          type="text"
          placeholder="作者名称 / 邮箱片段"
          list="commits-author-suggestions"
          autofocus
          @keydown.enter="applyAuthor"
          @keydown.esc="showAuthorPopover = false"
        />
        <datalist id="commits-author-suggestions">
          <option v-for="a in authorSuggestions" :key="a" :value="a" />
        </datalist>
        <div class="popover-hint">支持 git --author=&lt;pattern&gt; 模糊匹配</div>
        <div class="popover-footer">
          <button class="popover-btn" @click="clearAuthor">清除</button>
          <button class="popover-btn primary" @click="applyAuthor">应用</button>
        </div>
      </div>
    </Teleport>

    <!-- 日期筛选 popover -->
    <Teleport to="body">
      <div
        v-if="showDatePopover"
        ref="datePopoverRef"
        class="filter-popover date-popover"
        :style="{
          top: datePopoverPos.top + 'px',
          left: datePopoverPos.left + 'px',
        }"
      >
        <div class="popover-title">按日期筛选</div>
        <div class="popover-presets">
          <button class="preset-btn" @click="setDatePreset(1)">今天</button>
          <button class="preset-btn" @click="setDatePreset(7)">近 7 天</button>
          <button class="preset-btn" @click="setDatePreset(30)">近 30 天</button>
          <button class="preset-btn" @click="setDatePreset(90)">近 90 天</button>
        </div>
        <div class="popover-row">
          <label class="popover-label">从</label>
          <input v-model="dateFromInput" type="date" class="popover-input" />
        </div>
        <div class="popover-row">
          <label class="popover-label">至</label>
          <input v-model="dateToInput" type="date" class="popover-input" />
        </div>
        <div class="popover-footer">
          <button class="popover-btn" @click="clearDate">清除</button>
          <button class="popover-btn primary" @click="applyDate">应用</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.commits-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface);
}

.list-header {
  display: flex;
  align-items: center;
  height: 22px;
  border-bottom: 1px solid var(--color-border);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-foreground-muted);
  background: var(--color-surface);
  flex-shrink: 0;
}

.virtual-spacer {
  position: relative;
  width: 100%;
}
.virtual-window {
  position: absolute;
  inset: 0 0 auto 0;
  will-change: transform;
}
.commit-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.commit-row {
  display: flex;
  align-items: center;
  height: 24px;
  cursor: pointer;
  font-size: 12px;
}

.commit-row.row-odd {
  background: var(--color-surface);
}

.commit-row.row-even {
  background: var(--color-background);
}

.commit-row:hover {
  background: var(--color-surface-hover);
}

.commit-row.selected {
  background: var(--color-surface-active);
}

.commit-row.is-merge {
  color: var(--color-foreground-muted);
}

.col-message {
  flex: 1;
  min-width: 200px;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  padding: 0 6px;
}

.commit-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-foreground);
}

.col-author {
  width: 100px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 8px;
  color: var(--color-foreground);
  font-weight: 600;
  font-size: 12px;
}

.col-date {
  width: 100px;
  flex-shrink: 0;
  padding: 0 8px;
  color: var(--color-foreground-muted);
  font-size: 11px;
  white-space: nowrap;
  text-align: right;
}

.ref-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  height: 16px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 16px;
}

.ref-head {
  background: var(--color-branch-head);
  color: #1e1e1e;
}

.ref-local {
  background: rgba(78, 201, 176, 0.2);
  color: var(--color-branch-local);
  border: 1px solid var(--color-branch-local);
}

.ref-remote {
  background: rgba(197, 134, 192, 0.2);
  color: var(--color-branch-remote);
  border: 1px solid var(--color-branch-remote);
}

.ref-tag {
  background: rgba(220, 220, 170, 0.2);
  color: var(--color-branch-tag);
  border: 1px solid var(--color-branch-tag);
}

.loading-indicator {
  padding: 12px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

/* ---- 模态弹窗公共样式 ---- */
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

.reset-modal {
  width: 440px;
}

.confirm-modal {
  width: 400px;
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
  font-size: 13px;
  font-weight: 600;
  color: var(--color-foreground);
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
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reset-target {
  font-size: 12px;
  color: var(--color-foreground-muted);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reset-target code {
  color: var(--color-foreground);
  font-family: var(--font-mono, monospace);
  background: var(--color-surface-active);
  padding: 1px 4px;
  border-radius: 3px;
}

.reset-modes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.reset-mode-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.reset-mode-option:hover {
  border-color: var(--color-foreground-muted);
}

.reset-mode-option.active {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}

.reset-mode-option input[type="radio"] {
  margin-top: 3px;
  flex-shrink: 0;
  accent-color: var(--color-primary);
}

.mode-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mode-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-foreground);
}

.mode-default {
  font-weight: 400;
  color: var(--color-foreground-muted);
  font-size: 11px;
}

.mode-desc {
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.mode-danger {
  color: var(--color-error, #e05252);
}

.confirm-text {
  font-size: 13px;
  color: var(--color-foreground);
  line-height: 1.6;
  margin: 0;
  white-space: pre-line;
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

.modal-btn.primary:hover {
  opacity: 0.9;
}

.modal-btn.danger {
  background: var(--color-error, #e05252);
  color: white;
  border-color: transparent;
}

.modal-btn.danger:hover {
  opacity: 0.85;
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

/* ---- Filter anchor + indicator dot ---- */
.filter-anchor {
  position: relative;
  display: inline-flex;
}

.filter-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  pointer-events: none;
}

/* ---- Filter popover (Teleport 到 body，position: fixed) ---- */
.filter-popover {
  position: fixed;
  z-index: 9500;
  min-width: 240px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.filter-popover.date-popover {
  min-width: 260px;
}

.popover-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-foreground);
}

.popover-input {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  height: 26px;
  font-size: 12px;
  background: var(--color-background);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.popover-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.popover-hint {
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.popover-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.popover-label {
  width: 28px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-foreground-muted);
}

.popover-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.preset-btn {
  padding: 3px 8px;
  font-size: 11px;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
}

.preset-btn:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-foreground-muted);
}

.popover-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}

.popover-btn {
  padding: 4px 12px;
  font-size: 12px;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
}

.popover-btn:hover {
  background: var(--color-surface-hover);
}

.popover-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.popover-btn.primary:hover {
  opacity: 0.9;
}
</style>
