<script setup lang="ts">
withDefaults(
  defineProps<{
    visible: boolean;
    title: string;
    text: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }>(),
  {
    confirmLabel: "确定",
    cancelLabel: "取消",
    danger: true,
  }
);

defineEmits<{
  (e: "confirm"): void;
  (e: "cancel"): void;
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('cancel')">
      <div class="modal-dialog confirm-modal">
        <div class="modal-header">
          <span class="modal-title">{{ title }}</span>
        </div>
        <div class="modal-body">
          <p class="confirm-text">{{ text }}</p>
        </div>
        <div class="modal-footer">
          <button class="modal-btn" @click="$emit('cancel')">{{ cancelLabel }}</button>
          <button
            class="modal-btn"
            :class="{ danger: danger, primary: !danger }"
            @click="$emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-backdrop);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-dialog {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-overlay);
  overflow: hidden;
}

.confirm-modal {
  width: 400px;
  max-width: calc(100vw - 32px);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--panel-header-height);
  padding: 4px 14px;
  background: var(--color-surface-emphasis);
  flex-shrink: 0;
}

.modal-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-foreground);
  font-family: var(--font-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.confirm-text {
  padding: 16px;
  font-size: 13px;
  color: var(--color-foreground);
  line-height: 1.5;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 50vh;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  background: var(--color-surface-muted);
  border-top: 1px solid var(--color-divider);
  flex-shrink: 0;
}

.modal-btn {
  min-height: var(--control-height-regular);
  padding: 4px 14px;
  font-size: 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  background: var(--color-surface-emphasis);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
}

.modal-btn:hover {
  background: var(--color-surface-hover);
}

.modal-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.modal-btn.primary:hover {
  background: var(--color-primary-hover);
}

.modal-btn.danger {
  background: var(--color-error);
  color: white;
  border-color: var(--color-error);
}

.modal-btn.danger:hover {
  opacity: 0.85;
}
</style>
