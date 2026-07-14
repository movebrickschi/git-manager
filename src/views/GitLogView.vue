<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, defineAsyncComponent } from "vue";
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
import ReportPanel from "@/components/report/ReportPanel.vue";

const BlameView = defineAsyncComponent(() => import("@/components/blame/BlameView.vue"));
const ThreeWayMerge = defineAsyncComponent(() => import("@/components/merge/ThreeWayMerge.vue"));
import { useRepoStore } from "@/stores/repoStore";
import { useLogStore } from "@/stores/logStore";
import { useBranchStore } from "@/stores/branchStore";
import { useCommitStore } from "@/stores/commitStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { FileStatus, DiffResult } from "@/utils/commands";
import { commands } from "@/utils/commands";
import { errText } from "@/utils/error";

const repoStore = useRepoStore();
const logStore = useLogStore();
const branchStore = useBranchStore();
const commitStore = useCommitStore();
const settings = useSettingsStore();

const activeTab = ref<"log" | "commit" | "stash" | "report">("log");

watch(
  () => branchStore.tabSwitchSignal,
  (sig) => {
    if (sig && sig.seq > 0) activeTab.value = sig.tab;
  },
  { deep: true }
);

const selectedFile = ref<FileStatus | null>(null);
const diffResult = ref<DiffResult | null>(null);
const changedFilesSource = ref<"commit" | "working">("commit");
const showDiffViewer = ref(false);
// 弹框打开序号守卫：防止"迟到"的 diff 加载 promise 在弹框已被关闭后又把它重新打开
// （快速重复双击大文件时会有多个 onFileDblClick 并发，旧 promise resolve 会覆盖关闭状态）
let diffOpenSeq = 0;
// 文件 diff 加载守卫：
// - fileSelectSeq：只让"最新一次选择"的结果落到 diffResult，避免快速切文件时旧 diff 覆盖新文件
// - lastDiffKey：双击会触发 2×click + 1×dblclick，去重避免对同一文件重复发起 3 次 IPC
let fileSelectSeq = 0;
let lastDiffKey = "";
const showBlame = ref(false);
const blameFilePath = ref("");
const showMerge = ref(false);
const mergeFilePath = ref("");
const mergeConflictFiles = ref<string[]>([]);

onMounted(() => {
  if (repoStore.activeRepo) {
    if (activeTab.value === "log") {
      void logStore.loadCommits(true);
    } else {
      logStore.needsReload = true;
    }
    void branchStore.loadBranches();
    void commitStore.loadStatus();
  }
});

watch(
  () => repoStore.activeRepo?.path,
  () => {
    // logStore 内部 watch 会自行 swap per-repo 的 filter（含 branch/author/date/searchText 等）
    selectedFile.value = null;
    diffResult.value = null;
    diffOpenSeq++; // 切仓库时作废在途的弹框打开请求
    lastDiffKey = "";
    showDiffViewer.value = false;
    if (repoStore.activeRepo) {
      void branchStore.loadBranches();
      void commitStore.loadStatus();
      // 切仓库时 logStore 内部 watch 已清空日志并置 needsReload；若当前正处于 log tab
      // 需立刻重新加载，否则日志会一直空白。非 log tab 则保留 needsReload，切回时由下方 watch 处理。
      if (activeTab.value === "log") {
        logStore.ensureLoaded();
      }
    }
  }
);

watch(activeTab, (tab) => {
  if (tab === "log") {
    logStore.ensureLoaded();
  }
});

function onChangedFilesSource(source: "commit" | "working") {
  changedFilesSource.value = source;
  diffResult.value = null;
  selectedFile.value = null;
  lastDiffKey = "";
}

async function onFileSelect(file: FileStatus) {
  selectedFile.value = file;
  if (!repoStore.activeRepo) return;
  // 去重：双击/重复点击同一文件时不重复发起 IPC（key 含来源/commit/staged/path）
  const key = `${changedFilesSource.value}|${logStore.selectedCommitId ?? ""}|${file.staged}|${file.path}`;
  if (key === lastDiffKey) return;
  lastDiffKey = key;
  const seq = ++fileSelectSeq;
  try {
    let result: DiffResult | null = null;
    if (changedFilesSource.value === "working") {
      result = await commands.getFileDiff(repoStore.activeRepo.path, file.path, file.staged);
    } else if (logStore.selectedCommitId) {
      result = await commands.getCommitDiff(
        repoStore.activeRepo.path,
        logStore.selectedCommitId,
        file.path
      );
    }
    // 仅当仍是最新一次选择时才落库，避免旧请求覆盖新文件的 diff
    if (seq === fileSelectSeq) diffResult.value = result;
  } catch (e) {
    console.error("Failed to load diff:", e);
    if (seq === fileSelectSeq) {
      diffResult.value = null;
      showDiffViewer.value = false; // 加载失败不残留半开弹框
      lastDiffKey = ""; // 失败后允许重试同一文件
      branchStore.showToast(`加载差异失败：${errText(e)}`, "err");
    }
  }
}

