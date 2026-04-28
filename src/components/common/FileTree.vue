<script setup lang="ts">
import { computed, ref } from "vue";
import type { FileStatus } from "@/utils/commands";
import { getFileName, getFileDir } from "@/utils/format";

const props = defineProps<{
  files: FileStatus[];
  selectedPath?: string;
  treeView?: boolean;
}>();

const emit = defineEmits<{
  select: [file: FileStatus];
  dblclick: [file: FileStatus];
  contextmenu: [event: MouseEvent, file: FileStatus];
}>();

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: FileStatus;
}

const collapsedDirs = ref<Set<string>>(new Set());

const treeData = computed(() => {
  if (!props.treeView) return null;

  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const file of props.files) {
    const parts = file.path.replace(/\\/g, "/").split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");

      if (isLast) {
        current.children.push({
          name: part,
          path,
          isDir: false,
          children: [],
          file,
        });
      } else {
        let dir = current.children.find((c) => c.isDir && c.name === part);
        if (!dir) {
          dir = { name: part, path, isDir: true, children: [] };
          current.children.push(dir);
        }
        current = dir;
      }
    }
  }

  return root.children;
});

function toggleDir(path: string) {
  if (collapsedDirs.value.has(path)) {
    collapsedDirs.value.delete(path);
  } else {
    collapsedDirs.value.add(path);
  }
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    added: "var(--color-git-added)",
    modified: "var(--color-git-modified)",
    deleted: "var(--color-git-deleted)",
    renamed: "var(--color-git-renamed)",
    untracked: "var(--color-git-untracked)",
    conflicted: "var(--color-error)",
  };
  return colors[status] || "var(--color-foreground)";
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    copied: "C",
    untracked: "U",
    conflicted: "!",
  };
  return labels[status] || "?";
}
</script>

<template>
  <div class="file-tree">
    <template v-if="treeView && treeData">
      <template v-for="node in treeData" :key="node.path">
        <div v-if="node.isDir" class="tree-dir" @click="toggleDir(node.path)">
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2"
            :style="{ transform: collapsedDirs.has(node.path) ? 'rotate(-90deg)' : '' }"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span>{{ node.name }}</span>
        </div>
        <template v-if="!node.isDir">
          <div
            class="tree-file"
            :class="{ selected: selectedPath === node.file?.path }"
            @click="node.file && emit('select', node.file)"
            @dblclick="node.file && emit('dblclick', node.file)"
            @contextmenu.prevent="node.file && emit('contextmenu', $event, node.file)"
          >
            <span class="file-name">{{ node.name }}</span>
            <span
              v-if="node.file"
              class="file-status"
              :style="{ color: getStatusColor(node.file.status) }"
            >{{ getStatusLabel(node.file.status) }}</span>
          </div>
        </template>
      </template>
    </template>
    <template v-else>
      <div
        v-for="file in files"
        :key="file.path"
        class="flat-file"
        :class="{ selected: selectedPath === file.path }"
        @click="emit('select', file)"
        @dblclick="emit('dblclick', file)"
        @contextmenu.prevent="emit('contextmenu', $event, file)"
      >
        <span class="file-name">{{ getFileName(file.path) }}</span>
        <span class="file-dir">{{ getFileDir(file.path) }}</span>
        <span
          class="file-status"
          :style="{ color: getStatusColor(file.status) }"
        >{{ getStatusLabel(file.status) }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.file-tree {
  overflow-y: auto;
  font-size: 12px;
}

.tree-dir {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  cursor: pointer;
  color: var(--color-foreground-muted);
}

.tree-dir:hover {
  background: var(--color-surface-hover);
}

.tree-file, .flat-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 24px;
  cursor: pointer;
}

.flat-file {
  padding-left: 8px;
}

.tree-file:hover, .flat-file:hover {
  background: var(--color-surface-hover);
}

.tree-file.selected, .flat-file.selected {
  background: var(--color-surface-active);
}

.file-name {
  flex-shrink: 0;
}

.file-dir {
  flex: 1;
  color: var(--color-foreground-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-status {
  flex-shrink: 0;
  font-weight: 600;
  font-size: 11px;
  min-width: 14px;
  text-align: center;
}
</style>
