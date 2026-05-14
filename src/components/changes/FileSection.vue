<script setup lang="ts">
import type { FileStatus } from "@/utils/commands";

export type SectionKey = "staged" | "unstaged" | "untracked";

export interface SectionData {
  key: SectionKey;
  title: string;
  files: FileStatus[];
  hiddenCount: number;
}

const props = defineProps<{
  section: SectionData;
  selectedFilePath: string | null;
  selectedSection: SectionKey;
  isRowChecked: (section: SectionKey, path: string) => boolean;
}>();

const emit = defineEmits<{
  (e: "row-click", event: MouseEvent, file: FileStatus, section: SectionData): void;
  (e: "row-toggle", section: SectionKey, path: string): void;
  (e: "row-context", event: MouseEvent, file: FileStatus, section: SectionData): void;
}>();

function statusLetter(status: FileStatus["status"]): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "?";
    case "conflicted":
      return "!";
    case "ignored":
      return "I";
    default:
      return "?";
  }
}

function statusClass(status: FileStatus["status"]): string {
  switch (status) {
    case "added":
      return "status-added";
    case "modified":
      return "status-modified";
    case "deleted":
      return "status-deleted";
    case "renamed":
    case "copied":
      return "status-renamed";
    case "untracked":
      return "status-untracked";
    case "conflicted":
      return "status-conflicted";
    case "ignored":
      return "status-ignored";
    default:
      return "";
  }
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
      <span class="status-letter" :class="statusClass(file.status)">
        {{ statusLetter(file.status) }}
      </span>
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

.status-letter {
  font-size: 10px;
  font-weight: 700;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.status-added {
  color: var(--color-git-added);
}
.status-modified {
  color: var(--color-git-modified);
}
.status-deleted {
  color: var(--color-git-deleted);
}
.status-renamed {
  color: var(--color-git-renamed);
}
.status-untracked {
  color: var(--color-git-untracked);
}
.status-conflicted {
  color: var(--color-error);
}
.status-ignored {
  color: var(--color-foreground-muted);
}

.file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
</style>
