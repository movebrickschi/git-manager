<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, defineAsyncComponent } from "vue";
import { useRouter } from "vue-router";
import OpeningRepositoryOverlay from "@/components/common/OpeningRepositoryOverlay.vue";
import StatusBar from "@/components/common/StatusBar.vue";
import Toolbar from "@/components/common/Toolbar.vue";
import KeyboardShortcutsDialog from "@/components/common/KeyboardShortcutsDialog.vue";
import RebaseSequencerDialog from "@/components/rebase/RebaseSequencerDialog.vue";
import RebaseStatusBar from "@/components/rebase/RebaseStatusBar.vue";
import { useRepoStore } from "@/stores/repoStore";
import { useBranchStore } from "@/stores/branchStore";
import { commands, platform } from "@/utils/commands";
import { useAutoFetch } from "@/composables/useAutoFetch";
import { useToast } from "@/composables/useToast";

const ThreeWayMerge = defineAsyncComponent(() => import("@/components/merge/ThreeWayMerge.vue"));

const branchStore = useBranchStore();

const { toastMessage, toastVisible, show: showToast } = useToast(4000);
const toastKind = ref<"ok" | "err" | "info">("info");

watch(
  () => branchStore.globalToast,
  (sig) => {
    if (!sig || sig.seq === 0) return;
    toastKind.value = sig.kind;
    showToast(sig.message);
  },
  { deep: true }
);

useAutoFetch();

const showShortcutsDialog = ref(false);
function handleGlobalKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  const isEditable =
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  if (isEditable) return;
  if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
    e.preventDefault();
    showShortcutsDialog.value = true;
  } else if (e.key === "Escape") {
    showShortcutsDialog.value = false;
  }
}

const router = useRouter();
const repoStore = useRepoStore();

// 全局三栏冲突解决（IDEA 风格）：监听 branchStore.conflictSignal，有冲突直接开三栏
const showConflictResolver = ref(false);
const conflictFiles = ref<string[]>([]);
const conflictFirstFile = ref("");
const conflictAutoStash = ref<{ kind: "merge" | "stash-pop" } | null>(null);

watch(
  () => branchStore.conflictSignal.seq,
  () => {
    const sig = branchStore.conflictSignal;
    if (!sig || sig.seq === 0 || sig.files.length === 0) return;
    conflictFiles.value = sig.files;
    conflictFirstFile.value = sig.files[0]!;
    conflictAutoStash.value = sig.autoStash;
    showConflictResolver.value = true;
  }
);

async function onGlobalConflictResolved() {
  showConflictResolver.value = false;
  const path = repoStore.activeRepo?.path;
  const autoStash = conflictAutoStash.value;
  conflictAutoStash.value = null;
  if (autoStash?.kind === "stash-pop" && path) {
    // 改动已带冲突标记落在工作区，stash 冗余 → 自动 drop，避免堆积
    try {
      await commands.stashDrop(path, 0);
    } catch {
      branchStore.showToast("自动清理 stash 失败，请手动 drop stash@{0}", "err");
    }
  }
  await branchStore.loadBranches();
  branchStore.showToast("冲突已解决", "ok");
}

// 加号菜单状态
const showAddMenu = ref(false);
const addMenuRef = ref<HTMLElement | null>(null);

// 最近打开 · 二级浮层
const showRecentSubmenu = ref(false);
let recentSubmenuCloseTimer: ReturnType<typeof setTimeout> | null = null;

function clearRecentSubmenuTimer() {
  if (recentSubmenuCloseTimer) {
    clearTimeout(recentSubmenuCloseTimer);
    recentSubmenuCloseTimer = null;
  }
}

function openRecentSubmenu() {
  clearRecentSubmenuTimer();
  showRecentSubmenu.value = true;
}

function scheduleCloseRecentSubmenu() {
  clearRecentSubmenuTimer();
  recentSubmenuCloseTimer = setTimeout(() => {
    showRecentSubmenu.value = false;
  }, 160);
}

function repoBasename(p: string) {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}


function clearRecent() {
  repoStore.clearRecentRepos();
  showRecentSubmenu.value = false;
  showAddMenu.value = false;
}

