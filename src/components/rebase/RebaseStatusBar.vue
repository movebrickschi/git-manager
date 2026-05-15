<script setup lang="ts">
/**
 * Rebase 半成态状态栏。
 *
 * 显示位置：MainLayout 内部、紧贴底部 statusBar 之上（仿 IDEA 的"Rebasing… [Continue][Abort]"提示条）。
 *
 * 何时显示：rebaseStore.hasRebaseInProgress === true。
 * 数据源：rebaseStore.status；进入半成态后由 store 启动 2s 轮询。
 *
 * 仅 Interactive Rebase（rebase-merge 模式）才有 done/total 进度；普通 rebase 的
 * rebase-apply 模式我们也支持但只能给出"进行中"提示（done/total = 0）。
 */
import { computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRebaseStore } from "@/stores/rebaseStore";

const rebaseStore = useRebaseStore();

const status = computed(() => rebaseStore.status);
const conflictCount = computed(() => status.value.conflictFiles.length);
const stepLabel = computed(() => {
  if (status.value.total > 0) {
    return `${status.value.done}/${status.value.total}`;
  }
  return "进行中";
});

onMounted(() => {
  void rebaseStore.refreshStatus();
  rebaseStore.startPolling();
});

onBeforeUnmount(() => {
  rebaseStore.stopPolling();
});

// rebase 结束后停轮询；用户开新 rebase 时再恢复
watch(
  () => rebaseStore.hasRebaseInProgress,
  (now) => {
    if (now) rebaseStore.startPolling();
    else rebaseStore.stopPolling();
  }
);

async function onContinue(): Promise<void> {
  await rebaseStore.continueRebase();
}

async function onAbort(): Promise<void> {
  await rebaseStore.abortRebase();
}
</script>

<template>
  <div v-if="status.inProgress" class="rb-status">
    <div class="rb-status-icon">⟳</div>
    <div class="rb-status-text">
      <div class="rb-status-title">
        Rebasing…
        <span class="rb-status-step">step {{ stepLabel }}</span>
        <span v-if="status.currentAction" class="rb-status-action">
          · 当前 action：<code>{{ status.currentAction }}</code>
        </span>
      </div>
      <div v-if="conflictCount > 0" class="rb-status-conflict">
        ⚠ {{ conflictCount }} 个文件冲突，请先解决再 Continue
      </div>
      <div v-else-if="status.currentAction === 'edit'" class="rb-status-hint">
        💡 已停在 edit 步骤，修改完文件后点 Continue
      </div>
    </div>
    <div class="rb-status-actions">
      <button class="rb-status-btn rb-status-btn--primary" @click="onContinue">
        Continue
      </button>
      <button class="rb-status-btn rb-status-btn--danger" @click="onAbort">
        Abort
      </button>
    </div>
  </div>
</template>

<style scoped>
.rb-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: rgba(220, 140, 30, 0.12);
  border-top: 1px solid rgba(220, 140, 30, 0.4);
  font-size: 12px;
  color: var(--color-foreground);
}

.rb-status-icon {
  font-size: 16px;
  color: #b07015;
  animation: rb-spin 2.4s linear infinite;
}

@keyframes rb-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.rb-status-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rb-status-title {
  font-weight: 600;
  color: #b07015;
}

.rb-status-step,
.rb-status-action {
  font-weight: normal;
  color: var(--color-foreground-muted);
  font-size: 11px;
  margin-left: 8px;
}

.rb-status-action code {
  background: var(--color-surface-hover);
  padding: 1px 4px;
  border-radius: 2px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.rb-status-conflict {
  font-size: 11px;
  color: #c04040;
}

.rb-status-hint {
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.rb-status-actions {
  display: flex;
  gap: 6px;
}

.rb-status-btn {
  padding: 4px 12px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-foreground);
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.rb-status-btn:hover {
  background: var(--color-surface-hover);
}

.rb-status-btn--primary {
  background: var(--color-primary, #007acc);
  color: #fff;
  border-color: var(--color-primary, #007acc);
}

.rb-status-btn--primary:hover {
  filter: brightness(1.1);
}

.rb-status-btn--danger {
  border-color: rgba(220, 50, 50, 0.5);
  color: #c04040;
}

.rb-status-btn--danger:hover {
  background: rgba(220, 50, 50, 0.08);
}
</style>
