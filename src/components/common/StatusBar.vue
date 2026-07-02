<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref } from "vue";
import { useRepoStore } from "@/stores/repoStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAutoFetch } from "@/composables/useAutoFetch";
import { useUiStore } from "@/stores/uiStore";
import { commands } from "@/utils/commands";
import { isRepoNetworkBusy } from "@/utils/network-busy";

const SystemSettingsDialog = defineAsyncComponent(
  () => import("@/components/common/SystemSettingsDialog.vue")
);

const repoStore = useRepoStore();
const settings = useSettingsStore();
const ui = useUiStore();
const { isFetching, lastFetchAt, lastErrors, triggerFetch } = useAutoFetch();
const showIntervalEditor = ref(false);
const showSystemSettings = ref(false);
const intervalInput = ref(String(settings.autoFetchIntervalMinutes));
const intervalInputRef = ref<HTMLInputElement | null>(null);

function toggleAutoFetch() {
  settings.setAutoFetchEnabled(!settings.autoFetchEnabled);
}

/** 仅当「当前激活仓库」有在途联网操作时点亮指示器，避免后台别的仓库联网时也常亮误导。 */
const activeRepoNetworkBusy = computed(() => isRepoNetworkBusy(repoStore.activeRepo?.path));

/** 中止「当前激活仓库」在途的联网 Git 操作（push/pull/fetch）——请求后端杀掉对应 git 子进程。 */
async function cancelNetwork() {
  const repo = repoStore.activeRepo?.path;
  if (!repo) return;
  try {
    await commands.cancelNetworkOps(repo);
  } catch {
    /* 取消失败无需打扰用户 */
  }
}

function manualFetch() {
  if (!isFetching.value) void triggerFetch();
}

async function openIntervalEditor() {
  intervalInput.value = String(settings.autoFetchIntervalMinutes);
  showIntervalEditor.value = true;
  await nextTick();
  intervalInputRef.value?.select();
}

function applyInterval() {
  const n = Number(intervalInput.value);
  if (Number.isFinite(n)) {
    settings.setAutoFetchIntervalMinutes(n);
    showIntervalEditor.value = false;
  }
}

const fetchTitle = computed(() => {
  const parts: string[] = [];
  parts.push(settings.autoFetchEnabled ? "自动抓取 已开启" : "自动抓取 已关闭");
  parts.push(`间隔：${settings.autoFetchIntervalMinutes} 分钟（右键修改）`);
  if (lastFetchAt.value) {
    parts.push(`上次抓取：${new Date(lastFetchAt.value).toLocaleTimeString()}`);
  }
  if (lastErrors.value.size > 0) {
    parts.push(`${lastErrors.value.size} 个仓库上次失败`);
  }
  parts.push("点击：切换 · 中键：立即抓取");
  return parts.join("\n");
});
</script>

<template>
  <div class="status-bar-wrapper">
    <div class="status-bar">
    <div class="status-bar-left">
      <template v-if="repoStore.activeRepo">
        <span class="status-item branch-indicator">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          {{ repoStore.activeRepo.currentBranch }}
        </span>
        <Transition name="progress-capsule">
          <span v-if="ui.progressActive" class="progress-capsule">
            <span class="progress-capsule-fill" />
            <span class="progress-capsule-spinner" />
            <span class="progress-capsule-label">{{ ui.progressLabel }}</span>
          </span>
        </Transition>
        <span class="status-item repo-path">{{ repoStore.activeRepo.path }}</span>
      </template>
      <span v-else class="status-item">未打开仓库</span>
      <Transition name="progress-capsule">
        <span v-if="activeRepoNetworkBusy" class="net-busy-capsule">
          <span class="progress-capsule-spinner" />
          <span class="progress-capsule-label">联网中…</span>
          <button
            class="net-cancel-btn"
            title="中止当前仓库进行中的联网 Git 操作（push / pull / fetch）"
            @click="cancelNetwork"
          >
            中止
          </button>
        </span>
      </Transition>
    </div>
    <div class="status-bar-right">
      <div class="auto-fetch-wrapper">
        <button
          class="status-item auto-fetch-toggle"
          :class="{ active: settings.autoFetchEnabled, busy: isFetching, error: lastErrors.size > 0 }"
          :title="fetchTitle"
          @click="toggleAutoFetch"
          @click.middle.prevent="manualFetch"
          @contextmenu.prevent="openIntervalEditor"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            :class="{ spin: isFetching }"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span v-if="settings.autoFetchEnabled" class="auto-fetch-min">{{
            settings.autoFetchIntervalMinutes
          }}m</span>
        </button>
        <div v-if="showIntervalEditor" class="interval-popover" @click.stop>
          <label>抓取间隔（分钟）</label>
          <div class="interval-row">
            <input
              ref="intervalInputRef"
              v-model="intervalInput"
              type="number"
              min="1"
              max="120"
              @keydown.enter.prevent="applyInterval"
              @keydown.esc.prevent="showIntervalEditor = false"
            />
            <button @click="applyInterval">确定</button>
          </div>
        </div>
      </div>
      <button
        class="status-item auto-refresh-toggle"
        :class="{ active: settings.autoRefreshOnFsChange }"
        :title="settings.autoRefreshOnFsChange
          ? '文件系统 watcher 已开启：外部 IDE 改文件后自动刷新（点击关闭，更多设置见⚙️）'
          : '文件系统 watcher 已关闭：超大仓库可禁用以节省资源（点击开启，更多设置见⚙️）'"
        @click="settings.setAutoRefreshOnFsChange(!settings.autoRefreshOnFsChange)"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v6m0 10v6m11-11h-6M7 12H1m17.07-7.07l-4.24 4.24M9.17 14.83l-4.24 4.24m0-14.14l4.24 4.24M14.83 14.83l4.24 4.24" />
        </svg>
      </button>
      <button
        class="status-item settings-gear-btn"
        title="系统设置（外观/编辑器/watcher/Fetch/AI/关于）"
        @click="showSystemSettings = true"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <button class="status-item theme-toggle" @click="settings.toggleTheme" title="切换主题">
        <svg
          v-if="settings.theme === 'dark'"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
        <svg
          v-else
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>
    </div>
  </div>
  </div>

  <Teleport to="body">
    <Transition name="toast">
      <div v-if="ui.toastVisible" class="global-toast">{{ ui.toastMessage }}</div>
    </Transition>
    <SystemSettingsDialog
      v-if="showSystemSettings"
      :visible="showSystemSettings"
      @update:visible="(v: boolean) => (showSystemSettings = v)"
    />
  </Teleport>