watch(showAddMenu, (open) => {
  if (!open) {
    clearRecentSubmenuTimer();
    showRecentSubmenu.value = false;
  }
});

// Apply Patch
const patchFileInput = ref<HTMLInputElement | null>(null);
const applyPatchBusy = ref(false);
const applyPatchMessage = ref<{ kind: "ok" | "err"; text: string } | null>(null);

function openApplyPatchPicker() {
  showAddMenu.value = false;
  applyPatchMessage.value = null;
  patchFileInput.value?.click();
}

async function onPatchFilePicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // 允许重复选同一文件
  if (!file) return;
  if (!repoStore.activeRepo) {
    applyPatchMessage.value = { kind: "err", text: "请先打开一个仓库再 Apply Patch" };
    return;
  }
  applyPatchBusy.value = true;
  try {
    const text = await file.text();
    const result = await commands.applyPatch(repoStore.activeRepo.path, text);
    if (result.success) {
      applyPatchMessage.value = {
        kind: "ok",
        text: `已应用 patch：${file.name}（请在「本地变更」中审阅后再 commit）`,
      };
    } else {
      const tail = result.conflicts.length > 0 ? `\n冲突：${result.conflicts.join(", ")}` : "";
      applyPatchMessage.value = { kind: "err", text: `${result.message}${tail}` };
    }
  } catch (err: any) {
    applyPatchMessage.value = { kind: "err", text: err?.message ?? String(err) };
  } finally {
    applyPatchBusy.value = false;
  }
}

// 打开仓库弹框
const showManualInput = ref(false);
const manualPath = ref("");
const errorMsg = ref("");
const loading = ref(false);
const openingRepoPath = ref("");

// 克隆仓库弹框
const showCloneDialog = ref(false);
const cloneUrl = ref("");
const clonePath = ref("");
const cloneLoading = ref(false);
const cloneError = ref("");

async function openRepoWithFeedback(path: string, errorTarget: "dialog" | "toast" = "toast") {
  errorMsg.value = "";
  showRecentSubmenu.value = false;
  showAddMenu.value = false;
  loading.value = true;
  openingRepoPath.value = path;
  try {
    await repoStore.openRepo(path);
    router.push("/repo");
  } catch (e: any) {
    const message = e?.message || `打开仓库失败：${path}`;
    if (errorTarget === "dialog") {
      errorMsg.value = message;
    } else {
      toastKind.value = "err";
      showToast(message);
    }
  } finally {
    loading.value = false;
    openingRepoPath.value = "";
  }
}

async function openRecentRepo(repoPath: string) {
  await openRepoWithFeedback(repoPath);
}

async function openFolder() {
  showAddMenu.value = false;
  errorMsg.value = "";
  if (platform.isElectron) {
    const selected = await platform.selectDirectory();
    if (selected) {
      await openRepoWithFeedback(selected);
    }
  } else {
    showManualInput.value = true;
  }
}

async function openManualPath() {
  const path = manualPath.value.trim();
  if (!path) return;
  await openRepoWithFeedback(path, "dialog");
  if (!errorMsg.value) {
    showManualInput.value = false;
    manualPath.value = "";
  }
}

function handleOutsideClick(e: MouseEvent) {
  if (addMenuRef.value && !addMenuRef.value.contains(e.target as Node)) {
    showAddMenu.value = false;
  }
}

async function cloneRepo() {
  if (!cloneUrl.value.trim() || !clonePath.value.trim()) return;
  cloneError.value = "";
  cloneLoading.value = true;
  try {
    const path = clonePath.value.trim();
    await commands.cloneRepo(cloneUrl.value.trim(), path);
    await openRepoWithFeedback(path, "dialog");
    if (!errorMsg.value) {
      showCloneDialog.value = false;
      cloneUrl.value = "";
      clonePath.value = "";
    }
  } catch (e: any) {
    cloneError.value = e.message || "克隆失败";
  } finally {
    cloneLoading.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", handleOutsideClick);
  document.addEventListener("keydown", handleGlobalKey);
});
onUnmounted(() => {
  document.removeEventListener("click", handleOutsideClick);
  document.removeEventListener("keydown", handleGlobalKey);
});
</script>

