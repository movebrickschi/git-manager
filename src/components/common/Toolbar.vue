<script setup lang="ts">
defineProps<{
  compact?: boolean;
}>();
</script>

<template>
  <div class="toolbar" :class="{ compact }">
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
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  min-height: 32px;
}

.toolbar.compact {
  padding: 2px 4px;
  min-height: 26px;
}
</style>