async function onFileDblClick(file: FileStatus) {
  const seq = ++diffOpenSeq;
  await onFileSelect(file);
  // 仅当这是最新一次双击、且期间未被关闭/切仓库时才真正打开，
  // 否则迟到的 promise 会把已关闭的弹框重新打开（“关不掉”的根因）
  if (seq === diffOpenSeq) {
    showDiffViewer.value = true;
  }
}

function closeDiffViewer() {
  diffOpenSeq++; // 作废所有在途的打开请求，确保关闭后不会被旧 promise 重新打开
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

// Esc 关闭只读弹框（diff / blame）。合并弹框含编辑态，不做 Esc/背景关闭以免误丢失改动。
function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (showDiffViewer.value) closeDiffViewer();
  else if (showBlame.value) closeBlame();
}
onMounted(() => document.addEventListener("keydown", onGlobalKeydown));
onUnmounted(() => document.removeEventListener("keydown", onGlobalKeydown));
</script>

<template>
  <MainLayout>
    <!-- 始终左右分栏：左侧边栏（Tab按钮 + 分支/Fetch/Pull/Push）+ 右侧内容区 -->
    <Splitpanes class="default-theme" style="height: 100%">
      <!-- Left sidebar: Tab切换 + Branches/Git操作 -->
      <Pane :size="18" :min-size="12" :max-size="30">
        <div class="left-panel">
          <BranchesPane :active-tab="activeTab" @update:active-tab="activeTab = $event" />
        </div>
      </Pane>

      <!-- Right content area -->
      <Pane :size="82" :min-size="50">
        <!-- 本地更改 tab -->
        <LocalChangesView v-if="activeTab === 'commit'" style="height: 100%" />

        <!-- 搁置 tab -->
        <StashList v-else-if="activeTab === 'stash'" style="height: 100%" />

        <!-- 日报 tab -->
        <ReportPanel v-else-if="activeTab === 'report'" style="height: 100%" />

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
      <div
        v-if="showDiffViewer && diffResult"
        class="fullscreen-overlay"
        @click.self="closeDiffViewer"
      >
        <div class="fullscreen-panel">
          <div class="fullscreen-header">
            <span>{{ selectedFile?.path }}</span>
            <button class="close-btn" @click="closeDiffViewer">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <DiffViewer :diff="diffResult" />
        </div>
      </div>
    </Teleport>

    <!-- Blame viewer -->
    <Teleport to="body">
      <div v-if="showBlame" class="fullscreen-overlay" @click.self="closeBlame">
        <div class="fullscreen-panel">
          <div class="fullscreen-header">
            <span>逐行作者：{{ blameFilePath }}</span>
            <button class="close-btn" @click="closeBlame">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <BlameView
            :file-path="blameFilePath"
            :commit-id="logStore.selectedCommitId ?? undefined"
          />
        </div>
      </div>
    </Teleport>

    <!-- Three-way merge editor -->
    <Teleport to="body">
      <div v-if="showMerge" class="fullscreen-overlay">
        <div class="fullscreen-panel">
          <div class="fullscreen-header">
            <span>合并冲突：{{ mergeFilePath }}</span>
            <button class="close-btn" @click="closeMerge">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <ThreeWayMerge
            :file-path="mergeFilePath"
            :conflict-files="mergeConflictFiles"
            @resolved="closeMerge"
          />
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
  background: var(--color-surface-muted);
}

.diff-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-background);
}

.diff-preview-header {
  display: flex;
  align-items: center;
  min-height: var(--panel-header-height);
  padding: 0 8px;
  font-size: 11px;
  color: var(--color-foreground-muted);
  border-bottom: 1px solid var(--color-divider);
  background: var(--color-surface-emphasis);
}

.fullscreen-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-backdrop);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.fullscreen-panel {
  width: 90vw;
  height: 85vh;
  min-width: 600px;
  min-height: 400px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 60px);
  background: var(--color-surface-raised);
  border-radius: var(--radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-strong);
  box-shadow: var(--shadow-overlay);
  resize: both;
}

.fullscreen-header {
  position: relative;
  display: flex;
  align-items: center;
  min-height: var(--panel-header-height);
  padding: 4px 12px;
  padding-right: 44px;
  background: var(--color-surface-emphasis);
  border-bottom: 1px solid var(--color-divider);
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}

.fullscreen-header > span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close-btn {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  width: 28px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-foreground);
  padding: 0;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.close-btn:hover {
  background: var(--color-error);
  border-color: var(--color-error);
  color: #fff;
}

</style>
