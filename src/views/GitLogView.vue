<script setup lang="ts">
import { ref, onMounted, watch, defineAsyncComponent } from "vue";
import { Splitpanes, Pane } from "splitpanes";
import "splitpanes/dist/splitpanes.css";
import MainLayout from "@/layouts/MainLayout.vue";
import BranchesPane from "@/components/log/BranchesPane.vue";
import CommitsPane from "@/components/log/CommitsPane.vue";
import ChangedFilesPane from "@/components/log/ChangedFilesPane.vue";
import CommitDetailsPane from "@/components/log/CommitDetailsPane.vue";
import StashList from "@/components/stash/StashList.vue";
import DiffViewer from "@/components/diff/DiffViewer.vue";
import LocalChangesView from "@/components/changes/LocalChangesView.vue";

const BlameView = defineAsyncComponent(() => import("@/components/blame/BlameView.vue"));
const ThreeWayMerge = defineAsyncComponent(() => import("@/components/merge/ThreeWayMerge.vue"));
import { useRepoStore } from "@/stores/repoStore";
import { useLogStore } from "@/stores/logStore";
import { useBranchStore } from "@/stores/branchStore";
import { useCommitStore } from "@/stores/commitStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { FileStatus, DiffResult } from "@/utils/commands";
import { commands } from "@/utils/commands";

const repoStore = useRepoStore();
const logStore = useLogStore();
const branchStore = useBranchStore();
const commitStore = useCommitStore();
const settings = useSettingsStore();

const activeTab = ref<"log" | "commit" | "stash">("log");

const selectedFile = ref<FileStatus | null>(null);
const diffResult = ref<DiffResult | null>(null);
const changedFilesSource = ref<"commit" | "working">("commit");
const showDiffViewer = ref(false);
const showBlame = ref(false);
const blameFilePath = ref("");
const showMerge = ref(false);
const mergeFilePath = ref("");
const mergeConflictFiles = ref<string[]>([]);

onMounted(async () => {
  if (repoStore.activeRepo) {
    await Promise.all([
      logStore.loadCommits(true),
      branchStore.loadBranches(),
      commitStore.loadStatus(),
    ]);
  }
});

watch(
  () => repoStore.activeRepo?.path,
  async () => {
    if (repoStore.activeRepo) {
      await Promise.all([
        branchStore.loadBranches(),
        commitStore.loadStatus(),
      ]);
    }
  }
);

function onChangedFilesSource(source: "commit" | "working") {
  changedFilesSource.value = source;
  diffResult.value = null;
  selectedFile.value = null;
}

async function onFileSelect(file: FileStatus) {
  selectedFile.value = file;
  if (!repoStore.activeRepo) return;
  try {
    if (changedFilesSource.value === "working") {
      diffResult.value = await commands.getFileDiff(
        repoStore.activeRepo.path,
        file.path,
        file.staged
      );
    } else if (logStore.selectedCommitId) {
      diffResult.value = await commands.getCommitDiff(
        repoStore.activeRepo.path,
        logStore.selectedCommitId,
        file.path
      );
    }
  } catch (e) {
    console.error("Failed to load diff:", e);
  }
}

async function onFileDblClick(file: FileStatus) {
  await onFileSelect(file);
  showDiffViewer.value = true;
}

function closeDiffViewer() {
  showDiffViewer.value = false;
}

function openBlame(filePath: string) {
  blameFilePath.value = filePath;
  showBlame.value = true;
}

function closeBlame() {
  showBlame.value = false;
}

function openMerge(filePath: string, conflictFiles?: string[]) {
  mergeFilePath.value = filePath;
  mergeConflictFiles.value = conflictFiles ?? [filePath];
  showMerge.value = true;
}

function closeMerge() {
  showMerge.value = false;
}
</script>

