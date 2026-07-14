<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useLinkedVerticalScroll } from "@/composables/useLinkedVerticalScroll";
import { useSettingsStore } from "@/stores/settingsStore";
import type { DiffResult } from "@/utils/commands";
import { buildDiffLayout, buildMinimapSegments } from "@/utils/diff-layout";

const props = defineProps<{
  diff: DiffResult;
  inline?: boolean;
}>();

const settings = useSettingsStore();
const viewMode = ref<"side-by-side" | "unified">(settings.diffMode);

const unifiedContentRef = ref<HTMLElement | null>(null);
const sideLeftContentRef = ref<HTMLElement | null>(null);
const sideRightContentRef = ref<HTMLElement | null>(null);
const currentHunkIdx = ref(0);
const linkedVerticalScroll = useLinkedVerticalScroll();

const layout = computed(() => buildDiffLayout(props.diff.hunks));
const allLines = computed(() => layout.value.unifiedLines);
const sideBySideLines = computed(() => layout.value.sideBySideRows);
const isSideBySide = computed(() => viewMode.value === "side-by-side" && !props.inline);
const renderedHunkStarts = computed(() =>
  isSideBySide.value ? layout.value.sideBySideHunkStarts : layout.value.unifiedHunkStarts
);
const renderedLineCount = computed(() =>
  isSideBySide.value ? layout.value.sideBySideRows.length : layout.value.unifiedLines.length
);
const renderedKinds = computed(() =>
  isSideBySide.value ? layout.value.sideBySideKinds : layout.value.unifiedKinds
);
const hunkCount = computed(() => props.diff.hunks.length);

function getLineClass(lineType: string): string {
  if (lineType === "addition") return "line-added";
  if (lineType === "deletion") return "line-removed";
  return "line-context";
}

const LINE_HEIGHT_PX = 20;

function sideScrollElements(): HTMLElement[] {
  return [sideLeftContentRef.value, sideRightContentRef.value].filter(
    (element): element is HTMLElement => element !== null
  );
}

function setRenderedScrollTop(top: number): void {
  if (isSideBySide.value) {
    linkedVerticalScroll.setScrollTop(sideScrollElements(), top);
  } else if (unifiedContentRef.value) {
    unifiedContentRef.value.scrollTop = top;
  }
}

function onSideScroll(source: "left" | "right"): void {
  const sourceElement = source === "left" ? sideLeftContentRef.value : sideRightContentRef.value;
  const targetElement = source === "left" ? sideRightContentRef.value : sideLeftContentRef.value;
  if (!sourceElement || !targetElement) return;
  linkedVerticalScroll.syncFrom(sourceElement, [targetElement]);
}

function jumpToHunk(idx: number) {
  if (hunkCount.value === 0) return;
  const wrapped = ((idx % hunkCount.value) + hunkCount.value) % hunkCount.value;
  currentHunkIdx.value = wrapped;
  const lineIdx = renderedHunkStarts.value[wrapped] ?? 0;
  setRenderedScrollTop(Math.max(0, lineIdx * LINE_HEIGHT_PX - 40));
}

function nextHunk() {
  jumpToHunk(currentHunkIdx.value + 1);
}
function prevHunk() {
  jumpToHunk(currentHunkIdx.value - 1);
}

watch(
  () => props.diff,
  () => {
    currentHunkIdx.value = 0;
    void nextTick(() => {
      setRenderedScrollTop(0);
    });
  }
);

const minimapSegments = computed(() => buildMinimapSegments(renderedKinds.value));

function onMinimapClick(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
  const targetLine = Math.floor(ratio * renderedLineCount.value);
  setRenderedScrollTop(targetLine * LINE_HEIGHT_PX);
  // 找到落点所在 hunk index，更新 currentHunkIdx
  const starts = renderedHunkStarts.value;
  let idx = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= targetLine) idx = i;
    else break;
  }
  currentHunkIdx.value = idx;
}

