<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  visible: boolean;
  branchName: string;
  upstream: string | null;
  remoteCommitsAhead: number;
  dirtyFiles: string[];
  wouldConflict?: string[];
  safe?: string[];
  fetched?: boolean;
  pending?: boolean;
  resultMessage?: string;
  resultKind?: "ok" | "err" | null;
}>();

const emit = defineEmits<{
  (e: "choose", choice: "smart" | "force" | "cancel"): void;
}>();

const conflictList = computed(() => (props.wouldConflict ?? []).slice(0, 30));
const conflictOverflow = computed(() =>
  Math.max(0, (props.wouldConflict ?? []).length - conflictList.value.length)
);
const safeList = computed(() => (props.safe ?? []).slice(0, 30));
const safeOverflow = computed(() =>
  Math.max(0, (props.safe ?? []).length - safeList.value.length)
);
const hasConflict = computed(() => (props.wouldConflict ?? []).length > 0);
const upstreamLabel = computed(() => props.upstream ?? "(未配置 upstream)");

const showForceConfirm = ref(false);

watch(
  () => props.visible,
  (v) => {
    if (!v) showForceConfirm.value = false;
  }
);

function pick(c: "smart" | "force" | "cancel"): void {
  if (props.pending) return;
  if (c === "force" && !showForceConfirm.value) {
    showForceConfirm.value = true;
    return;
  }
  emit("choose", c);
}

function cancelForceConfirm(): void {
  showForceConfirm.value = false;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="pl-overlay" @click.self="pick('cancel')">
      <div class="pl-panel" @keydown.esc="pick('cancel')">
        <div class="pl-header">
          <span>拉取更新 — 检测到本地未提交修改</span>
          <button class="pl-close" :disabled="pending" title="取消" @click="pick('cancel')">
            ✕
          </button>
        </div>

        <div class="pl-body">
          <div class="pl-meta">
            <div class="pl-meta-row">
              <span class="pl-meta-label">当前分支</span>
              <code class="pl-meta-value">{{ branchName }}</code>
            </div>
            <div class="pl-meta-row">
              <span class="pl-meta-label">Upstream</span>
              <code class="pl-meta-value">{{ upstreamLabel }}</code>
            </div>
            <div class="pl-meta-row">
              <span class="pl-meta-label">Remote 比本地多</span>
              <span class="pl-meta-value">{{ remoteCommitsAhead }} 个提交</span>
            </div>
          </div>

          <div v-if="fetched === false" class="pl-warning pl-warning--soft">
            ⚠ Fetch 失败（网络 / 认证异常）：以下预测基于上次 fetch 的旧 remote tracking
            branch，实际 pull 时可能出现 preview 没列出的冲突。
          </div>

          <div v-if="hasConflict" class="pl-warning">
            ⚠ {{ wouldConflict!.length }} 个文件在本地和远端都改过 — Smart Pull 后 stash pop
            高概率冲突；Force Pull 会<strong>永久丢失</strong>本地这些文件的修改。
          </div>

          <div v-if="hasConflict" class="pl-section">
            <div class="pl-section-title pl-section-title--err">
              <span class="dot dot--err"></span>
              {{ wouldConflict!.length }} 个会冲突（双方都改过）
            </div>
            <ul class="pl-files pl-files--err">
              <li v-for="f in conflictList" :key="'c-' + f" :title="f">{{ f }}</li>
              <li v-if="conflictOverflow > 0" class="pl-files-more">
                …还有 {{ conflictOverflow }} 个
              </li>
            </ul>
          </div>

          <div v-if="(safe ?? []).length > 0" class="pl-section">
            <div class="pl-section-title pl-section-title--ok">
              <span class="dot dot--ok"></span>
              {{ safe!.length }} 个 Smart Pull 可安全保留
            </div>
            <ul class="pl-files pl-files--ok">
              <li v-for="f in safeList" :key="'s-' + f" :title="f">{{ f }}</li>
              <li v-if="safeOverflow > 0" class="pl-files-more">
                …还有 {{ safeOverflow }} 个
              </li>
            </ul>
          </div>

          <div
            v-if="resultMessage"
            class="pl-result"
            :class="resultKind === 'err' ? 'pl-result--err' : 'pl-result--ok'"
          >
            {{ resultMessage }}
          </div>

          <div v-if="!showForceConfirm" class="pl-options">
            <button class="pl-opt pl-opt--primary" :disabled="pending" @click="pick('smart')">
              <div class="pl-opt-title">Smart Pull（推荐）</div>
              <div class="pl-opt-desc">
                自动 stash 本地改动 → pull → 还原 stash。stash pop
                冲突时会提示并保留 stash@{0}，不会丢失任何数据。
              </div>
            </button>
            <button class="pl-opt pl-opt--danger" :disabled="pending" @click="pick('force')">
              <div class="pl-opt-title">Force Pull（丢弃本地修改）</div>
              <div class="pl-opt-desc">
                <code>git reset --hard HEAD</code> + <code>git clean -fd</code> +
                <code>git pull</code>：本地所有 staged / unstaged / untracked
                改动<strong>永久丢失</strong>，无法恢复。
              </div>
            </button>
            <button class="pl-opt pl-opt--ghost" :disabled="pending" @click="pick('cancel')">
              <div class="pl-opt-title">取消拉取</div>
              <div class="pl-opt-desc">什么都不做、保留当前工作区。</div>
            </button>
          </div>

          <div v-else class="pl-force-confirm">
            <div class="pl-force-title">⚠ 再次确认：丢弃本地全部未提交修改？</div>
            <div class="pl-force-desc">
              将影响 <strong>{{ dirtyFiles.length }}</strong> 个文件（staged + unstaged + untracked
              全部清空），<strong>不可撤销</strong>。如果有重要改动请先 Cancel 回去手动 stash /
              commit。
            </div>
            <div class="pl-force-actions">
              <button class="pl-btn pl-btn--ghost" :disabled="pending" @click="cancelForceConfirm">
                返回选项
              </button>
              <button class="pl-btn pl-btn--danger" :disabled="pending" @click="pick('force')">
                确认丢弃并 Pull
              </button>
            </div>
          </div>

          <div v-if="pending" class="pl-pending">正在执行…</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pl-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pl-panel {
  width: 560px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 80px);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pl-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-foreground);
  flex-shrink: 0;
}