<template>
  <div class="main-layout">
    <!-- Top toolbar -->
    <Toolbar draggable>
      <div class="repo-tabs">
        <div
          v-for="(repo, i) in repoStore.repos"
          :key="repo.path"
          class="repo-tab"
          :class="{ active: i === repoStore.activeRepoIndex }"
          @click="repoStore.setActiveRepo(i)"
        >
          <span class="repo-color" :style="{ background: repo.color }" />
          <span class="repo-name">{{ repo.name }}</span>
          <button class="repo-close" @click.stop="repoStore.closeRepo(i)">
            <svg
              width="10"
              height="10"
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
      </div>

      <!-- 加号按钮 + 下拉菜单 -->
      <div class="add-repo-wrapper" ref="addMenuRef">
        <button class="add-repo-btn" @click.stop="showAddMenu = !showAddMenu" title="添加仓库">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <div v-if="showAddMenu" class="add-repo-menu">
          <button class="add-menu-item" @click="openFolder">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              />
            </svg>
            打开仓库
          </button>
          <button
            class="add-menu-item"
            @click="
              showCloneDialog = true;
              showAddMenu = false;
            "
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
            克隆仓库
          </button>
          <button
            class="add-menu-item"
            :disabled="!repoStore.activeRepo || applyPatchBusy"
            :title="repoStore.activeRepo ? 'Apply Patch (.patch / .diff)' : '请先打开仓库'"
            @click="openApplyPatchPicker"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {{ applyPatchBusy ? "Apply Patch 中..." : "Apply Patch..." }}
          </button>

          <div class="add-menu-divider" />

          <div
            class="add-menu-submenu-anchor"
            @mouseenter="openRecentSubmenu"
            @mouseleave="scheduleCloseRecentSubmenu"
          >
            <button
              class="add-menu-item add-menu-item--has-submenu"
              :disabled="repoStore.recentRepos.length === 0"
              :title="
                repoStore.recentRepos.length === 0 ? '暂无最近打开记录' : '查看最近打开的仓库'
              "
              @click.stop="
                repoStore.recentRepos.length > 0 &&
                  (showRecentSubmenu = !showRecentSubmenu)
              "
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
              <span class="add-menu-item-label">最近打开</span>
              <svg
                v-if="repoStore.recentRepos.length > 0"
                class="add-menu-chevron"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>

            <div
              v-if="showRecentSubmenu && repoStore.recentRepos.length > 0"
              class="recent-submenu"
              @mouseenter="openRecentSubmenu"
              @mouseleave="scheduleCloseRecentSubmenu"
            >
              <button
                v-for="repo in repoStore.recentRepos"
                :key="repo.path"
                class="recent-submenu-item"
                :title="repo.path"
                @click="openRecentRepo(repo.path)"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                  />
                </svg>
                <span class="recent-submenu-label">
                  {{ repoBasename(repo.path) }}
                  <span v-if="repo.branch" class="recent-submenu-branch">[{{ repo.branch }}]</span>
                </span>
              </button>
              <div class="add-menu-divider" />
              <button class="recent-submenu-clear" @click="clearRecent">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path
                    d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                  />
                </svg>
                清空历史
              </button>
            </div>
          </div>
        </div>
      </div>
      <input
        ref="patchFileInput"
        type="file"
        accept=".patch,.diff,text/plain"
        style="display: none"
        @change="onPatchFilePicked"
      />
      <div
        v-if="applyPatchMessage"
        class="patch-toast"
        :class="applyPatchMessage.kind"
        role="status"
        @click="applyPatchMessage = null"
      >
        {{ applyPatchMessage.text }}
        <span class="patch-toast-close">×</span>
      </div>

      <div class="toolbar-spacer" />
    </Toolbar>

    <!-- Main content -->
    <div class="main-content">
      <slot />
    </div>

    <!-- Status bar -->
    <StatusBar />

    <!-- 打开仓库弹框（Web 模式手动输入路径） -->
    <div v-if="showManualInput" class="dialog-overlay" @click.self="showManualInput = false">
      <div class="dialog">
        <h3>打开仓库</h3>
        <div class="dialog-field">
          <label>仓库路径（服务器上的绝对路径）</label>
          <input
            v-model="manualPath"
            placeholder="C:\projects\my-repo"
            @keyup.enter="openManualPath"
            :disabled="loading"
          />
        </div>
        <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
        <div class="dialog-actions">
          <button class="btn" @click="showManualInput = false" :disabled="loading">取消</button>
          <button class="btn primary" @click="openManualPath" :disabled="loading">
            {{ loading ? "打开中..." : "打开" }}
          </button>
        </div>
      </div>
    </div>

    <!-- 克隆仓库弹框 -->
    <div v-if="showCloneDialog" class="dialog-overlay" @click.self="showCloneDialog = false">
      <div class="dialog">
        <h3>克隆仓库</h3>
        <div class="dialog-field">
          <label>仓库 URL</label>
          <input
            v-model="cloneUrl"
            placeholder="https://github.com/user/repo.git"
            :disabled="cloneLoading"
          />
        </div>
        <div class="dialog-field">
          <label>本地路径</label>
          <input
            v-model="clonePath"
            placeholder="C:\projects\repo"
            :disabled="cloneLoading"
            @keyup.enter="cloneRepo"
          />
        </div>
        <div v-if="cloneError" class="error-msg">{{ cloneError }}</div>
        <div class="dialog-actions">
          <button class="btn" @click="showCloneDialog = false" :disabled="cloneLoading">
            取消
          </button>
          <button class="btn primary" @click="cloneRepo" :disabled="cloneLoading">
            {{ cloneLoading ? "克隆中..." : "克隆" }}
          </button>
        </div>
      </div>
    </div>
    <OpeningRepositoryOverlay :visible="loading" :repo-name="openingRepoPath" />
    <KeyboardShortcutsDialog v-if="showShortcutsDialog" @close="showShortcutsDialog = false" />

    <!-- 全局三栏冲突解决：checkout / pull 冲突时由 branchStore.conflictSignal 触发 -->
    <Teleport to="body">
      <div v-if="showConflictResolver" class="conflict-modal-overlay">
        <div class="conflict-modal-panel">
          <div class="conflict-modal-header">
            <span>解决冲突（{{ conflictFiles.length }} 个文件）</span>
            <button
              class="conflict-modal-close"
              title="关闭"
              @click="showConflictResolver = false"
            >
              ✕
            </button>
          </div>
          <div class="conflict-modal-body">
            <ThreeWayMerge
              :file-path="conflictFirstFile"
              :conflict-files="conflictFiles"
              @resolved="onGlobalConflictResolved"
            />
          </div>
        </div>
      </div>
    </Teleport>

    <RebaseSequencerDialog />
    <RebaseStatusBar />
    <Teleport to="body">
      <div v-if="toastVisible" class="global-toast" :class="`global-toast--${toastKind}`">
        {{ toastMessage }}
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.main-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

