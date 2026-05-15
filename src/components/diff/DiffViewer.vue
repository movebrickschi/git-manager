<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useSettingsStore } from "@/stores/settingsStore";
import type { DiffResult, DiffLine } from "@/utils/commands";

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

const allLines = computed(() => {
  const lines: DiffLine[] = [];
  for (const hunk of props.diff.hunks) {
    lines.push(...hunk.lines);
  }
  return lines;
});

/**
 * 计算每个 hunk 在 unified 视图里"第一条 line 的全局 index"，用于 scrollTo。
 * 同时反向：每行属于哪个 hunk。
 */
const hunkLineStarts = computed<number[]>(() => {
  const starts: number[] = [];
  let cum = 0;
  for (const hunk of props.diff.hunks) {
    starts.push(cum);
    cum += hunk.lines.length;
  }
  return starts;
});

const totalLineCount = computed(() => allLines.value.length);
const hunkCount = computed(() => props.diff.hunks.length);

interface SideBySidePair {
  left: DiffLine | null;
  right: DiffLine | null;
}

const sideBySideLines = computed<SideBySidePair[]>(() => {
  const pairs: SideBySidePair[] = [];

  for (const hunk of props.diff.hunks) {
    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];

    for (const line of hunk.lines) {
      if (line.lineType === "deletion") {
        if (additions.length > 0) {
          flushPairs(pairs, deletions, additions);
          deletions.length = 0;
          additions.length = 0;
        }
        deletions.push(line);
      } else if (line.lineType === "addition") {
        additions.push(line);
      } else {
        flushPairs(pairs, deletions, additions);
        deletions.length = 0;
        additions.length = 0;
        pairs.push({ left: line, right: line });
      }
    }
    flushPairs(pairs, deletions, additions);
  }

  return pairs;
});

function flushPairs(pairs: SideBySidePair[], dels: DiffLine[], adds: DiffLine[]) {
  const max = Math.max(dels.length, adds.length);
  for (let i = 0; i < max; i++) {
    pairs.push({
      left: i < dels.length ? dels[i] : null,
      right: i < adds.length ? adds[i] : null,
    });
  }
}

function getLineClass(lineType: string): string {
  if (lineType === "addition") return "line-added";
  if (lineType === "deletion") return "line-removed";
  return "line-context";
}

const LINE_HEIGHT_PX = 20;

function getScrollEl(): HTMLElement | null {
  if (viewMode.value === "unified" || props.inline) return unifiedContentRef.value;
  return sideRightContentRef.value;
}

function jumpToHunk(idx: number) {
  if (hunkCount.value === 0) return;
  const wrapped = ((idx % hunkCount.value) + hunkCount.value) % hunkCount.value;
  currentHunkIdx.value = wrapped;
  const lineIdx = hunkLineStarts.value[wrapped] ?? 0;
  const el = getScrollEl();
  if (!el) return;
  el.scrollTo({ top: Math.max(0, lineIdx * LINE_HEIGHT_PX - 40), behavior: "smooth" });
  // side-by-side：左右滚动同步
  if (viewMode.value === "side-by-side" && !props.inline && sideLeftContentRef.value) {
    sideLeftContentRef.value.scrollTo({
      top: Math.max(0, lineIdx * LINE_HEIGHT_PX - 40),
      behavior: "smooth",
    });
  }
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
      const el = getScrollEl();
      if (el) el.scrollTop = 0;
    });
  }
);

interface MinimapSegment {
  topPct: number;
  heightPct: number;
  kind: "added" | "removed";
}

/**
 * minimap 段：根据 hunk 在 allLines 中占比，生成 added / removed 的色条。
 * 多个连续同类型 line 合并为一段。
 */
const minimapSegments = computed<MinimapSegment[]>(() => {
  const total = totalLineCount.value;
  if (total === 0) return [];
  const segs: MinimapSegment[] = [];
  let runKind: "added" | "removed" | null = null;
  let runStart = 0;
  const lines = allLines.value;
  for (let i = 0; i <= lines.length; i++) {
    const k =
      i < lines.length
        ? lines[i].lineType === "addition"
          ? "added"
          : lines[i].lineType === "deletion"
            ? "removed"
            : null
        : null;
    if (k !== runKind) {
      if (runKind && i > runStart) {
        segs.push({
          topPct: (runStart / total) * 100,
          heightPct: Math.max(0.5, ((i - runStart) / total) * 100),
          kind: runKind,
        });
      }
      runKind = k as "added" | "removed" | null;
      runStart = i;
    }
  }
  return segs;
});

function onMinimapClick(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
  const targetLine = Math.floor(ratio * totalLineCount.value);
  const scroll = getScrollEl();
  if (!scroll) return;
  scroll.scrollTo({ top: targetLine * LINE_HEIGHT_PX, behavior: "smooth" });
  // 找到落点所在 hunk index，更新 currentHunkIdx
  const starts = hunkLineStarts.value;
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
});
</script>

<template>
  <div class="diff-viewer" :class="{ inline: props.inline }">
    <div v-if="diff.binary" class="binary-notice">Binary file - cannot display diff</div>

    <template v-else>
      <!-- Mode toggle + Hunk nav -->
      <div v-if="!inline" class="diff-toolbar">
        <button
          class="mode-btn"
          :class="{ active: viewMode === 'side-by-side' }"
          @click="viewMode = 'side-by-side'"
        >
          Side by Side
        </button>
        <button
          class="mode-btn"
          :class="{ active: viewMode === 'unified' }"
          @click="viewMode = 'unified'"
        >
          Unified
        </button>
        <div v-if="hunkCount > 0" class="hunk-nav">
          <button
            class="hunk-nav-btn"
            :disabled="hunkCount <= 1"
            title="上一个 hunk (Shift+F7 / Alt+↑)"
            @click="prevHunk"
          >
            ↑
          </button>
          <span class="hunk-nav-label">
            hunk {{ currentHunkIdx + 1 }} / {{ hunkCount }}
          </span>
          <button
            class="hunk-nav-btn"
            :disabled="hunkCount <= 1"
            title="下一个 hunk (F7 / Alt+↓)"
            @click="nextHunk"
          >
            ↓
          </button>
        </div>
      </div>

      <!-- Side by side view -->
      <div v-if="viewMode === 'side-by-side' && !inline" class="side-by-side">
        <div class="side left-side">
          <div class="side-header">{{ diff.oldPath || "(new file)" }}</div>
          <div ref="sideLeftContentRef" class="side-content">
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
          <div class="side-header">{{ diff.newPath || "(deleted)" }}</div>
          <div ref="sideRightContentRef" class="side-content">
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
          title="Diff minimap · 点击跳到对应位置"
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
          title="Diff minimap · 点击跳到对应位置"
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
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
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
  border-right: 1px solid var(--color-border);
}

.side-header {
  padding: 4px 8px;
  font-size: 11px;
  color: var(--color-foreground-muted);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.side-content {
  flex: 1;
  overflow-y: auto;
}

.unified-view {
  flex: 1;
  overflow-y: auto;
}

.diff-line {
  display: flex;
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
  flex: 1;
  white-space: pre;
  overflow-x: auto;
  padding-right: 8px;
  tab-size: 4;
}

.hunk-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid var(--color-border);
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
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
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
</style>
