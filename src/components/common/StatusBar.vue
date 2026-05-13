<script setup lang="ts">
import { useRepoStore } from "@/stores/repoStore";
import { useSettingsStore } from "@/stores/settingsStore";

const repoStore = useRepoStore();
const settings = useSettingsStore();
</script>

<template>
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
        <span class="status-item repo-path">{{ repoStore.activeRepo.path }}</span>
      </template>
      <span v-else class="status-item">未打开仓库</span>
    </div>
    <div class="status-bar-right">
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
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  padding: 0 8px;
  background: var(--color-primary);
  color: white;
  font-size: 12px;
  flex-shrink: 0;
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

.repo-path {
  opacity: 0.8;
  font-size: 11px;
}

.theme-toggle {
  background: none;
  color: white;
  padding: 2px;
  display: flex;
  align-items: center;
  border-radius: 2px;
}

.theme-toggle:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
