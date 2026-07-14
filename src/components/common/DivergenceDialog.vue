<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  visible: boolean;
  behind: number;
  ahead: number;
  remote: string;
  branch: string;
}>();

const emit = defineEmits<{
  rebase: [];
  merge: [];
  force: [];
  cancel: [];
}>();

const destination = computed(() => `${props.remote}/${props.branch}`);
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="divergence-overlay" @click.self="emit('cancel')">
      <div class="divergence-dialog">
        <div class="divergence-header">
          <svg
            class="warn-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span class="divergence-title">远程分支有新提交</span>
        </div>

        <div class="divergence-body">
          <p class="divergence-desc">
            <code>{{ destination }}</code> 有
            <strong>{{ behind }}</strong> 个新提交未同步到本地。
            直接推送会失败，请先同步远程更新。
          </p>

          <div class="divergence-stats">
            <div class="stat-item stat-ahead">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
              <span>本地领先 {{ ahead }} 个提交</span>
            </div>
            <div class="stat-item stat-behind">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
              <span>远程领先 {{ behind }} 个提交</span>
            </div>
          </div>
        </div>

        <div class="divergence-actions">
          <button class="dv-btn dv-btn-primary" @click="emit('rebase')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <path d="M6 21V9a9 9 0 0 0 9 9" />
            </svg>
            拉取并变基 (Rebase)
            <span class="btn-hint">推荐</span>
          </button>

          <button class="dv-btn" @click="emit('merge')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <path d="M6 21V9a9 9 0 0 1 9 9" />
            </svg>
            拉取并合并 (Merge)
          </button>

          <button class="dv-btn dv-btn-danger" @click="emit('force')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            强制推送 (--force-with-lease)
          </button>

          <button class="dv-btn dv-btn-cancel" @click="emit('cancel')">
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.divergence-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.divergence-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  width: 420px;
  max-width: 90vw;
  overflow: hidden;
}

.divergence-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  background: var(--color-surface-emphasis);
}

.warn-icon {
  color: #e8a838;
  flex-shrink: 0;
}

.divergence-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-foreground);
}

.divergence-body {
  padding: 16px 18px;
}

.divergence-desc {
  font-size: 13px;
  color: var(--color-foreground);
  line-height: 1.6;
  margin: 0 0 14px 0;
}

.divergence-desc code {
  background: var(--color-surface-hover);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  font-family: var(--font-mono);
}

.divergence-stats {
  display: flex;
  gap: 16px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 4px;
}

.stat-ahead {
  color: #5aba5a;
  background: color-mix(in srgb, #2d9a2d 12%, transparent);
}

.stat-behind {
  color: #e8a838;
  background: color-mix(in srgb, #e8a838 12%, transparent);
}

.divergence-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 18px 18px;
}

.dv-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--color-border);
  background: var(--color-surface-hover);
  color: var(--color-foreground);
  transition: background 0.15s, border-color 0.15s;
}

.dv-btn:hover {
  background: var(--color-surface-active);
}

.dv-btn-primary {
  background: color-mix(in srgb, var(--color-primary, #4a9eff) 18%, var(--color-surface));
  border-color: color-mix(in srgb, var(--color-primary, #4a9eff) 50%, transparent);
  color: var(--color-primary, #4a9eff);
}

.dv-btn-primary:hover {
  background: color-mix(in srgb, var(--color-primary, #4a9eff) 28%, var(--color-surface));
}

.btn-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-primary, #4a9eff);
  opacity: 0.8;
}

.dv-btn-danger {
  color: var(--color-error, #e05252);
  border-color: color-mix(in srgb, var(--color-error, #e05252) 30%, transparent);
}

.dv-btn-danger:hover {
  background: color-mix(in srgb, var(--color-error, #e05252) 12%, var(--color-surface));
}

.dv-btn-cancel {
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--color-foreground-muted);
  font-weight: 400;
}

.dv-btn-cancel:hover {
  color: var(--color-foreground);
  background: var(--color-surface-hover);
}
</style>
