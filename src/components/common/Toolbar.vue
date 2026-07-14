<script setup lang="ts">
withDefaults(
  defineProps<{
    compact?: boolean;
    draggable?: boolean;
    variant?: "app" | "embedded";
  }>(),
  {
    variant: "embedded",
  }
);
</script>

<template>
  <div
    class="toolbar"
    :class="[`toolbar--${variant}`, { compact, 'app-drag': draggable }]"
  >
    <slot />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-height-regular);
  padding: 2px var(--space-2);
  background: var(--color-surface-muted);
  flex-shrink: 0;
}

.toolbar--app {
  min-height: var(--app-toolbar-height);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-divider);
}

.toolbar--embedded {
  box-shadow: none;
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
  min-height: var(--control-height-compact);
}
</style>