.pl-header span {
  flex: 1;
}

.pl-close {
  background: none;
  border: none;
  color: var(--color-foreground-muted);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
}

.pl-close:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.pl-close:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pl-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.pl-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: var(--color-surface-hover);
  border-radius: 4px;
  font-size: 12px;
}

.pl-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pl-meta-label {
  color: var(--color-foreground-muted);
  min-width: 100px;
}

.pl-meta-value {
  color: var(--color-foreground);
  font-family: var(--font-mono, monospace);
}

code.pl-meta-value {
  background: var(--color-surface);
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
}

.pl-warning {
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 4px;
  background: rgba(220, 140, 30, 0.12);
  border: 1px solid rgba(220, 140, 30, 0.4);
  color: #b07015;
  line-height: 1.4;
}

.pl-warning--soft {
  background: rgba(100, 120, 200, 0.12);
  border-color: rgba(100, 120, 200, 0.4);
  color: #5a6db5;
}

.pl-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pl-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
}

.pl-section-title--err {
  color: #c04040;
}

.pl-section-title--ok {
  color: #2a8a4a;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.dot--err {
  background: #c04040;
}

.dot--ok {
  background: #2a8a4a;
}

.pl-files {
  list-style: none;
  margin: 0;
  padding: 6px 10px;
  max-height: 110px;
  overflow-y: auto;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.pl-files--err {
  border-color: rgba(220, 50, 50, 0.4);
}

.pl-files--ok {
  border-color: rgba(0, 122, 51, 0.4);
}

.pl-files li {
  padding: 1px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: text;
}

.pl-files-more {
  font-style: italic;
  opacity: 0.7;
}

.pl-result {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  user-select: text;
  line-height: 1.4;
}

.pl-result--ok {
  background: rgba(0, 122, 51, 0.12);
  border: 1px solid rgba(0, 122, 51, 0.4);
  color: #2a8a4a;
}

.pl-result--err {
  background: rgba(220, 50, 50, 0.12);
  border: 1px solid rgba(220, 50, 50, 0.4);
  color: #c04040;
}

.pl-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.pl-opt {
  text-align: left;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-foreground);
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.12s;
}

.pl-opt:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.pl-opt:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pl-opt-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 2px;
}

.pl-opt-desc {
  font-size: 11px;
  color: var(--color-foreground-muted);
  line-height: 1.4;
}

.pl-opt-desc code {
  background: var(--color-surface-hover);
  padding: 0 4px;
  border-radius: 2px;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}

.pl-opt--primary {
  border-color: var(--color-primary, #007acc);
}

.pl-opt--primary .pl-opt-title {
  color: var(--color-primary, #007acc);
}

.pl-opt--danger {
  border-color: rgba(220, 50, 50, 0.5);
}

.pl-opt--danger .pl-opt-title {
  color: #c04040;
}

.pl-force-confirm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(220, 50, 50, 0.5);
  border-radius: 4px;
  background: rgba(220, 50, 50, 0.06);
}

.pl-force-title {
  font-size: 13px;
  font-weight: 600;
  color: #c04040;
}

.pl-force-desc {
  font-size: 12px;
  color: var(--color-foreground);
  line-height: 1.5;
}

.pl-force-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.pl-btn {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.pl-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pl-btn--ghost {
  background: var(--color-surface);
  color: var(--color-foreground);
}

.pl-btn--ghost:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.pl-btn--danger {
  background: #c04040;
  color: #fff;
  border-color: #c04040;
}

.pl-btn--danger:hover:not(:disabled) {
  background: #d04545;
}

.pl-pending {
  text-align: center;
  font-size: 12px;
  color: var(--color-foreground-muted);
  padding-top: 4px;
}
</style>
