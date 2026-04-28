<script setup lang="ts">
import { ref } from "vue";
import { useBranchStore } from "@/stores/branchStore";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const branchStore = useBranchStore();
const newBranchName = ref("");
const startPoint = ref("");

async function createBranch() {
  if (!newBranchName.value.trim()) return;
  try {
    await branchStore.createBranch(
      newBranchName.value.trim(),
      startPoint.value.trim() || undefined
    );
    newBranchName.value = "";
    startPoint.value = "";
    emit("close");
  } catch (e: any) {
    console.error("Failed to create branch:", e);
  }
}
</script>

<template>
  <div v-if="visible" class="popup-overlay" @click.self="emit('close')">
    <div class="popup">
      <h4>新建分支</h4>
      <div class="field">
        <label>分支名称</label>
        <input
          v-model="newBranchName"
          placeholder="feature/my-feature"
          @keydown.enter="createBranch"
          autofocus
        />
      </div>
      <div class="field">
        <label>起始点 (可选)</label>
        <input v-model="startPoint" placeholder="HEAD" />
      </div>
      <div class="actions">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" @click="createBranch">创建</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.popup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
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
}

.popup h4 { font-size: 14px; font-weight: 500; }

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

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 6px 16px;
  background: var(--color-surface-hover);
  color: var(--color-foreground);
  border-radius: 4px;
  font-size: 12px;
}

.btn:hover { background: var(--color-surface-active); }
.btn.primary { background: var(--color-primary); color: white; }
.btn.primary:hover { background: var(--color-primary-hover); }
</style>
