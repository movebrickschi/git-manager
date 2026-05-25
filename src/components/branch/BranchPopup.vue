<script setup lang="ts">
import { ref, watch, nextTick } from "vue";

const props = defineProps<{
  visible: boolean;
  fromBranch?: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [name: string, fromBranch: string];
}>();

const newBranchName = ref("");
const inputRef = ref<HTMLInputElement>();

watch(
  () => props.visible,
  (val) => {
    if (val) {
      newBranchName.value = "";
      nextTick(() => inputRef.value?.focus());
    }
  }
);

function handleConfirm() {
  const name = newBranchName.value.trim();
  if (!name) return;
  emit("confirm", name, props.fromBranch ?? "HEAD");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="popup-overlay" @click.self="emit('close')">
      <div class="popup">
        <h4>新建分支</h4>
        <div class="field">
          <label>基于</label>
          <input :value="fromBranch ?? 'HEAD'" disabled class="disabled-input" />
        </div>
        <div class="field">
          <label>分支名称</label>
          <input
            ref="inputRef"
            v-model="newBranchName"
            placeholder="feature/my-feature"
            @keydown.enter="handleConfirm"
          />
        </div>
        <div class="actions">
          <button class="btn" @click="emit('close')">取消</button>
          <button class="btn primary" :disabled="!newBranchName.trim()" @click="handleConfirm">创建</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.popup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.popup {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 20px;
  min-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.popup h4 {
  font-size: 14px;
  font-weight: 500;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field label {
  font-size: 12px;
  color: var(--color-foreground-muted);
}

.field input {
  padding: 6px 8px;
  border-radius: 3px;
}

.disabled-input {
  opacity: 0.6;
  cursor: not-allowed;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn {
  padding: 6px 16px;
  background: var(--color-surface-hover);
  color: var(--color-foreground);
  border-radius: 4px;
  font-size: 12px;
}

.btn:hover {
  background: var(--color-surface-active);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--color-primary);
  color: white;
}

.btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}
</style>
