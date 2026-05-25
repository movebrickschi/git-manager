<script setup lang="ts">
defineProps<{
  compact?: boolean;
  draggable?: boolean;
}>();
</script>

<template>
  <div class="toolbar" :class="{ compact, 'app-drag': draggable }">
    <slot />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: var(--color-surface);
  border-bottom: none;
  box-shadow: 0 1px 0 var(--color-border);
  flex-shrink: 0;
  min-height: 32px;
}

.toolbar.app-drag {
  -webkit-app-region: drag;
}

.toolbar.app-drag :deep(button),
.toolbar.app-drag :deep(input),
.toolbar.app-drag :deep(a),
.toolbar.app-drag :deep(.repo-tab),
.toolbar.app-drag :deep(.add-repo-btn),
.toolbar.app-drag :deep(.add-repo-wrapper) {
  -webkit-app-region: no-drag;
}

.toolbar.compact {
  padding: 2px 4px;
  min-height: 26px;
}
</style>
