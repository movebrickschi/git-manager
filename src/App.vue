<script setup lang="ts">
import { watch } from "vue";
import { useSettingsStore } from "./stores/settingsStore";

const settings = useSettingsStore();

function syncTitleBarTheme(theme: "dark" | "light") {
  if (window.electronAPI?.invoke) {
    window.electronAPI.invoke("titlebar:set-theme", theme === "dark");
  }
}

syncTitleBarTheme(settings.theme);
watch(() => settings.theme, syncTitleBarTheme);
</script>

<template>
  <div :data-theme="settings.theme" class="h-full w-full">
    <router-view />
  </div>
</template>
