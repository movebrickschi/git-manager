<script setup lang="ts">
import { computed } from "vue";
import type { GraphRow } from "@/utils/commands";
import { computeGraphRender, ROW_HEIGHT } from "@/utils/graph-layout";

const props = defineProps<{
  row: GraphRow;
  maxColumns: number;
}>();

const renderData = computed(() => computeGraphRender(props.row, 0, props.maxColumns));
</script>

<template>
  <svg
    :width="renderData.width"
    :height="ROW_HEIGHT"
    class="commit-graph"
  >
    <!-- Edges -->
    <template v-for="(line, i) in renderData.lines" :key="i">
      <line
        v-if="!line.curved"
        :x1="line.x1"
        :y1="line.y1"
        :x2="line.x2"
        :y2="line.y2"
        :stroke="line.color"
        stroke-width="2"
      />
      <path
        v-else
        :d="`M ${line.x1} ${line.y1} C ${line.x1} ${(line.y1 + line.y2) / 2}, ${line.x2} ${(line.y1 + line.y2) / 2}, ${line.x2} ${line.y2}`"
        :stroke="line.color"
        stroke-width="2"
        fill="none"
      />
    </template>

    <!-- Node -->
    <circle
      :cx="renderData.nodeX"
      :cy="renderData.nodeY"
      r="4"
      :fill="renderData.color"
      stroke="var(--color-surface)"
      stroke-width="1.5"
    />
  </svg>
</template>

<style scoped>
.commit-graph {
  display: block;
  flex-shrink: 0;
}
</style>
