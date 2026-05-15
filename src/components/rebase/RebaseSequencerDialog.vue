<script setup lang="ts">
/**
 * IDEA 风格 Interactive Rebase Sequencer 对话框。
 *
 * 行布局：[↑ ↓] [Action ▼] [shortId] [subject / reword 时变 inline 输入框]
 *
 * Action 下拉 6 选 1：pick / drop / reword / squash / fixup / edit
 * - 第一行禁用 squash / fixup（git 要求第一行不能合并到"前一个"）
 * - 选中 reword 时 subject 列变成可编辑 textarea
 *
 * "开始 Rebase" 后 dialog 立刻 disabled 等待后端返回。
 */
import { computed } from "vue";
import { useRebaseStore } from "@/stores/rebaseStore";
import type { RebaseAction, RebaseTodoEntry } from "@/utils/commands";

const rebaseStore = useRebaseStore();

const dialog = computed(() => rebaseStore.dialog);

interface ActionOption {
  value: RebaseAction;
  label: string;
  desc: string;
}

const actions: ActionOption[] = [
  { value: "pick", label: "Pick", desc: "保留" },
  { value: "reword", label: "Reword", desc: "改 message" },
  { value: "squash", label: "Squash", desc: "合并到上一个（保留 message）" },
  { value: "fixup", label: "Fixup", desc: "合并到上一个（丢弃 message）" },
  { value: "edit", label: "Edit", desc: "停下来手动改" },
  { value: "drop", label: "Drop", desc: "丢弃" },
];

function actionClass(a: RebaseAction): string {
  return `act act--${a}`;
}

function canSquashAt(index: number): boolean {
  // git 要求第一行非 squash/fixup；前面若全 drop 也不行
  for (let i = 0; i < index; i++) {
    const t = dialog.value.todos[i] as RebaseTodoEntry | undefined;
    if (t && t.action !== "drop") return true;
  }
  return false;
}

function onActionChange(index: number, value: RebaseAction): void {
  const fallback: RebaseAction = "pick";
  const next: RebaseAction =
    (value === "squash" || value === "fixup") && !canSquashAt(index) ? fallback : value;
  rebaseStore.updateTodo(index, { action: next });
}

function close(): void {
  if (dialog.value.pending) return;
  rebaseStore.close();
}

async function startRebase(): Promise<void> {
  await rebaseStore.start();
}

function dropCount(): number {
  return dialog.value.todos.filter((t) => t.action === "drop").length;
}

