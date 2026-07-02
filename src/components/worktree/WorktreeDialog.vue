<script setup lang="ts">
/**
 * Worktree 管理弹窗 · IDEA "Git Worktree" 同款 MVP
 *
 * 功能：
 *  - 列表显示所有 worktree（含主 + 附加）
 *  - 新建 worktree（输入路径 + 可选分支/新分支）
 *  - 删除 worktree（force 可选）
 *  - lock / unlock
 *  - prune（清理失效记录）
 *
 * 不实现的（留给后续）：
 *  - 在新 worktree 中打开 Git Manager 新窗口（依赖 D3 多窗口支持）
 *  - 工作树移动 / 重命名（git worktree move）
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { commands } from "@/utils/commands";
import type { WorktreeInfo } from "@/utils/types";
import { errText } from "@/utils/error";

const props = defineProps<{
  visible: boolean;
  repoPath: string;
}>();

const emit = defineEmits<{ (e: "update:visible", v: boolean): void }>();

const list = ref<WorktreeInfo[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const showAddForm = ref(false);
const addTarget = ref("");
const addBranch = ref("");
const addNewBranch = ref("");
const addBusy = ref(false);

async function reload() {
  if (!props.visible || !props.repoPath) return;
  loading.value = true;
  error.value = null;
  try {
    list.value = await commands.listWorktrees(props.repoPath);
  } catch (e) {
    error.value = errText(e);
  } finally {
    loading.value = false;
  }
}

async function handleAdd() {
  if (!addTarget.value.trim()) return;
  addBusy.value = true;
  try {
    await commands.addWorktree(
      props.repoPath,
      addTarget.value.trim(),
      addBranch.value.trim() || undefined,
      addNewBranch.value.trim() || undefined
    );
    addTarget.value = "";
    addBranch.value = "";
    addNewBranch.value = "";
    showAddForm.value = false;
    await reload();
  } catch (e) {
    error.value = errText(e);
  } finally {
    addBusy.value = false;
  }
}

async function handleRemove(wt: WorktreeInfo, force = false) {
  if (wt.main) return; // 主工作树不能删
  if (!confirm(`确认删除 worktree：${wt.path}${force ? "（强制）" : ""}？`)) return;
  try {
    await commands.removeWorktree(props.repoPath, wt.path, force);
    await reload();
  } catch (e) {
    error.value = errText(e);
  }
}

async function handleLockToggle(wt: WorktreeInfo) {
  try {
    if (wt.locked) await commands.unlockWorktree(props.repoPath, wt.path);
    else await commands.lockWorktree(props.repoPath, wt.path);
    await reload();
  } catch (e) {
    error.value = errText(e);
  }
}

async function handlePrune() {
  if (!confirm("将清理 worktree 元数据中失效的记录（git worktree prune）。继续？")) return;
  try {
    await commands.pruneWorktrees(props.repoPath);
    await reload();
  } catch (e) {
    error.value = errText(e);
  }
}

function close() {
  emit("update:visible", false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.visible) {
    e.preventDefault();
    close();
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      window.addEventListener("keydown", onKeydown);
      void reload();
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

const empty = computed(() => !loading.value && list.value.length === 0 && !error.value);
</script>

<template>
  <Teleport to="body">
    <div v-if="props.visible" class="wt-mask" @click.self="close">
      <div class="wt-dialog" role="dialog" aria-label="Git Worktree 管理">
        <header class="wt-header">
          <span class="wt-title">工作树</span>
          <div class="wt-actions">
            <button class="wt-btn" @click="showAddForm = !showAddForm">
              {{ showAddForm ? "取消新建" : "+ 新建 Worktree" }}
            </button>
            <button class="wt-btn" @click="handlePrune">清理失效</button>
            <button class="wt-btn" @click="reload">刷新</button>
            <button class="wt-close" @click="close">✕</button>
          </div>
        </header>

        <div v-if="showAddForm" class="wt-add-form">
          <div class="wt-form-row">
            <label>目标路径</label>
            <input
              v-model="addTarget"
              placeholder="/abs/path/to/new/worktree（或相对路径）"
              :disabled="addBusy"
            />
          </div>
          <div class="wt-form-row">
            <label>使用现有分支或 sha</label>
            <input
              v-model="addBranch"
              placeholder="分支名 / commit sha（可空 = HEAD detached）"
              :disabled="addBusy"
            />
          </div>
          <div class="wt-form-row">
            <label>或新建分支</label>
            <input
              v-model="addNewBranch"
              placeholder="新分支名（与上一行二选一）"
              :disabled="addBusy"
            />
          </div>
          <div class="wt-form-actions">
            <button class="wt-btn primary" :disabled="!addTarget.trim() || addBusy" @click="handleAdd">
              {{ addBusy ? "创建中…" : "创建" }}
            </button>
          </div>
        </div>

        <div class="wt-body">
          <div v-if="loading" class="wt-empty">加载中…</div>
          <div v-else-if="error" class="wt-error">{{ error }}</div>
          <div v-else-if="empty" class="wt-empty">
            没有任何 worktree 记录。点击右上角"+ 新建 Worktree"创建一个。
          </div>
          <table v-else class="wt-table">
            <thead>
              <tr>
                <th>路径</th>
                <th>分支</th>
                <th>HEAD</th>
                <th>状态</th>
                <th class="wt-col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="wt in list" :key="wt.path">
                <td class="wt-path" :title="wt.path">{{ wt.path }}</td>
                <td>
                  <span v-if="wt.branch">{{ wt.branch }}</span>
                  <span v-else-if="wt.detached" class="muted">(detached)</span>
                  <span v-else-if="wt.bare" class="muted">(bare)</span>
                  <span v-else class="muted">-</span>
                </td>
                <td class="wt-sha">{{ wt.head?.substring(0, 7) || "" }}</td>
                <td>
                  <span v-if="wt.main" class="badge badge-main">主</span>
                  <span v-if="wt.locked" class="badge badge-locked">
                    locked{{ wt.lockReason ? `（${wt.lockReason}）` : "" }}
                  </span>
                  <span v-if="wt.detached && !wt.main" class="badge badge-detached">detached</span>
                </td>
                <td class="wt-col-actions">
                  <button
                    v-if="!wt.main"
                    class="wt-btn small"
                    :title="wt.locked ? '解锁' : '锁定（防误删）'"
                    @click="handleLockToggle(wt)"
                  >
                    {{ wt.locked ? "解锁" : "锁定" }}
                  </button>
                  <button
                    v-if="!wt.main"
                    class="wt-btn small danger"
                    @click="handleRemove(wt, false)"
                  >
                    删除
                  </button>
                  <button
                    v-if="!wt.main"
                    class="wt-btn small danger"
                    title="忽略 dirty / locked 强制删（小心）"
                    @click="handleRemove(wt, true)"
                  >
                    强制
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wt-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8700;
}

.wt-dialog {
  width: min(1100px, 95vw);
  max-height: 88vh;
  background: var(--color-surface);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg, 10px);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  background: var(--color-background);
  border-bottom: 1px solid var(--color-border);
}

.wt-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-foreground-bright);
}

.wt-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.wt-btn {
  padding: 4px 10px;
  font-size: 12px;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
}

.wt-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.wt-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.wt-btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.wt-btn.danger {
  color: var(--color-error);
  border-color: var(--color-error);
}

.wt-btn.danger:hover:not(:disabled) {
  background: var(--color-error);
  color: white;
}

.wt-btn.small {
  padding: 2px 8px;
  font-size: 11px;
  margin-right: 4px;
}

.wt-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wt-close {
  background: transparent;
  border: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm, 4px);
}

.wt-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.wt-add-form {
  padding: 12px 18px;
  background: var(--color-background);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wt-form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.wt-form-row label {
  width: 140px;
  color: var(--color-foreground-muted);
}

.wt-form-row input {
  flex: 1;
  background: var(--color-surface);
  color: var(--color-foreground);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm, 4px);
  padding: 4px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
}

.wt-form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.wt-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 18px;
}

.wt-empty,
.wt-error {
  padding: 24px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 13px;
}

.wt-error {
  color: var(--color-error);
}

.wt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.wt-table thead {
  border-bottom: 1px solid var(--color-border);
}

.wt-table th {
  padding: 8px 6px;
  text-align: left;
  font-weight: 600;
  color: var(--color-foreground-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.wt-table td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--color-border);
}

.wt-path {
  font-family: var(--font-mono);
  font-size: 11px;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wt-sha {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.wt-col-actions {
  width: 220px;
  white-space: nowrap;
  text-align: right;
}

.muted {
  color: var(--color-foreground-muted);
}

.badge {
  display: inline-block;
  padding: 1px 6px;
  font-size: 10px;
  border-radius: 3px;
  margin-right: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.badge-main {
  background: var(--color-success);
  color: white;
}

.badge-locked {
  background: var(--color-warning);
  color: white;
}

.badge-detached {
  background: var(--color-info);
  color: white;
}
</style>