</template>

<style scoped>
.status-bar-wrapper {
  flex-shrink: 0;
  position: relative;
}

.progress-capsule {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  position: relative;
  height: 14px;
  padding: 0 8px 0 4px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  overflow: hidden;
  font-size: 10px;
  color: var(--color-primary);
  letter-spacing: 0.2px;
}

.progress-capsule-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 35%;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-primary) 25%, transparent), transparent);
  animation: capsule-slide 1.6s ease-in-out infinite;
}

.progress-capsule-spinner {
  width: 8px;
  height: 8px;
  border: 1.5px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: capsule-spin 0.8s linear infinite;
  flex-shrink: 0;
}

.progress-capsule-label {
  position: relative;
  z-index: 1;
  white-space: nowrap;
  font-weight: 500;
}

@keyframes capsule-slide {
  0% { left: -35%; }
  100% { left: 100%; }
}

@keyframes capsule-spin {
  to { transform: rotate(360deg); }
}

.progress-capsule-enter-active,
.progress-capsule-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.progress-capsule-enter-from,
.progress-capsule-leave-to {
  opacity: 0;
  transform: scaleX(0.8);
}

.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  padding: 0 10px;
  background: var(--color-surface);
  color: var(--color-foreground-muted);
  font-size: 12px;
  flex-shrink: 0;
  box-shadow: 0 -1px 0 var(--color-border);
}

.global-toast {
  position: fixed;
  bottom: 36px;
  right: 16px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
  font-size: 12px;
  padding: 8px 16px;
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 9999;
  pointer-events: none;
  white-space: nowrap;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.status-bar-left,
.status-bar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.branch-indicator {
  color: var(--color-primary);
  font-weight: 500;
}

.repo-path {
  opacity: 0.85;
  font-size: 11px;
}

.theme-toggle {
  background: none;
  color: var(--color-foreground-muted);
  padding: 2px;
  display: flex;
  align-items: center;
  border-radius: 3px;
}

.theme-toggle:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.auto-fetch-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.auto-fetch-toggle {
  display: flex;
  align-items: center;
  gap: 3px;
  background: none;
  color: var(--color-foreground-muted);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  opacity: 0.7;
}

.auto-fetch-toggle:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
  opacity: 1;
}

.auto-fetch-toggle.active {
  color: var(--color-primary);
  opacity: 1;
}

.auto-fetch-toggle.busy svg {
  color: var(--color-warning);
}

.auto-fetch-toggle.error svg {
  color: var(--color-error);
}

.auto-fetch-min {
  font-feature-settings: "tnum";
  letter-spacing: 0;
}

.interval-popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 1000;
  width: 180px;
  padding: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  color: var(--color-foreground);
}

.interval-popover label {
  display: block;
  margin-bottom: 6px;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

.interval-row {
  display: flex;
  gap: 6px;
}

.interval-row input {
  min-width: 0;
  flex: 1;
  padding: 4px 6px;
}

.interval-row button {
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: white;
}

.interval-row button:hover {
  background: var(--color-primary-hover);
}

@keyframes auto-fetch-spin {
  to {
    transform: rotate(360deg);
  }
}

.spin {
  animation: auto-fetch-spin 1.2s linear infinite;
  transform-origin: 50% 50%;
}

.net-busy-capsule {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 16px;
  padding: 0 4px 0 7px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-warning, #e0a020) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-warning, #e0a020) 35%, transparent);
  font-size: 10px;
  color: var(--color-warning, #e0a020);
  letter-spacing: 0.2px;
}

.net-cancel-btn {
  background: var(--color-error, #e05252);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 10px;
  line-height: 1;
  padding: 2px 6px;
  cursor: pointer;
}

.net-cancel-btn:hover {
  background: color-mix(in srgb, var(--color-error, #e05252) 85%, black);
}
</style>
