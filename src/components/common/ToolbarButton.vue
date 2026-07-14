<script setup lang="ts">
defineProps<{
  title?: string;
  disabled?: boolean;
  active?: boolean;
}>();

defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    class="toolbar-btn"
    :class="{ active, disabled }"
    :title="title"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <slot />
  </button>
</template>

<style scoped>
.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: var(--control-height-compact);
  padding: 0 8px;
  background: transparent;
  color: var(--color-foreground);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-size: 12px;
  white-space: nowrap;
}

.toolbar-btn:hover:not(.disabled) {
  background: var(--color-surface-hover);
  color: var(--color-foreground-bright);
}

.toolbar-btn.active {
  background: color-mix(in srgb, var(--color-primary) 14%, var(--color-surface-emphasis));
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 24%, transparent);
}

.toolbar-btn.disabled {
  opacity: 0.48;
  cursor: default;
}

.toolbar-btn:focus-visible {
  box-shadow: var(--focus-ring);
}

.toolbar-btn :deep(svg) {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
</style>
