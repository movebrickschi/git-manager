<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  visible: boolean;
  repoName?: string;
}>();

const { t } = useI18n();
</script>

<template>
  <Transition name="repo-opening-fade">
    <div v-if="visible" class="repo-opening-overlay" role="status" aria-live="polite">
      <div class="repo-opening-card">
        <span class="repo-opening-spinner" aria-hidden="true" />
        <div class="repo-opening-text">
          <div class="repo-opening-title">{{ t("common.opening_repo") }}</div>
          <div class="repo-opening-hint">{{ t("common.opening_repo_hint") }}</div>
          <div v-if="repoName" class="repo-opening-path" :title="repoName">{{ repoName }}</div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.repo-opening-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(2px);
  -webkit-app-region: no-drag;
}

.repo-opening-card {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 300px;
  max-width: min(520px, calc(100vw - 48px));
  padding: 18px 22px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  color: var(--color-foreground);
}

.repo-opening-spinner {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: repo-opening-spin 0.8s linear infinite;
}

.repo-opening-text {
  min-width: 0;
}

.repo-opening-title {
  color: var(--color-foreground-bright);
  font-size: 14px;
  font-weight: 600;
}

.repo-opening-hint {
  margin-top: 3px;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

.repo-opening-path {
  overflow: hidden;
  margin-top: 8px;
  color: var(--color-foreground-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-opening-fade-enter-active,
.repo-opening-fade-leave-active {
  transition:
    opacity var(--transition-normal),
    backdrop-filter var(--transition-normal);
}

.repo-opening-fade-enter-from,
.repo-opening-fade-leave-to {
  opacity: 0;
  backdrop-filter: blur(0);
}

@keyframes repo-opening-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
