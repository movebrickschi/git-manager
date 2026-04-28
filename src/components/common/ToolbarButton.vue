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
  padding: 3px 6px;
  background: transparent;
  color: var(--color-foreground);
  border-radius: 3px;
  font-size: 12px;
  white-space: nowrap;
}

.toolbar-btn:hover:not(.disabled) {
  background: var(--color-surface-hover);
}

.toolbar-btn.active {
  background: var(--color-surface-active);
}

.toolbar-btn.disabled {
  opacity: 0.4;
  cursor: default;
}

.toolbar-btn :deep(svg) {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
</style>
