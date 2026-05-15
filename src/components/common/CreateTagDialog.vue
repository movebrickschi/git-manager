<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from "vue";

const props = defineProps<{
  visible: boolean;
  /** 创建在哪个 commit 上；不传 = HEAD */
  targetCommitId?: string;
  /** 顶部小字提示，例如「HEAD」「a1b2c3d (refactor: ...)」 */
  targetLabel?: string;
}>();

const emit = defineEmits<{
  (
    e: "confirm",
    payload: { name: string; message: string; annotated: boolean; pushAfter: boolean }
  ): void;
  (e: "cancel"): void;
}>();

const tagName = ref("");
const message = ref("");
const annotated = ref(true);
const pushAfter = ref(false);
const nameInputRef = ref<HTMLInputElement | null>(null);

// 简单 git tag 名校验：禁空白 / 禁 `..`、`@{`、`?`、`*`、`[`、控制字符
const TAG_NAME_PATTERN = /^(?!.*\.\.)(?!.*@\{)[\w\-./]+$/;
const validName = computed(() => TAG_NAME_PATTERN.test(tagName.value.trim()));

const canSubmit = computed(
  () => tagName.value.trim().length > 0 && validName.value && (!annotated.value || true)
);

function reset(): void {
  tagName.value = "";
  message.value = "";
  annotated.value = true;
  pushAfter.value = false;
}

function onConfirm(): void {
  if (!canSubmit.value) return;
  emit("confirm", {
    name: tagName.value.trim(),
    message: annotated.value ? message.value.trim() : "",
    annotated: annotated.value,
    pushAfter: pushAfter.value,
  });
}

function onCancel(): void {
  emit("cancel");
}

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      reset();
      await nextTick();
      nameInputRef.value?.focus();
    }
  }
);

onMounted(() => {
  if (props.visible) {
    nextTick(() => nameInputRef.value?.focus());
  }
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="tag-dialog-overlay" @click.self="onCancel">
      <div class="tag-dialog-panel" @keydown.esc="onCancel">
        <div class="tag-dialog-header">
          <span>创建标签</span>
          <button class="tag-dialog-close" :title="'取消'" @click="onCancel">✕</button>
        </div>

        <div class="tag-dialog-body">
          <div class="form-row">
            <label class="form-label" for="tag-name">标签名 <span class="required">*</span></label>
            <input
              id="tag-name"
              ref="nameInputRef"
              v-model="tagName"
              type="text"
              class="form-input"
              placeholder="例如 v1.0.0 / release-2026Q2"
              :class="{ invalid: tagName.length > 0 && !validName }"
              autocomplete="off"
              spellcheck="false"
              @keydown.enter.prevent="onConfirm"
            />
            <div
              v-if="tagName.length > 0 && !validName"
              class="form-hint form-hint--error"
            >
              名称非法：禁空白 / `..` / `@{` / `*` / `?` / `[`
            </div>
          </div>

          <div class="form-row">
            <label class="form-label">目标提交</label>
            <div class="form-target">
              {{ targetLabel || (targetCommitId ? targetCommitId.slice(0, 8) : "HEAD") }}
            </div>
          </div>

          <div class="form-row form-row--inline">
            <label class="form-checkbox-label">
              <input v-model="annotated" type="checkbox" class="form-checkbox" />
              <span>Annotated（包含描述、标签者、时间，推荐发版用）</span>
            </label>
          </div>

          <div v-if="annotated" class="form-row">
            <label class="form-label" for="tag-message">描述（annotated tag 的 commit 消息）</label>
            <textarea
              id="tag-message"
              v-model="message"
              class="form-textarea"
              rows="3"
              placeholder="例如：Release 1.0.0 — Smart Pull + Tag CRUD + Force-push lease"
            />
          </div>

          <div class="form-row form-row--inline">
            <label class="form-checkbox-label">
              <input v-model="pushAfter" type="checkbox" class="form-checkbox" />
              <span>创建后立即推送到默认远端</span>
            </label>
          </div>
        </div>

        <div class="tag-dialog-footer">
          <button class="btn btn-ghost" @click="onCancel">取消</button>
          <button
            class="btn btn-primary"
            :disabled="!canSubmit"
            :title="canSubmit ? '创建标签' : '请填写合法的标签名'"
            @click="onConfirm"
          >
            {{ pushAfter ? "创建并推送" : "创建" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tag-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tag-dialog-panel {
  width: 480px;
  max-width: calc(100vw - 40px);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
}

.tag-dialog-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-foreground);
}

.tag-dialog-header span {
  flex: 1;
}

.tag-dialog-close {
  background: none;
  border: none;
  color: var(--color-foreground-muted);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
}

.tag-dialog-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.tag-dialog-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.form-row--inline {
  flex-direction: row;
  align-items: center;
}

.form-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-foreground-muted);
}

.required {
  color: var(--color-error, #e05252);
}

.form-input,
.form-textarea {
  padding: 5px 8px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-foreground);
  font-size: 12px;
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--color-primary, #2196f3);
}

.form-input.invalid {
  border-color: var(--color-error, #e05252);
}

.form-textarea {
  resize: vertical;
  min-height: 60px;
  font-family: var(--font-mono);
}

.form-target {
  padding: 5px 8px;
  background: var(--color-surface-active);
  border: 1px dashed var(--color-border);
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-foreground-muted);
}

.form-hint {
  font-size: 10px;
  color: var(--color-foreground-muted);
}

.form-hint--error {
  color: var(--color-error, #e05252);
}

.form-checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-foreground);
  cursor: pointer;
}

.form-checkbox {
  width: 12px;
  height: 12px;
  accent-color: var(--color-primary);
}

.tag-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
}

.btn {
  padding: 5px 14px;
  border-radius: 3px;
  font-size: 12px;
  border: 1px solid transparent;
  cursor: pointer;
}

.btn-ghost {
  background: transparent;
  color: var(--color-foreground-muted);
  border-color: var(--color-border);
}

.btn-ghost:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.btn-primary {
  background: var(--color-primary, #2196f3);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover, #1976d2);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