function onKey(e: KeyboardEvent) {
  if (!props.diff || hunkCount.value <= 1) return;
  if (props.inline) return;
  const target = e.target as HTMLElement | null;
  const editable =
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  if (editable) return;
  if (e.key === "F7" && e.shiftKey) {
    e.preventDefault();
    prevHunk();
  } else if (e.key === "F7" || (e.altKey && (e.key === "ArrowDown" || e.key === "j"))) {
    e.preventDefault();
    nextHunk();
  } else if (e.altKey && (e.key === "ArrowUp" || e.key === "k")) {
    e.preventDefault();
    prevHunk();
  }
}

onMounted(() => {
  document.addEventListener("keydown", onKey);
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKey);
  linkedVerticalScroll.dispose();
});
</script>

<template>
  <div class="diff-viewer" :class="{ inline: props.inline }">
    <div v-if="diff.binary" class="binary-notice">二进制文件，无法显示差异</div>

    <template v-else>
      <!-- Mode toggle + Hunk nav -->
      <div v-if="!inline" class="diff-toolbar">
        <button
          class="mode-btn"
          :class="{ active: viewMode === 'side-by-side' }"
          @click="viewMode = 'side-by-side'"
        >
          左右对比
        </button>
        <button
          class="mode-btn"
          :class="{ active: viewMode === 'unified' }"
          @click="viewMode = 'unified'"
        >
          统一视图
        </button>
        <div v-if="hunkCount > 0" class="hunk-nav">
          <button
            class="hunk-nav-btn"
            :disabled="hunkCount <= 1"
            title="上一个差异块（Shift+F7 / Alt+↑）"
            @click="prevHunk"
          >
            ↑
          </button>
          <span class="hunk-nav-label"> 差异块 {{ currentHunkIdx + 1 }} / {{ hunkCount }} </span>
          <button
            class="hunk-nav-btn"
            :disabled="hunkCount <= 1"
            title="下一个差异块（F7 / Alt+↓）"
            @click="nextHunk"
          >
            ↓
          </button>
        </div>
      </div>

      <!-- Side by side view -->
      <div v-if="viewMode === 'side-by-side' && !inline" class="side-by-side">
        <div class="side left-side">
          <div class="side-header">{{ diff.oldPath || "(新文件)" }}</div>
          <div ref="sideLeftContentRef" class="side-content" @scroll="onSideScroll('left')">
            <div
              v-for="(pair, i) in sideBySideLines"
              :key="'l' + i"
              class="diff-line"
              :class="pair.left ? getLineClass(pair.left.lineType) : 'line-empty'"
            >
              <span class="line-no">{{ pair.left?.oldLineNo ?? "" }}</span>
              <span class="line-content mono">{{ pair.left?.content ?? "" }}</span>
            </div>
          </div>
        </div>
        <div class="side right-side">
          <div class="side-header">{{ diff.newPath || "(已删除)" }}</div>
          <div ref="sideRightContentRef" class="side-content" @scroll="onSideScroll('right')">
            <div
              v-for="(pair, i) in sideBySideLines"
              :key="'r' + i"
              class="diff-line"
              :class="pair.right ? getLineClass(pair.right.lineType) : 'line-empty'"
            >
              <span class="line-no">{{ pair.right?.newLineNo ?? "" }}</span>
              <span class="line-content mono">{{ pair.right?.content ?? "" }}</span>
            </div>
          </div>
        </div>
        <div
          v-if="minimapSegments.length > 0"
          class="diff-minimap"
          title="差异缩略图 · 点击跳到对应位置"
          @click="onMinimapClick"
        >
          <div
            v-for="(seg, idx) in minimapSegments"
            :key="idx"
            class="minimap-seg"
            :class="seg.kind"
            :style="{ top: seg.topPct + '%', height: seg.heightPct + '%' }"
          />
        </div>
      </div>

      <!-- Unified view -->
      <div v-else class="unified-view-wrap">
        <div ref="unifiedContentRef" class="unified-view">
          <div
            v-for="(line, i) in allLines"
            :key="i"
            class="diff-line"
            :class="getLineClass(line.lineType)"
          >
            <span class="line-no old-no">{{ line.oldLineNo ?? "" }}</span>
            <span class="line-no new-no">{{ line.newLineNo ?? "" }}</span>
            <span class="line-prefix">{{
              line.lineType === "addition" ? "+" : line.lineType === "deletion" ? "-" : " "
            }}</span>
            <span class="line-content mono">{{ line.content }}</span>
          </div>
        </div>
        <div
          v-if="!inline && minimapSegments.length > 0"
          class="diff-minimap"
          title="差异缩略图 · 点击跳到对应位置"
          @click="onMinimapClick"
        >
          <div
            v-for="(seg, idx) in minimapSegments"
            :key="idx"
            class="minimap-seg"
            :class="seg.kind"
            :style="{ top: seg.topPct + '%', height: seg.heightPct + '%' }"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.diff-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--color-background);
}

