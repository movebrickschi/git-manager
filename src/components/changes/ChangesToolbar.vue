<script setup lang="ts">
defineProps<{
  title: string;
  totalCount: number;
  hiddenCount: number;
  hasFilterRules: boolean;
  showFiltered: boolean;
}>();

defineEmits<{
  (e: "open-filter"): void;
  (e: "toggle-show-filtered"): void;
  (e: "stage-all"): void;
  (e: "unstage-all"): void;
  (e: "refresh"): void;
}>();
</script>

<template>
  <div class="panel-header">
    <span class="panel-title">{{ title }}</span>
    <span class="panel-count">{{ totalCount }}</span>
    <span
      v-if="hiddenCount > 0"
      class="panel-hidden-count"
      :title="`${hiddenCount} 个文件被过滤规则隐藏`"
    >
      -{{ hiddenCount }}
    </span>
    <div class="header-actions">
      <button
        class="action-btn"
        :class="{ 'has-rules': hasFilterRules }"
        title="过滤规则"
        @click="$emit('open-filter')"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      </button>
      <button
        class="action-btn"
        :class="{ active: showFiltered }"
        :disabled="!hasFilterRules"
        :title="showFiltered ? '隐藏被过滤项' : '显示被过滤项'"
        @click="$emit('toggle-show-filtered')"
      >
        <svg
          v-if="showFiltered"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <svg
          v-else
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
          />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      </button>
      <button class="action-btn" title="暂存所有" @click="$emit('stage-all')">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="7 13 12 18 17 13" />
          <line x1="12" y1="6" x2="12" y2="18" />
        </svg>
      </button>
      <button class="action-btn" title="取消暂存所有" @click="$emit('unstage-all')">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="17 11 12 6 7 11" />
          <line x1="12" y1="18" x2="12" y2="6" />
        </svg>
      </button>
      <button class="action-btn" title="刷新" @click="$emit('refresh')">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-foreground);
}

.panel-count {
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  padding: 0 6px;
  border-radius: 8px;
}

.panel-hidden-count {
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  padding: 0 5px;
  border-radius: 8px;
  font-style: italic;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  color: var(--color-foreground-muted);
  padding: 3px;
  border-radius: 3px;
  cursor: pointer;
  border: none;
}

.action-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.action-btn.has-rules {
  color: var(--color-primary);
}

.action-btn.active {
  background: var(--color-surface-active);
  color: var(--color-primary);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
