<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  visible: boolean;
  branchName: string;
  dirtyFiles: string[];
  pending?: boolean;
  resultMessage?: string;
  resultKind?: "ok" | "err" | null;
}>();

const emit = defineEmits<{
  (e: "choose", choice: "smart" | "force" | "cancel"): void;
}>();

const displayFiles = computed(() => props.dirtyFiles.slice(0, 30));
const overflowCount = computed(() => Math.max(0, props.dirtyFiles.length - displayFiles.value.length));

function pick(c: "smart" | "force" | "cancel"): void {
  if (props.pending) return;
  emit("choose", c);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="co-overlay" @click.self="pick('cancel')">
      <div class="co-panel" @keydown.esc="pick('cancel')">
        <div class="co-header">
          <span>切换分支 — 检测到本地未提交修改</span>
          <button class="co-close" :disabled="pending" title="取消" @click="pick('cancel')">✕</button>
        </div>

        <div class="co-body">
          <div class="co-target">
            目标分支：<code>{{ branchName }}</code>
          </div>

          <div class="co-files-header">
            本地有 {{ dirtyFiles.length }} 个文件未提交：
          </div>
          <ul class="co-files">
            <li v-for="f in displayFiles" :key="f" :title="f">{{ f }}</li>
            <li v-if="overflowCount > 0" class="co-files-more">…还有 {{ overflowCount }} 个</li>
          </ul>

          <div v-if="resultMessage" class="co-result" :class="resultKind === 'err' ? 'co-result--err' : 'co-result--ok'">
            {{ resultMessage }}
          </div>

          <div class="co-options">
            <button class="co-opt co-opt--primary" :disabled="pending" @click="pick('smart')">
              <div class="co-opt-title">Smart Checkout（推荐）</div>
              <div class="co-opt-desc">先 stash → 切到 <code>{{ branchName }}</code> → 自动恢复修改。stash pop 冲突时会提示。</div>
            </button>
            <button class="co-opt co-opt--danger" :disabled="pending" @click="pick('force')">
              <div class="co-opt-title">Force Checkout（丢弃本地修改）</div>
              <div class="co-opt-desc"><code>git checkout -f</code>：未提交修改将<strong>永久丢失</strong>，untracked 文件不受影响。</div>
            </button>
            <button class="co-opt co-opt--ghost" :disabled="pending" @click="pick('cancel')">
              <div class="co-opt-title">取消切换</div>
              <div class="co-opt-desc">什么都不做、留在当前分支。</div>
            </button>
          </div>

          <div v-if="pending" class="co-pending">正在执行…</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.co-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.co-panel {
  width: 520px;
  max-width: calc(100vw - 40px);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
}

.co-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-foreground);
}

.co-header span {
  flex: 1;
}

.co-close {
  background: none;
  border: none;
  color: var(--color-foreground-muted);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
}

.co-close:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.co-close:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.co-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.co-target {
  font-size: 13px;
  color: var(--color-foreground);
}

.co-target code {
  background: var(--color-surface-hover);
  padding: 1px 6px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}

.co-files-header {
  font-size: 12px;
  color: var(--color-foreground-muted);
  margin-top: 4px;
}

.co-files {
  list-style: none;
  margin: 0;
  padding: 6px 10px;
  max-height: 140px;
  overflow-y: auto;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.co-files li {
  padding: 1px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: text;
}

.co-files-more {
  font-style: italic;
  opacity: 0.7;
}

.co-result {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  user-select: text;
}

.co-result--ok {
  background: rgba(0, 122, 51, 0.12);
  border: 1px solid rgba(0, 122, 51, 0.4);
  color: #2a8a4a;
}

.co-result--err {
  background: rgba(220, 50, 50, 0.12);
  border: 1px solid rgba(220, 50, 50, 0.4);
  color: #c04040;
}

.co-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.co-opt {
  text-align: left;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-foreground);
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.12s;
}

.co-opt:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.co-opt:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.co-opt-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 2px;
}

.co-opt-desc {
  font-size: 11px;
  color: var(--color-foreground-muted);
  line-height: 1.4;
}

.co-opt-desc code {
  background: var(--color-surface-hover);
  padding: 0 4px;
  border-radius: 2px;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}

.co-opt--primary {
  border-color: var(--color-primary, #007acc);
}

.co-opt--primary .co-opt-title {
  color: var(--color-primary, #007acc);
}

.co-opt--danger {
  border-color: rgba(220, 50, 50, 0.5);
}

.co-opt--danger .co-opt-title {
  color: #c04040;
}

.co-pending {
  text-align: center;
  font-size: 12px;
  color: var(--color-foreground-muted);
  padding-top: 4px;
}
</style>
