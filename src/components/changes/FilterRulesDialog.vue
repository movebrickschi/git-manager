<script setup lang="ts">
defineProps<{
  visible: boolean;
  draft: string;
}>();

defineEmits<{
  (e: "update:draft", value: string): void;
  (e: "save"): void;
  (e: "cancel"): void;
  (e: "insert-example"): void;
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('cancel')">
      <div class="modal-dialog filter-modal">
        <div class="modal-header">
          <span class="modal-title">过滤规则（类似 .gitignore）</span>
          <button class="modal-close" @click="$emit('cancel')">✕</button>
        </div>
        <div class="modal-body">
          <p class="modal-hint filter-hint">
            每行一条规则，支持目录后缀 <code>/</code>、<code>**</code>、<code>*</code>、<code
              >!</code
            >
            取反与 <code>#</code> 注释。<br />
            示例：<code>.idea/</code> 隐藏 .idea 目录下所有文件；<code>**/*.log</code> 隐藏所有
            .log 文件。
          </p>
          <textarea
            :value="draft"
            class="filter-textarea"
            placeholder=".idea/&#10;node_modules/&#10;**/*.log"
            spellcheck="false"
            @input="$emit('update:draft', ($event.target as HTMLTextAreaElement).value)"
          />
        </div>
        <div class="modal-footer">
          <button class="modal-btn ghost" @click="$emit('insert-example')">插入示例</button>
          <div style="flex: 1"></div>
          <button class="modal-btn" @click="$emit('cancel')">取消</button>
          <button class="modal-btn primary" @click="$emit('save')">保存</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.filter-modal {
  width: 560px;
  max-width: 90vw;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
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

.modal-close {
  background: none;
  border: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
  line-height: 1;
}

.modal-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.modal-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-hint {
  margin: 0 12px 8px;
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.filter-hint {
  margin: 12px 12px 8px;
}

.filter-hint code {
  background: var(--color-surface-active);
  padding: 0 4px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.filter-textarea {
  width: calc(100% - 24px);
  margin: 0 12px 12px;
  min-height: 220px;
  padding: 10px 12px;
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  border-radius: 4px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
  resize: vertical;
  box-sizing: border-box;
}

.filter-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.modal-btn {
  padding: 5px 14px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-surface-active);
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

.modal-btn.ghost {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-foreground-muted);
}

.modal-btn.ghost:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}
</style>
