<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRepoStore } from "@/stores/repoStore";
import { useLogStore } from "@/stores/logStore";
import type { BlameInfo, BlameLine } from "@/utils/commands";
import { commands } from "@/utils/commands";
import { formatTimestamp, shortenHash } from "@/utils/format";

const props = defineProps<{
  filePath: string;
  commitId?: string;
}>();

const repoStore = useRepoStore();
const logStore = useLogStore();

const blameInfo = ref<BlameInfo | null>(null);
const loading = ref(false);
const hoveredCommit = ref<string | null>(null);
const tooltipLine = ref<BlameLine | null>(null);
const tooltipPos = ref({ x: 0, y: 0 });

const BLAME_COLORS = [
  "rgba(224, 108, 117, 0.15)",
  "rgba(152, 195, 121, 0.15)",
  "rgba(229, 192, 123, 0.15)",
  "rgba(97, 175, 239, 0.15)",
  "rgba(198, 120, 221, 0.15)",
  "rgba(86, 182, 194, 0.15)",
  "rgba(190, 80, 70, 0.15)",
  "rgba(126, 198, 153, 0.15)",
];

const commitColorMap = computed(() => {
  if (!blameInfo.value) return {};
  const map: Record<string, string> = {};
  let colorIdx = 0;
  for (const line of blameInfo.value.lines) {
    if (!(line.commitId in map)) {
      map[line.commitId] = BLAME_COLORS[colorIdx % BLAME_COLORS.length];
      colorIdx++;
    }
  }
  return map;
});

onMounted(async () => {
  if (!repoStore.activeRepo) return;
  loading.value = true;
  try {
    blameInfo.value = await commands.getBlame(
      repoStore.activeRepo.path,
      props.filePath,
      props.commitId
    );
  } catch (e) {
    console.error("Failed to load blame:", e);
  } finally {
    loading.value = false;
  }
});

function showTooltip(event: MouseEvent, line: BlameLine) {
  tooltipLine.value = line;
  tooltipPos.value = { x: event.clientX + 12, y: event.clientY - 8 };
  hoveredCommit.value = line.commitId;
}

function hideTooltip() {
  tooltipLine.value = null;
  hoveredCommit.value = null;
}

function jumpToCommit(commitId: string) {
  logStore.selectCommit(commitId);
}

function isNewGroup(lines: BlameLine[], index: number): boolean {
  if (index === 0) return true;
  return lines[index].commitId !== lines[index - 1].commitId;
}
</script>

<template>
  <div class="blame-view">
    <div v-if="loading" class="loading">加载 Blame 数据...</div>
    <div v-else-if="!blameInfo" class="empty">无法加载 Blame 数据</div>
    <div v-else class="blame-content">
      <div
        v-for="(line, i) in blameInfo.lines"
        :key="i"
        class="blame-line"
        :style="{ background: hoveredCommit === line.commitId ? 'var(--color-surface-active)' : commitColorMap[line.commitId] }"
      >
        <!-- Blame gutter -->
        <div
          class="blame-gutter"
          @mouseenter="showTooltip($event, line)"
          @mouseleave="hideTooltip"
          @click="jumpToCommit(line.commitId)"
        >
          <template v-if="isNewGroup(blameInfo.lines, i)">
            <span class="blame-hash mono">{{ line.shortId }}</span>
            <span class="blame-author">{{ line.author }}</span>
            <span class="blame-date">{{ formatTimestamp(line.time) }}</span>
          </template>
        </div>

        <!-- Line number -->
        <span class="line-number mono">{{ line.lineNo }}</span>

        <!-- Content -->
        <span class="line-content mono">{{ line.content }}</span>
      </div>
    </div>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltipLine"
        class="blame-tooltip"
        :style="{ left: tooltipPos.x + 'px', top: tooltipPos.y + 'px' }"
      >
        <div class="tooltip-hash mono">{{ tooltipLine.commitId }}</div>
        <div class="tooltip-summary">{{ tooltipLine.summary }}</div>
        <div class="tooltip-meta">
          <span>{{ tooltipLine.author }}</span>
          <span>{{ formatTimestamp(tooltipLine.time) }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.blame-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.loading, .empty {
  padding: 24px;
  text-align: center;
  color: var(--color-foreground-muted);
}

.blame-content {
  flex: 1;
  overflow-y: auto;
  font-size: 12px;
}

.blame-line {
  display: flex;
  min-height: 20px;
  line-height: 20px;
}

.blame-gutter {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 280px;
  flex-shrink: 0;
  padding: 0 8px;
  cursor: pointer;
  border-right: 1px solid var(--color-border);
  overflow: hidden;
}

.blame-gutter:hover {
  background: var(--color-surface-hover);
}

.blame-hash {
  color: var(--color-primary);
  font-size: 11px;
  flex-shrink: 0;
}

.blame-author {
  color: var(--color-foreground);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.blame-date {
  color: var(--color-foreground-muted);
  font-size: 10px;
  flex-shrink: 0;
}

.line-number {
  width: 48px;
  flex-shrink: 0;
  text-align: right;
  padding-right: 8px;
  color: var(--color-foreground-muted);
  font-size: 11px;
  user-select: none;
  opacity: 0.6;
}

.line-content {
  flex: 1;
  white-space: pre;
  overflow-x: auto;
  padding-right: 8px;
  tab-size: 4;
}

.blame-tooltip {
  position: fixed;
  z-index: 9999;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 10px 14px;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

.tooltip-hash {
  font-size: 11px;
  color: var(--color-primary);
  margin-bottom: 4px;
}

.tooltip-summary {
  font-size: 12px;
  margin-bottom: 6px;
  line-height: 1.4;
}

.tooltip-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-foreground-muted);
}
</style>