.global-toast {
  position: fixed;
  left: 50%;
  bottom: 36px;
  transform: translateX(-50%);
  z-index: 2000;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 12px;
  max-width: 70vw;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  user-select: text;
  pointer-events: none;
  white-space: pre-wrap;
}

.global-toast--ok {
  background: rgba(0, 122, 51, 0.92);
  color: #fff;
}

.global-toast--err {
  background: rgba(192, 64, 64, 0.92);
  color: #fff;
}

.global-toast--info {
  background: rgba(40, 40, 40, 0.92);
  color: #fff;
}

.main-content {
  flex: 1;
  overflow: hidden;
}

.repo-tabs {
  display: flex;
  gap: 2px;
  min-width: 0;
}

.repo-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 220px;
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-foreground);
}

.repo-tab:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border);
}

.repo-tab.active {
  background: var(--color-surface-active);
  border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
  box-shadow: inset 0 -2px 0 var(--color-primary);
}

.repo-name {
  min-width: 0;
  max-width: 160px;
  overflow: hidden;
  color: var(--color-foreground-bright);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-color {
  width: 10px;
  height: 10px;
  border: 1px solid color-mix(in srgb, currentColor 24%, var(--color-surface));
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 1px var(--color-surface);
}

.repo-close {
  display: flex;
  align-items: center;
  background: none;
  color: var(--color-foreground-muted);
  padding: 1px;
  border-radius: 2px;
}

.repo-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground-bright);
}

