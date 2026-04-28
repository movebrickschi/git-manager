<script setup lang="ts">
import { useSettingsStore } from "./stores/settingsStore";

const settings = useSettingsStore();
</script>

<template>
  <div :data-theme="settings.theme" class="h-full w-full">
    <router-view />
  </div>
</template>
