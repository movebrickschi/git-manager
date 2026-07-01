<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import OpeningRepositoryOverlay from "@/components/common/OpeningRepositoryOverlay.vue";
import { useRepoStore } from "@/stores/repoStore";
import { commands, platform } from "@/utils/commands";
import { errText } from "@/utils/error";

const router = useRouter();
const repoStore = useRepoStore();
const recentRepos = computed(() => repoStore.recentRepos);
const cloneUrl = ref("");
const clonePath = ref("");
const showCloneDialog = ref(false);
const cloneLoading = ref(false);
const cloneError = ref("");
const manualPath = ref("");
const showManualInput = ref(false);
const errorMsg = ref("");
const loading = ref(false);
const openingRepoPath = ref("");

onMounted(() => {
  repoStore.syncOpenReposToRecent();
});

async function openRepoWithFeedback(path: string) {
  errorMsg.value = "";
  loading.value = true;
  openingRepoPath.value = path;
  try {
    await repoStore.openRepo(path);
    router.push("/repo");
  } catch (e: any) {
    errorMsg.value = errText(e) || "打开仓库失败";
  } finally {
    loading.value = false;
    openingRepoPath.value = "";
  }
}

async function openFolder() {
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
  await openRepoWithFeedback(path);
  if (!errorMsg.value) {
    showManualInput.value = false;
    manualPath.value = "";
  }
}

async function openRecentRepo(repoPath: string) {
  await openRepoWithFeedback(repoPath);
}

function repoName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

async function cloneRepo() {
  if (!cloneUrl.value.trim() || !clonePath.value.trim()) return;
  cloneError.value = "";
  cloneLoading.value = true;
  try {
    const path = clonePath.value.trim();
    await commands.cloneRepo(cloneUrl.value.trim(), path);
    await openRepoWithFeedback(path);
    if (!errorMsg.value) {
      showCloneDialog.value = false;
      cloneUrl.value = "";
      clonePath.value = "";
    }
  } catch (e: any) {
    cloneError.value = errText(e) || "克隆失败";
  } finally {
    cloneLoading.value = false;
  }
}
</script>

<template>
  <div class="welcome-view">
    <div class="welcome-content">
      <div class="welcome-header">
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-primary)"
          stroke-width="1.5"
        >
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M13 6h3a2 2 0 0 1 2 2v7" />
          <line x1="6" y1="9" x2="6" y2="21" />
        </svg>
        <h1>Git Manager</h1>
      </div>

      <div v-if="errorMsg" class="welcome-error">
        <span class="welcome-error__icon">⚠</span>
        <span class="welcome-error__text">{{ errorMsg }}</span>
        <button class="welcome-error__close" @click="errorMsg = ''">✕</button>
      </div>

      <div class="welcome-actions">
        <button class="action-btn primary" :disabled="loading" @click="openFolder">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          打开仓库
        </button>

        <button class="action-btn" @click="showCloneDialog = true">
          <svg
            width="20"
            height="20"
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
      </div>

      <div class="recent-repos">
        <h3>最近打开</h3>
        <div v-if="recentRepos.length === 0" class="recent-repo-empty">
          暂无历史，打开仓库后会显示在这里
        </div>
        <button
          v-for="repo in recentRepos"
          :key="repo.path"
          class="recent-repo-item"
          :disabled="loading"
          :title="repo.path"
          @click="openRecentRepo(repo.path)"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span class="recent-repo-text">
            <span class="recent-repo-headline">
              <span class="recent-repo-name">{{ repoName(repo.path) }}</span>
              <span v-if="repo.branch" class="recent-repo-branch">[{{ repo.branch }}]</span>
            </span>
            <span class="recent-repo-path">{{ repo.path }}</span>
          </span>
        </button>
      </div>
    </div>

    <OpeningRepositoryOverlay :visible="loading" :repo-name="openingRepoPath" />

    <!-- Manual path dialog (Web mode) -->
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

    <!-- Clone dialog -->
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
  </div>
</template>

<style scoped>
.welcome-view {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--color-background);
  -webkit-app-region: drag;
}

.welcome-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  max-width: 480px;
}

.welcome-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.welcome-header h1 {
  font-size: 28px;
  font-weight: 300;
  color: var(--color-foreground-bright);
}

.welcome-subtitle {
  color: var(--color-foreground-muted);
  font-size: 14px;
}

.welcome-actions {
  display: flex;
  gap: 16px;
}

.action-btn {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: var(--color-surface);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  transition: all 0.15s;
}

.action-btn:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-primary);
}

.action-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.action-btn.primary:hover {
  background: var(--color-primary-hover);
}

.recent-repos {
  width: 100%;
  max-height: 260px;
  overflow: auto;
}

.recent-repos h3 {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-foreground-muted);
  margin-bottom: 8px;
}

.recent-repo-empty {
  -webkit-app-region: no-drag;
  padding: 14px 12px;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  color: var(--color-foreground-muted);
  font-size: 12px;
  text-align: center;
}

.recent-repo-item {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-foreground);
  font-size: 13px;
  text-align: left;
}

.recent-repo-item:hover {
  background: var(--color-surface-hover);
}

.recent-repo-item:disabled {
  cursor: wait;
  opacity: 0.65;
}

.recent-repo-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}

.recent-repo-headline {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.recent-repo-name {
  overflow: hidden;
  color: var(--color-foreground-bright);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-repo-branch {
  color: var(--color-foreground-muted);
  font-size: 12px;
  font-weight: 400;
  flex-shrink: 0;
}

.recent-repo-path {
  overflow: hidden;
  color: var(--color-foreground-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-overlay {
  -webkit-app-region: no-drag;
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

.error-msg {
  color: #e06c75;
  font-size: 12px;
  padding: 4px 0;
}

.welcome-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-surface-error, rgba(224, 82, 82, 0.12));
  border: 1px solid var(--color-error, #e05252);
  color: var(--color-error, #e05252);
  border-radius: 4px;
  font-size: 13px;
  width: 100%;
  max-width: 480px;
  box-sizing: border-box;
}

.welcome-error__icon {
  font-size: 16px;
  line-height: 1;
}

.welcome-error__text {
  flex: 1;
  word-break: break-word;
}

.welcome-error__close {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
  opacity: 0.7;
}

.welcome-error__close:hover {
  background: rgba(255, 255, 255, 0.08);
  opacity: 1;
}

.welcome-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  color: var(--color-foreground-muted);
  font-size: 13px;
}

.welcome-loading__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: welcome-spin 0.8s linear infinite;
}

@keyframes welcome-spin {
  to {
    transform: rotate(360deg);
  }
}

.btn:disabled,
.btn.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
