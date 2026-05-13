<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useSettingsStore } from "@/stores/settingsStore";
import type { DiffResult, DiffHunk, DiffLine } from "@/utils/commands";

const props = defineProps<{
  diff: DiffResult;
  inline?: boolean;
}>();

const settings = useSettingsStore();
const viewMode = ref<"side-by-side" | "unified">(settings.diffMode);

const allLines = computed(() => {
  const lines: DiffLine[] = [];
  for (const hunk of props.diff.hunks) {
    lines.push(...hunk.lines);
  }
  return lines;
});

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
</script>

<template>
  <div class="diff-viewer" :class="{ inline: props.inline }">
    <div v-if="diff.binary" class="binary-notice">Binary file - cannot display diff</div>

    <template v-else>
      <!-- Mode toggle -->
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
      </div>

      <!-- Side by side view -->
      <div v-if="viewMode === 'side-by-side' && !inline" class="side-by-side">
        <div class="side left-side">
          <div class="side-header">{{ diff.oldPath || "(new file)" }}</div>
          <div class="side-content">
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
          <div class="side-content">
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
      </div>

      <!-- Unified view -->
      <div v-else class="unified-view">
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
</style>