function effectiveCount(): number {
  return dialog.value.todos.length - dropCount();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="dialog.visible" class="rb-overlay" @click.self="close">
      <div class="rb-panel">
        <div class="rb-header">
          <span class="rb-title">Interactive Rebase</span>
          <span class="rb-base">base：<code>{{ dialog.baseLabel || dialog.baseRef.slice(0, 7) }}</code></span>
          <button class="rb-close" :disabled="dialog.pending" @click="close">✕</button>
        </div>

        <div class="rb-body">
          <div v-if="dialog.loadingPreview" class="rb-loading">加载 commit 列表…</div>

          <div
            v-else-if="dialog.errorMessage && dialog.todos.length === 0"
            class="rb-error"
          >
            {{ dialog.errorMessage }}
          </div>

          <template v-else>
            <div class="rb-hint">
              共 {{ dialog.todos.length }} 个 commit，将产生 {{ effectiveCount() }} 个（drop {{ dropCount() }} 个）。从上到下按时间正序，可上下调整顺序。
            </div>

            <div class="rb-table">
              <div class="rb-row rb-row--head">
                <div class="rb-col-order">序</div>
                <div class="rb-col-move">移</div>
                <div class="rb-col-action">Action</div>
                <div class="rb-col-hash">Hash</div>
                <div class="rb-col-subject">Subject / 新消息</div>
              </div>

              <div
                v-for="(t, i) in dialog.todos"
                :key="t.commitId"
                class="rb-row"
                :class="{ 'rb-row--drop': t.action === 'drop' }"
              >
                <div class="rb-col-order">{{ i + 1 }}</div>
                <div class="rb-col-move">
                  <button
                    class="rb-move-btn"
                    title="上移"
                    :disabled="i === 0 || dialog.pending"
                    @click="rebaseStore.moveUp(i)"
                  >
                    ▲
                  </button>
                  <button
                    class="rb-move-btn"
                    title="下移"
                    :disabled="i === dialog.todos.length - 1 || dialog.pending"
                    @click="rebaseStore.moveDown(i)"
                  >
                    ▼
                  </button>
                </div>
                <div class="rb-col-action">
                  <select
                    :value="t.action"
                    :class="actionClass(t.action)"
                    :disabled="dialog.pending"
                    :title="actions.find((a) => a.value === t.action)?.desc"
                    @change="onActionChange(i, ($event.target as HTMLSelectElement).value as RebaseAction)"
                  >
                    <option
                      v-for="a in actions"
                      :key="a.value"
                      :value="a.value"
                      :disabled="(a.value === 'squash' || a.value === 'fixup') && !canSquashAt(i)"
                    >
                      {{ a.label }}
                    </option>
                  </select>
                </div>
                <div class="rb-col-hash">
                  <code>{{ t.shortId }}</code>
                </div>
                <div class="rb-col-subject">
                  <textarea
                    v-if="t.action === 'reword'"
                    class="rb-reword-input"
                    :value="t.newMessage ?? t.subject"
                    :disabled="dialog.pending"
                    :placeholder="`新 message（默认沿用：${t.subject}）`"
                    rows="2"
                    @input="rebaseStore.updateTodo(i, { newMessage: ($event.target as HTMLTextAreaElement).value })"
                  ></textarea>
                  <span v-else class="rb-subject" :title="t.subject">{{ t.subject }}</span>
                </div>
              </div>
            </div>

            <div v-if="dialog.errorMessage" class="rb-error rb-error--inline">
              {{ dialog.errorMessage }}
            </div>
          </template>
        </div>

        <div class="rb-footer">
          <div class="rb-footer-info">
            提示：reword/squash/fixup 不会打开外部编辑器；新消息已在表格内编辑。
          </div>
          <button class="rb-btn" :disabled="dialog.pending" @click="close">取消</button>
          <button
            class="rb-btn rb-btn--primary"
            :disabled="dialog.pending || dialog.loadingPreview || dialog.todos.length === 0"
            @click="startRebase"
          >
            {{ dialog.pending ? "执行中…" : "开始 Rebase" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rb-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rb-panel {
  width: 760px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
}

.rb-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  color: var(--color-foreground);
}

.rb-title {
  font-weight: 600;
}

.rb-base {
  flex: 1;
  font-size: 12px;
  color: var(--color-foreground-muted);
}

.rb-base code {
  background: var(--color-surface-hover);
  padding: 1px 6px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
}

.rb-close {
  background: none;
  border: none;
  color: var(--color-foreground-muted);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
}

.rb-close:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.rb-close:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rb-body {
  padding: 12px 14px;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rb-hint {
  font-size: 11px;
  color: var(--color-foreground-muted);
  line-height: 1.5;
}

.rb-loading {
  text-align: center;
  font-size: 12px;
  color: var(--color-foreground-muted);
  padding: 30px 0;
}

.rb-error {
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 4px;
  background: rgba(220, 50, 50, 0.12);
  border: 1px solid rgba(220, 50, 50, 0.4);
  color: #c04040;
  user-select: text;
}

.rb-error--inline {
  margin-top: 6px;
}

.rb-table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  overflow: hidden;
}

.rb-row {
  display: grid;
  grid-template-columns: 30px 50px 110px 80px 1fr;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  min-height: 32px;
}

.rb-row:last-child {
  border-bottom: none;
}

.rb-row--head {
  background: var(--color-surface-hover);
  font-weight: 600;
  color: var(--color-foreground);
  min-height: 26px;
}

.rb-row--drop {
  opacity: 0.55;
  text-decoration: line-through;
}

.rb-col-order {
  text-align: center;
  color: var(--color-foreground-muted);
  font-family: var(--font-mono, monospace);
}

.rb-col-move {
  display: flex;
  gap: 2px;
}

.rb-move-btn {
  width: 22px;
  height: 22px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-foreground-muted);
  border-radius: 3px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  padding: 0;
}

.rb-move-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.rb-move-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rb-col-action select {
  width: 100%;
  padding: 3px 4px;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  background: var(--color-surface);
  color: var(--color-foreground);
  font-size: 12px;
  cursor: pointer;
}

.rb-col-action .act--pick { color: var(--color-foreground); }
.rb-col-action .act--reword { color: #1f7ad6; font-weight: 600; }
.rb-col-action .act--squash { color: #b06a00; font-weight: 600; }
.rb-col-action .act--fixup { color: #8c5a00; font-weight: 600; }
.rb-col-action .act--edit { color: #6a3aa3; font-weight: 600; }
.rb-col-action .act--drop { color: #b03030; font-weight: 600; }

.rb-col-hash code {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  background: var(--color-surface-hover);
  padding: 1px 4px;
  border-radius: 2px;
}

.rb-col-subject {
  overflow: hidden;
}

.rb-subject {
  display: inline-block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  user-select: text;
}

.rb-reword-input {
  width: 100%;
  font-family: inherit;
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid var(--color-primary, #007acc);
  border-radius: 3px;
  background: var(--color-surface);
  color: var(--color-foreground);
  resize: vertical;
  min-height: 36px;
  box-sizing: border-box;
}

.rb-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
}

.rb-footer-info {
  flex: 1;
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.rb-btn {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-foreground);
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.rb-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.rb-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rb-btn--primary {
  background: var(--color-primary, #007acc);
  color: #fff;
  border-color: var(--color-primary, #007acc);
}

.rb-btn--primary:hover:not(:disabled) {
  filter: brightness(1.1);
}
</style>