<template>
  <MainLayout>
    <!-- 始终左右分栏：左侧边栏（Tab按钮 + 分支/Fetch/Pull/Push）+ 右侧内容区 -->
    <Splitpanes class="default-theme" style="height: 100%">
      <!-- Left sidebar: Tab切换 + Branches/Git操作 -->
      <Pane :size="18" :min-size="12" :max-size="30">
        <div class="left-panel">
          <BranchesPane
            :active-tab="activeTab"
            @update:active-tab="activeTab = $event"
          />
        </div>
      </Pane>

      <!-- Right content area -->
      <Pane :size="82" :min-size="50">
        <!-- 本地更改 tab -->
        <LocalChangesView v-if="activeTab === 'commit'" style="height: 100%" />

        <!-- 搁置 tab -->
        <StashList v-else-if="activeTab === 'stash'" style="height: 100%" />

        <!-- 日志 tab: 提交图 -->
        <Splitpanes v-else horizontal class="default-theme" style="height: 100%">
          <!-- Top: Commits list -->
          <Pane :size="60" :min-size="30">
            <CommitsPane />
          </Pane>

          <!-- Bottom: Details + Changed files + Diff preview -->
          <Pane :size="40" :min-size="20">
            <Splitpanes class="default-theme">
              <!-- Commit details -->
              <Pane :size="35" :min-size="20">
                <CommitDetailsPane />
              </Pane>

              <!-- Changed files -->
              <Pane :size="35" :min-size="20">
                <ChangedFilesPane
                  @select="onFileSelect"
                  @dblclick="onFileDblClick"
                  @blame="openBlame"
                  @merge="openMerge"
                  @files-source="onChangedFilesSource"
                />
              </Pane>

              <!-- Diff preview -->
              <Pane v-if="settings.showDiffPreview && diffResult" :size="30" :min-size="15">
                <div class="diff-preview">
                  <div class="diff-preview-header">
                    <span>{{ selectedFile?.path }}</span>
                  </div>
                  <DiffViewer :diff="diffResult" :inline="true" />
                </div>
              </Pane>
            </Splitpanes>
          </Pane>
        </Splitpanes>
      </Pane>
    </Splitpanes>

    <!-- Full diff viewer dialog -->
    <Teleport to="body">
      <div v-if="showDiffViewer && diffResult" class="fullscreen-overlay">
        <div class="fullscreen-panel">
          <div class="fullscreen-header">
            <span>{{ selectedFile?.path }}</span>
            <button class="close-btn" @click="closeDiffViewer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <DiffViewer :diff="diffResult" />
        </div>
      </div>
    </Teleport>

    <!-- Blame viewer -->
    <Teleport to="body">
      <div v-if="showBlame" class="fullscreen-overlay">
        <div class="fullscreen-panel">
          <div class="fullscreen-header">
            <span>Blame: {{ blameFilePath }}</span>
            <button class="close-btn" @click="closeBlame">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <BlameView :file-path="blameFilePath" :commit-id="logStore.selectedCommitId ?? undefined" />
        </div>
      </div>
    </Teleport>

    <!-- Three-way merge editor -->
    <Teleport to="body">
      <div v-if="showMerge" class="fullscreen-overlay">
        <div class="fullscreen-panel">
          <div class="fullscreen-header">
            <span>合并冲突: {{ mergeFilePath }}</span>
            <button class="close-btn" @click="closeMerge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <ThreeWayMerge :file-path="mergeFilePath" :conflict-files="mergeConflictFiles" @resolved="closeMerge" />
        </div>
      </div>
    </Teleport>

  </MainLayout>
</template>

<style scoped>
.left-panel {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
}

.diff-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface);
}

.diff-preview-header {
  padding: 4px 8px;
  font-size: 11px;
  color: var(--color-foreground-muted);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.fullscreen-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.fullscreen-panel {
  width: 100%;
  height: 100%;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
}

.fullscreen-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 500;
}

.close-btn {
  display: flex;
  align-items: center;
  background: none;
  color: var(--color-foreground-muted);
  padding: 4px;
  border-radius: 3px;
}

.close-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

:deep(.splitpanes__splitter) {
  background: var(--color-border) !important;
}

:deep(.splitpanes--vertical > .splitpanes__splitter) {
  width: 3px !important;
  min-width: 3px !important;
}

:deep(.splitpanes--horizontal > .splitpanes__splitter) {
  height: 3px !important;
  min-height: 3px !important;
}
</style>
