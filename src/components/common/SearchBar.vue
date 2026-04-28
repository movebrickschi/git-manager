<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  search: [value: string];
}>();

const inputRef = ref<HTMLInputElement>();

function onInput(e: Event) {
  const value = (e.target as HTMLInputElement).value;
  emit("update:modelValue", value);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    emit("search", props.modelValue);
  }
  if (e.key === "Escape") {
    emit("update:modelValue", "");
    inputRef.value?.blur();
  }
}

function clear() {
  emit("update:modelValue", "");
  inputRef.value?.focus();
}

function focus() {
  inputRef.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <div class="search-bar">
    <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
    <input
      ref="inputRef"
      type="text"
      :value="modelValue"
      :placeholder="placeholder || '搜索...'"
      @input="onInput"
      @keydown="onKeydown"
    />
    <button v-if="modelValue" class="clear-btn" @click="clear">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.search-bar {
  display: flex;
  align-items: center;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 0 6px;
  gap: 4px;
  height: 24px;
}

.search-bar:focus-within {
  border-color: var(--color-primary);
}

.search-icon {
  color: var(--color-foreground-muted);
  flex-shrink: 0;
}

.search-bar input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 0;
  height: 100%;
  min-width: 60px;
  font-size: 12px;
}

.clear-btn {
  display: flex;
  align-items: center;
  background: none;
  color: var(--color-foreground-muted);
  padding: 2px;
  border-radius: 2px;
}

.clear-btn:hover {
  color: var(--color-foreground);
  background: var(--color-surface-hover);
}
</style>
