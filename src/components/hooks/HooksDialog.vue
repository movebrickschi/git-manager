<script setup lang="ts">
/**
 * Git Hooks 管理弹窗 · 列出 / 启用 / 禁用 / 编辑 .git/hooks
 *
 * 状态约定（与 server/services/hooks.service.ts 对齐）：
 *  - enabled：.git/hooks/<name> 存在
 *  - disabled：.git/hooks/<name>.disabled 存在（重命名保留，便于恢复）
 *  - sample-only：仅有 git 自带的 <name>.sample 模板
 *  - missing：三者都没有
 *
 * 用法：在 SystemSettingsDialog 用 v-model:visible 控制显示。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { commands } from "@/utils/commands";
import type { HookInfo } from "@/utils/types";
import { errText } from "@/utils/error";
import { useRepoChangeEvents } from "@/composables/useRepoWatcher";

const props = defineProps<{ visible: boolean; repoPath: string }>();
const emit = defineEmits<{ (e: "update:visible", v: boolean): void }>();

const list = ref<HookInfo[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// 编辑态
const editingHook = ref<string | null>(null);
const editContent = ref("");
const editBusy = ref(false);
const editError = ref<string | null>(null);
let reloadSeq = 0;
let editLoadSeq = 0;

const DEFAULT_TEMPLATE =
  "#!/bin/sh\n# Git Manager 创建的 hook\n# 退出码非 0 会中止对应的 git 操作\n\nexit 0\n";

const STATE_LABEL: Record<HookInfo["state"], string> = {
  enabled: "已启用",
  disabled: "已禁用",
  "sample-only": "仅模板",
  missing: "未创建",
};

async function reload() {
  if (!props.visible || !props.repoPath) return;
  const repoPath = props.repoPath;
  const seq = ++reloadSeq;
  loading.value = true;
  error.value = null;
  try {
    const next = await commands.listHooks(repoPath);
    if (seq === reloadSeq && props.visible && props.repoPath === repoPath) list.value = next;
  } catch (e) {
    if (seq === reloadSeq) error.value = errText(e);
  } finally {
    if (seq === reloadSeq) loading.value = false;
  }
}

async function handleEnable(h: HookInfo) {
  try {
    await commands.enableHook(props.repoPath, h.name);
    await reload();
  } catch (e) {
    error.value = errText(e);
  }
}

async function handleDisable(h: HookInfo) {
  try {
    await commands.disableHook(props.repoPath, h.name);
    await reload();
  } catch (e) {
    error.value = errText(e);
  }
}

async function openEditor(h: HookInfo) {
  const repoPath = props.repoPath;
  const seq = ++editLoadSeq;
  editBusy.value = false;
  editingHook.value = h.name;
  editError.value = null;
  if (h.state === "missing") {
    editContent.value = DEFAULT_TEMPLATE;
    return;
  }
  editBusy.value = true;
  editContent.value = "";
  try {
    const content = await commands.readHookContent(repoPath, h.name);
    if (
      seq === editLoadSeq &&
      props.repoPath === repoPath &&
      editingHook.value === h.name
    ) {
      editContent.value = content;
    }
  } catch (e) {
    if (seq === editLoadSeq) {
      editError.value = errText(e);
      editContent.value = DEFAULT_TEMPLATE;
    }
  } finally {
    if (seq === editLoadSeq) editBusy.value = false;
  }
}

async function saveEditor() {
  if (!editingHook.value) return;
  editLoadSeq += 1;
  editBusy.value = true;
  editError.value = null;
  try {
    await commands.writeHookContent(props.repoPath, editingHook.value, editContent.value);
    editingHook.value = null;
    await reload();
  } catch (e) {
    editError.value = errText(e);
  } finally {
    editBusy.value = false;
  }
}

function cancelEditor() {
  editLoadSeq += 1;
  editingHook.value = null;
  editBusy.value = false;
  editError.value = null;
}

function close() {
  emit("update:visible", false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape" || !props.visible) return;
  e.preventDefault();
  if (editingHook.value) cancelEditor();
  else close();
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      window.addEventListener("keydown", onKeydown);
      void reload();
    } else {
      window.removeEventListener("keydown", onKeydown);
      editingHook.value = null;
    }
  },
  { immediate: true }
);

watch(
  () => props.repoPath,
  () => {
    reloadSeq += 1;
    editLoadSeq += 1;
    list.value = [];
    loading.value = false;
    error.value = null;
    editingHook.value = null;
    editContent.value = "";
    editError.value = null;
    if (props.visible) void reload();
  }
);

useRepoChangeEvents({
  repoPath: () => props.repoPath,
  kinds: ["config", "hooks"],
  onEvent: () => {
    if (!props.visible) return;
    // 只刷新列表，不覆盖正在编辑的 editContent。
    void reload();
  },
});

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

const empty = computed(() => !loading.value && list.value.length === 0 && !error.value);
</script>

<template>
  <Teleport to="body">
    <div v-if="props.visible" class="hk-mask" @click.self="close">
      <div class="hk-dialog" role="dialog" aria-label="Git 钩子管理">
        <header class="hk-header">
          <span class="hk-title">Git 钩子</span>
          <div class="hk-actions">
            <button class="hk-btn" @click="reload">刷新</button>
            <button class="hk-close" @click="close" title="关闭 (Esc)">✕</button>
          </div>
        </header>

        <div class="hk-body">
          <div v-if="loading" class="hk-empty">加载中…</div>
          <div v-else-if="error" class="hk-error">{{ error }}</div>
          <div v-else-if="empty" class="hk-empty">没有可显示的钩子。</div>
          <table v-else class="hk-table">
            <thead>
              <tr>
                <th>钩子</th>
                <th>状态</th>
                <th>大小</th>
                <th class="hk-col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in list" :key="h.name">
                <td class="hk-name">{{ h.name }}</td>
                <td>
                  <span class="badge" :class="`badge-${h.state}`">{{ STATE_LABEL[h.state] }}</span>
                </td>
                <td class="hk-size">{{ h.size != null ? `${h.size} B` : "-" }}</td>
                <td class="hk-col-actions">
                  <button
                    v-if="h.state === 'disabled'"
                    class="hk-btn small"
                    @click="handleEnable(h)"
                  >
                    启用
                  </button>
                  <button
                    v-if="h.state === 'enabled'"
                    class="hk-btn small"
                    @click="handleDisable(h)"
                  >
                    禁用
                  </button>
                  <button class="hk-btn small" @click="openEditor(h)">
                    {{ h.state === "missing" ? "创建…" : "编辑…" }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="editingHook" class="hk-editor">
          <div class="hk-editor-head">
            <span>编辑 <code>{{ editingHook }}</code></span>
            <div class="hk-editor-actions">
              <button class="hk-btn small" :disabled="editBusy" @click="cancelEditor">取消</button>
              <button class="hk-btn small primary" :disabled="editBusy" @click="saveEditor">
                {{ editBusy ? "保存中…" : "保存并启用" }}
              </button>
            </div>
          </div>
          <p v-if="editError" class="hk-error">{{ editError }}</p>
          <textarea
            v-model="editContent"
            class="hk-textarea"
            spellcheck="false"
            placeholder="#!/bin/sh ..."
            :disabled="editBusy"
          />
          <p class="hk-tip">
            保存后写入 <code>.git/hooks/{{ editingHook }}</code> 并设为启用（POSIX 下置可执行位）。
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.hk-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8700;
}

.hk-dialog {
  width: min(820px, 94vw);
  max-height: 88vh;
  background: var(--color-surface-raised);
  color: var(--color-foreground);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg, 10px);
  box-shadow: var(--shadow-overlay);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.hk-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  background: var(--color-surface-emphasis);
}

.hk-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-foreground-bright);
}

.hk-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.hk-btn {
  padding: 4px 10px;
  font-size: 12px;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
}

.hk-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.hk-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.hk-btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.hk-btn.small {
  padding: 2px 8px;
  font-size: 11px;
  margin-right: 4px;
}

.hk-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hk-close {
  background: transparent;
  border: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm, 4px);
}

.hk-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.hk-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 18px;
  min-height: 120px;
}

.hk-empty,
.hk-error {
  padding: 24px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 13px;
}

.hk-error {
  color: var(--color-error);
}

.hk-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.hk-table thead {
  border-bottom: 1px solid var(--color-divider);
}

.hk-table th {
  padding: 8px 6px;
  text-align: left;
  font-weight: 600;
  color: var(--color-foreground-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.hk-table td {
  padding: 7px 6px;
}

.hk-table tbody tr {
  transition: background var(--transition-fast);
}

.hk-table tbody tr:hover {
  background: var(--color-surface-hover);
}

.hk-name {
  font-family: var(--font-mono);
  font-size: 12px;
}

.hk-size {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.hk-col-actions {
  width: 200px;
  white-space: nowrap;
  text-align: right;
}

.badge {
  display: inline-block;
  padding: 1px 8px;
  font-size: 10px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.badge-enabled {
  background: var(--color-success);
  color: white;
}

.badge-disabled {
  background: var(--color-warning);
  color: white;
}

.badge-sample-only {
  background: var(--color-info);
  color: white;
}

.badge-missing {
  background: var(--color-surface-active);
  color: var(--color-foreground-muted);
}

.hk-editor {
  border-top: 1px solid var(--color-divider);
  background: var(--color-surface-muted);
  padding: 12px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hk-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--color-foreground);
}

.hk-editor-actions {
  display: flex;
  gap: 6px;
}

.hk-textarea {
  width: 100%;
  min-height: 200px;
  resize: vertical;
  background: var(--color-surface);
  color: var(--color-foreground);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm, 4px);
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.5;
}

.hk-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.hk-tip {
  margin: 0;
  font-size: 11px;
  color: var(--color-foreground-muted);
}

code {
  font-family: var(--font-mono);
  background: var(--color-surface-active);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