.diff-viewer.inline {
  font-size: 11px;
}

.binary-notice {
  padding: 24px;
  text-align: center;
  color: var(--color-foreground-muted);
}

.diff-toolbar {
  display: flex;
  gap: 2px;
  padding: 4px 8px;
  background: var(--color-surface-muted);
  flex-shrink: 0;
}

.mode-btn {
  padding: 3px 10px;
  background: transparent;
  color: var(--color-foreground-muted);
  border-radius: 3px;
  font-size: 11px;
}

.mode-btn:hover {
  background: var(--color-surface-hover);
}
.mode-btn.active {
  background: var(--color-surface-active);
  color: var(--color-foreground);
}

.side-by-side {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.side {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.left-side {
  border-right: 1px solid var(--color-divider);
}

.side-header {
  padding: 4px 8px;
  font-size: 11px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-emphasis);
  flex-shrink: 0;
}

.side-content {
  flex: 1;
  overflow: auto;
}

.unified-view {
  flex: 1;
  overflow: auto;
}

.diff-line {
  display: flex;
  width: max-content;
  min-width: 100%;
  min-height: 20px;
  line-height: 20px;
  font-size: 12px;
}

.diff-line.line-added {
  background: var(--color-diff-added-bg);
}

.diff-line.line-removed {
  background: var(--color-diff-removed-bg);
}

.diff-line.line-empty {
  background: var(--color-surface-hover);
}

.line-no {
  width: 48px;
  flex-shrink: 0;
  text-align: right;
  padding-right: 8px;
  color: var(--color-foreground-muted);
  font-size: 11px;
  font-family: var(--font-mono);
  user-select: none;
  opacity: 0.6;
}

.old-no,
.new-no {
  width: 40px;
}

.line-prefix {
  width: 16px;
  flex-shrink: 0;
  text-align: center;
  font-family: var(--font-mono);
  user-select: none;
}

.line-added .line-prefix {
  color: var(--color-git-added);
}
.line-removed .line-prefix {
  color: var(--color-git-deleted);
}

.line-content {
  flex: 0 0 auto;
  white-space: pre;
  padding-right: 8px;
  tab-size: 4;
  /* 覆盖 #app 全局的 user-select: none，让 diff 正文可以选中复制（行号/前缀仍不可选，复制出来是干净代码） */
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.hunk-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
}

.hunk-nav-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--color-foreground-muted);
  border-radius: 3px;
  font-size: 14px;
}

.hunk-nav-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.hunk-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hunk-nav-label {
  font-size: 11px;
  color: var(--color-foreground-muted);
  font-feature-settings: "tnum";
  min-width: 80px;
  text-align: center;
}

.unified-view-wrap {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.unified-view-wrap .unified-view {
  flex: 1;
}

.diff-minimap {
  position: relative;
  width: 10px;
  flex-shrink: 0;
  background: var(--color-surface-muted);
  border-left: 1px solid var(--color-divider);
  cursor: pointer;
  overflow: hidden;
}

.diff-minimap:hover {
  width: 14px;
}

.minimap-seg {
  position: absolute;
  left: 0;
  right: 0;
  pointer-events: none;
}

.minimap-seg.added {
  background: var(--color-git-added, #4ec9b0);
  opacity: 0.7;
}

.minimap-seg.removed {
  background: var(--color-git-deleted, #e06c75);
  opacity: 0.7;
}

.minimap-seg.modified {
  background: linear-gradient(
    to right,
    var(--color-git-deleted, #e06c75) 0 50%,
    var(--color-git-added, #4ec9b0) 50% 100%
  );
  opacity: 0.7;
}
</style>
