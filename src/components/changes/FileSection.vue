<script setup lang="ts">
import type { FileStatus } from "@/utils/commands";
import StatusIcon from "./StatusIcon.vue";

export type SectionKey = "staged" | "unstaged" | "untracked";

export interface SectionData {
  key: SectionKey;
  title: string;
  files: FileStatus[];
  hiddenCount: number;
}

import { computed, ref, watch } from "vue";

const props = defineProps<{
  section: SectionData;
  selectedFilePath: string | null;
  selectedSection: SectionKey;
  isRowChecked: (section: SectionKey, path: string) => boolean;
  /** 本 section 内所有 row 是否全部已勾选（用于 header checkbox 三态展示） */
  sectionAllChecked: boolean;
  /** 本 section 内是否存在已勾选的 row（与 sectionAllChecked 配合判定 indeterminate） */
  sectionSomeChecked: boolean;
}>();

const emit = defineEmits<{
  (e: "row-click", event: MouseEvent, file: FileStatus, section: SectionData): void;
  (e: "row-toggle", section: SectionKey, path: string): void;
  (e: "row-context", event: MouseEvent, file: FileStatus, section: SectionData): void;
  (e: "section-toggle-all", section: SectionKey): void;
}>();

const headerCheckboxRef = ref<HTMLInputElement | null>(null);

const headerIndeterminate = computed(
  () => props.sectionSomeChecked && !props.sectionAllChecked
);

watch(
  [() => props.sectionAllChecked, () => props.sectionSomeChecked],
  () => {
    if (headerCheckboxRef.value) {
      headerCheckboxRef.value.indeterminate = headerIndeterminate.value;
    }
  },
  { immediate: true, flush: "post" }
);

function onHeaderCheckboxClick(e: MouseEvent) {
  e.stopPropagation();
  emit("section-toggle-all", props.section.key);
}

function isFileSelected(path: string): boolean {
  return props.selectedFilePath === path && props.selectedSection === props.section.key;
}

function onRowClick(event: MouseEvent, file: FileStatus): void {
  emit("row-click", event, file, props.section);
}

function onRowContext(event: MouseEvent, file: FileStatus): void {
  emit("row-context", event, file, props.section);
}

function onCheckboxClick(path: string): void {
  emit("row-toggle", props.section.key, path);
}
</script>

<template>
  <div v-if="section.files.length > 0 || section.hiddenCount > 0">
    <div class="section-header">
      <input
        ref="headerCheckboxRef"
        type="checkbox"
        class="section-checkbox"
        :checked="sectionAllChecked"
        :disabled="section.files.length === 0"
        :title="
          section.files.length === 0
            ? '本组无可选文件'
            : sectionAllChecked
              ? `取消选择本组（${section.files.length} 项）`
              : `选择本组（${section.files.length} 项）`
        "
        @click="onHeaderCheckboxClick"
      />
      <span>{{ section.title }}</span>
      <span class="section-count">{{ section.files.length }}</span>
      <span
        v-if="section.hiddenCount > 0"
        class="section-hidden"
        :title="`${section.hiddenCount} 个文件被过滤规则隐藏`"
      >
        （隐藏 {{ section.hiddenCount }}）
      </span>
    </div>
    <div
      v-for="file in section.files"
      :key="section.key + ':' + file.path"
      class="file-item"
      :class="{
        selected: isFileSelected(file.path),
        checked: isRowChecked(section.key, file.path),
      }"
      @click="onRowClick($event, file)"
      @contextmenu="onRowContext($event, file)"
    >
      <input
        type="checkbox"
        class="row-checkbox"
        :checked="isRowChecked(section.key, file.path)"
        @click.stop="onCheckboxClick(file.path)"
      />
      <StatusIcon :status="file.status" />
      <span class="file-path">{{ file.path }}</span>
    </div>
  </div>
</template>

<style scoped>
.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-foreground-muted);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 1;
}

.section-count {
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  padding: 0 5px;
  border-radius: 8px;
  font-weight: 400;
}

.section-hidden {
  font-size: 10px;
  color: var(--color-foreground-muted);
  font-weight: 400;
  font-style: italic;
}

.file-item {
  display: flex;
  align-items: center;
  padding: 3px 8px;
  cursor: pointer;
  gap: 6px;
  font-size: 12px;
  /* 大量文件时跳过视口外行的布局/绘制（Chromium content-visibility），
     消除几百上千变更时的滚动/刷新卡顿；DOM 仍在，交互与 sticky header 不受影响。
     contain-intrinsic-size 的 auto 让浏览器渲染过一次后记住真实高度，避免滚动条跳动。 */
  content-visibility: auto;
  contain-intrinsic-size: auto 22px;
}

.file-item:hover {
  background: var(--color-surface-hover);
}

.file-item.selected {
  background: var(--color-surface-active);
}

.file-item.checked {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.file-item.checked:hover {
  background: color-mix(in srgb, var(--color-primary) 18%, transparent);
}

.file-item.checked.selected {
  background: color-mix(in srgb, var(--color-primary) 22%, transparent);
}

.row-checkbox {
  width: 12px;
  height: 12px;
  margin: 0;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--color-primary);
}

.section-checkbox {
  width: 12px;
  height: 12px;
  margin: 0;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--color-primary);
}

.section-checkbox:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
</style>
