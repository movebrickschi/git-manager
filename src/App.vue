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

syncTitleBarTheme(settings.theme);
watch(() => settings.theme, syncTitleBarTheme);

watch(
  () => repoStore.activeRepo?.path ?? null,
  (p) => {
    void setWatchedRepo(p);
  },
  { immediate: true }
);

useRepoWatcher((e) => {
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
