<script setup lang="ts">
import { watch } from "vue";
import { useSettingsStore } from "./stores/settingsStore";
import { useRepoStore } from "./stores/repoStore";
import { useCommitStore } from "./stores/commitStore";
import { useBranchStore } from "./stores/branchStore";
import { useLogStore } from "./stores/logStore";
import { useRepoWatcher, setWatchedRepo } from "./composables/useRepoWatcher";

const settings = useSettingsStore();
const repoStore = useRepoStore();
const commitStore = useCommitStore();
const branchStore = useBranchStore();
const logStore = useLogStore();

function syncTitleBarTheme(theme: "dark" | "light") {
  if (window.electronAPI?.invoke) {
    window.electronAPI.invoke("titlebar:set-theme", theme === "dark");
  }
}

/**
 * 把 data-theme 同步到 <html>，让 CSS 变量在 Teleport 出去的弹窗（SystemSettingsDialog 等）
 * 也能拿到正确的主题色。原先 data-theme 只设在 App.vue 内层 div 上，Teleport 到 body
 * 的元素无法继承到。
 */
function syncDocumentTheme(theme: "dark" | "light") {
  document.documentElement.setAttribute("data-theme", theme);
}

syncTitleBarTheme(settings.theme);
syncDocumentTheme(settings.theme);
watch(() => settings.theme, (v) => {
  syncTitleBarTheme(v);
  syncDocumentTheme(v);
});

// 同步当前 active repo 给 watcher；用户禁用 autoRefresh 时传 null 让 watcher 释放资源
watch(
  () => ({
    p: repoStore.activeRepo?.path ?? null,
    enabled: settings.autoRefreshOnFsChange,
  }),
  ({ p, enabled }) => {
    void setWatchedRepo(enabled ? p : null);
  },
  { immediate: true, deep: false }
);

useRepoWatcher((e) => {
  console.log(
    `[bug-trace] ${performance.now().toFixed(1)} useRepoWatcher event kind=${e.kind} activeRepo=${repoStore.activeRepo?.path ?? "∅"}`
  );
  // 用户关闭了自动刷新 → 不处理事件（watcher 也应已关，是双保险）
  if (!settings.autoRefreshOnFsChange) return;
  if (e.kind === "work" || e.kind === "index") {
    void commitStore.loadStatus();
    return;
  }
  if (e.kind === "head") {
    void Promise.all([
      commitStore.loadStatus(),
      branchStore.loadBranches(),
      logStore.loadCommits(true),
    ]);
    return;
  }
  void commitStore.loadStatus();
});
</script>

<template>
  <div :data-theme="settings.theme" class="h-full w-full">
    <router-view />
  </div>
</template>
