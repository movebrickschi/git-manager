<script setup lang="ts">
import type { MergeStateSnapshot } from "@/composables/useMergeState";

defineProps<{
  state: MergeStateSnapshot | null;
  busy: boolean;
}>();

defineEmits<{
  (e: "continue"): void;
  (e: "abort"): void;
}>();
</script>

<template>
  <div
    v-if="state && state.state !== 'none'"
    class="merge-banner"
    :class="`merge-banner--${state.state}`"
  >
    <span class="merge-banner__icon">⚠</span>
    <span class="merge-banner__text">
      当前处于 <strong>{{ state.state }}</strong> 进行中
      <template v-if="state.hasConflicts">，存在未解决的冲突</template>
    </span>
    <button
      class="merge-banner__btn merge-banner__btn--primary"
      :disabled="state.hasConflicts || busy"
      @click="$emit('continue')"
    >
      继续
    </button>
    <button
      class="merge-banner__btn merge-banner__btn--danger"
      :disabled="busy"
      @click="$emit('abort')"
    >
      中止
    </button>
  </div>
</template>

<style scoped>
.merge-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-warning-bg, #3b2f00);
  color: var(--color-warning-fg, #ffd54f);
  border-bottom: 1px solid var(--color-warning-border, #6b5a00);
  font-size: 13px;
}
.merge-banner--cherry-pick {
  background: var(--color-info-bg, #1e2f3b);
  color: var(--color-info-fg, #4fc3f7);
  border-bottom-color: var(--color-info-border, #00567b);
}
.merge-banner__icon {
  font-size: 16px;
  line-height: 1;
}
.merge-banner__text {
  flex: 1;
  min-width: 0;
}
.merge-banner__text strong {
  text-transform: capitalize;
}
.merge-banner__btn {
  padding: 4px 10px;
  border-radius: 3px;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
}
.merge-banner__btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}
.merge-banner__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.merge-banner__btn--primary {
  background: var(--color-primary, #2196f3);
  color: white;
  border-color: var(--color-primary, #2196f3);
}
.merge-banner__btn--danger {
  border-color: var(--color-danger, #e57373);
  color: var(--color-danger, #e57373);
}
</style>