.toolbar-spacer {
  flex: 1;
}

/* 加号按钮 */
.add-repo-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.add-repo-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  color: var(--color-foreground-muted);
  border-radius: 4px;
  margin-left: 4px;
  flex-shrink: 0;
}

.add-repo-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground-bright);
}

.add-repo-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 4px;
  min-width: 140px;
  z-index: 500;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.add-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  color: var(--color-foreground);
  border-radius: 4px;
  font-size: 12px;
  text-align: left;
}

.add-menu-item:hover {
  background: var(--color-surface-hover);
}

.add-menu-divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 0;
}

.add-menu-submenu-anchor {
  position: relative;
}

.add-menu-item--has-submenu {
  justify-content: flex-start;
}

.add-menu-item-label {
  flex: 1;
  text-align: left;
}

.add-menu-chevron {
  color: var(--color-foreground-muted);
  margin-left: 4px;
  flex-shrink: 0;
}

.recent-submenu {
  position: absolute;
  top: -4px;
  left: calc(100% + 2px);
  min-width: 260px;
  max-width: 360px;
  max-height: 420px;
  overflow-y: auto;
  padding: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 501;
}

.recent-submenu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  color: var(--color-foreground);
  border-radius: 4px;
  font-size: 12px;
  text-align: left;
}

.recent-submenu-item:hover {
  background: var(--color-surface-hover);
}

.recent-submenu-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-foreground-bright);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-submenu-branch {
  color: var(--color-foreground-muted);
  font-weight: 400;
  margin-left: 4px;
}

.recent-submenu-clear {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  color: var(--color-foreground-muted);
  border-radius: 4px;
  font-size: 12px;
  text-align: left;
}

.recent-submenu-clear:hover {
  background: color-mix(in srgb, #e06c75 14%, transparent);
  color: #e06c75;
}

/* 弹框样式 */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 24px;
  min-width: 400px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialog h3 {
  font-size: 16px;
  font-weight: 500;
}

.dialog-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dialog-field label {
  font-size: 12px;
  color: var(--color-foreground-muted);
}

.dialog-field input {
  padding: 6px 8px;
  border-radius: 4px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 6px 16px;
  background: var(--color-surface-hover);
  color: var(--color-foreground);
  border-radius: 4px;
  font-size: 13px;
}

.btn:hover {
  background: var(--color-surface-active);
}

.btn.primary {
  background: var(--color-primary);
  color: white;
}

.btn.primary:hover {
  background: var(--color-primary-hover);
}

.btn:disabled,
.btn.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-msg {
  color: #e06c75;
  font-size: 12px;
  padding: 4px 0;
}

.add-menu-item:disabled {
  color: var(--color-foreground-muted);
  cursor: not-allowed;
  opacity: 0.6;
}

.patch-toast {
  position: fixed;
  top: 56px;
  right: 12px;
  max-width: 420px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1100;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  cursor: pointer;
}

.patch-toast.ok {
  border-color: #4ec9b0;
  color: #b8e4d8;
}

.patch-toast.err {
  border-color: #e06c75;
  color: #f3c0c4;
}

.patch-toast-close {
  font-size: 14px;
  line-height: 1;
  color: var(--color-foreground-muted);
  margin-left: auto;
}

/* ---- 全局三栏冲突解决弹窗 ---- */
.conflict-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.conflict-modal-panel {
  width: 90vw;
  height: 85vh;
  min-width: 600px;
  min-height: 400px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 60px);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.conflict-modal-header {
  position: relative;
  display: flex;
  align-items: center;
  padding: 8px 14px;
  padding-right: 44px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}

.conflict-modal-header > span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conflict-modal-close {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  width: 28px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
  border-radius: 4px;
  cursor: pointer;
}

.conflict-modal-close:hover {
  background: #c04040;
  border-color: #c04040;
  color: #fff;
}

.conflict-modal-body {
  flex: 1;
  overflow: hidden;
  display: flex;
}
</style>
