<script setup lang="ts">
import { ref, watch, computed, onMounted } from "vue";
import { useLogStore } from "@/stores/logStore";
import { useRepoStore } from "@/stores/repoStore";
import { useCommitStore } from "@/stores/commitStore";
import Toolbar from "@/components/common/Toolbar.vue";
import ToolbarButton from "@/components/common/ToolbarButton.vue";
import FileTree from "@/components/common/FileTree.vue";
import ContextMenu from "@/components/common/ContextMenu.vue";
import type { MenuItem } from "@/components/common/ContextMenu.vue";
import type { FileStatus } from "@/utils/commands";
import { commands } from "@/utils/commands";

const emit = defineEmits<{
  select: [file: FileStatus];
  dblclick: [file: FileStatus];
  blame: [filePath: string];
  merge: [filePath: string];
  filesSource: ["commit" | "working"];
}>();

const logStore = useLogStore();
const repoStore = useRepoStore();
const commitStore = useCommitStore();

const listMode = ref<"commit" | "working">("commit");
const commitFiles = ref<FileStatus[]>([]);
const selectedPath = ref<string>();
const treeView = ref(false);
const loadingCommit = ref(false);
const contextMenuRef = ref<InstanceType<typeof ContextMenu>>();
const contextFile = ref<FileStatus | null>(null);

const workingFiles = computed(() => [
  ...commitStore.stagedFiles,
  ...commitStore.unstagedFiles,
  ...commitStore.untrackedFiles,
]);

const displayFiles = computed(() =>
  listMode.value === "commit" ? commitFiles.value : workingFiles.value
);

const paneLoading = computed(() =>
  listMode.value === "commit" ? loadingCommit.value : commitStore.loading
);

function setListMode(m: "commit" | "working") {
  listMode.value = m;
  if (m === "working") {
    void commitStore.loadStatus();
  }
}

onMounted(() => {
  void commitStore.loadStatus();
});

watch(
  listMode,
  (m) => {
    emit("filesSource", m);
  },
  { immediate: true }
);

watch(
  () => logStore.selectedCommitId,
  async (commitId) => {
    if (!commitId || !repoStore.activeRepo) {
      commitFiles.value = [];
      return;
    }
    loadingCommit.value = true;
    try {
      if (logStore.selectedCommitIds.length === 2) {
        commitFiles.value = await commands.compareCommits(
          repoStore.activeRepo.path,
          logStore.selectedCommitIds[0],
          logStore.selectedCommitIds[1]
        );
      } else {
        commitFiles.value = await commands.getCommitFiles(
          repoStore.activeRepo.path,
          commitId
        );
      }
    } catch (e) {
      console.error("Failed to load files:", e);
      commitFiles.value = [];
    } finally {
      loadingCommit.value = false;
    }
  }
);

function onSelect(file: FileStatus) {
  selectedPath.value = file.path;
  emit("select", file);
}

function onDblClick(file: FileStatus) {
  emit("dblclick", file);
}

function onContextMenu(event: MouseEvent, file: FileStatus) {
  contextFile.value = file;
  contextMenuRef.value?.show(event);
}

const contextMenuItems = computed<MenuItem[]>(() => {
  if (!contextFile.value) return [];
  const file = contextFile.value;
  const items: MenuItem[] = [];

  if (file.status === "conflicted") {
    items.push({ label: "解决冲突...", action: () => emit("merge", file.path) });
    items.push({ separator: true, label: "" });
  }

  items.push(
    { label: "查看 Diff", action: () => emit("dblclick", file) },
    { label: "Blame / Annotate", action: () => emit("blame", file.path) },
    { separator: true, label: "" },
    { label: "复制路径", action: () => navigator.clipboard.writeText(file.path) },
  );
  if (listMode.value === "commit") {
    items.push(
      { label: "Cherry-Pick 此文件变更", action: () => {} },
      { label: "Revert 此文件变更", action: () => {} }
    );
  }
  return items;
});
</script>

<template>
  <div class="changed-files-pane">
    <Toolbar compact>
      <div class="mode-tabs">
        <button
          type="button"
          class="mode-tab"
          :class="{ active: listMode === 'commit' }"
          @click="setListMode('commit')"
        >
          提交
        </button>
        <button
          type="button"
          class="mode-tab"
          :class="{ active: listMode === 'working' }"
          @click="setListMode('working')"
        >
          本地
          <span v-if="workingFiles.length > 0" class="working-badge">{{ workingFiles.length }}</span>
        </button>
      </div>
      <span v-if="displayFiles.length" class="file-count">{{ displayFiles.length }}</span>
      <div style="flex: 1" />
      <ToolbarButton
        :title="treeView ? '平铺视图' : '树形视图'"
        :active="treeView"
        @click="treeView = !treeView"
      >
        <svg v-if="treeView" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </ToolbarButton>
    </Toolbar>

    <div class="files-content">
      <div v-if="paneLoading" class="loading">加载中...</div>
      <div v-else-if="displayFiles.length === 0" class="empty">
        <template v-if="listMode === 'working'">工作区无变更</template>
        <template v-else>
          {{ logStore.selectedCommitId ? "无变更文件" : "选择一个提交查看变更" }}
        </template>
      </div>
      <FileTree
        v-else
        :files="displayFiles"
        :selected-path="selectedPath"
        :tree-view="treeView"
        @select="onSelect"
        @dblclick="onDblClick"
        @contextmenu="onContextMenu"
      />
    </div>

    <ContextMenu ref="contextMenuRef" :items="contextMenuItems" />
  </div>
</template>

<style scoped>
.changed-files-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface);
}

.mode-tabs {
  display: flex;
  gap: 1px;
  margin-right: 6px;
}

.mode-tab {
  padding: 2px 8px;
  background: transparent;
  color: var(--color-foreground-muted);
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
}

.mode-tab:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.mode-tab.active {
  background: var(--color-surface-active);
  color: var(--color-foreground-bright);
}

.file-count {
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  padding: 0 6px;
  border-radius: 8px;
  margin-left: 4px;
}

.files-content {
  flex: 1;
  overflow-y: auto;
}

.loading,
.empty {
  padding: 16px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

.working-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  margin-left: 4px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--color-warning, #e5a550) 20%, transparent);
  color: var(--color-warning, #e5a550);
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
}
</style>
