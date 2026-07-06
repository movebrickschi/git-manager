<script setup lang="ts">
import type { FileStatus } from "@/utils/commands";

const props = defineProps<{
  status: FileStatus["status"];
}>();

/**
 * 将 git 文件状态映射为颜色 class。
 * copied 与 renamed 共用同一颜色（蓝色），与原 statusClass 逻辑保持一致。
 */
function statusClass(status: FileStatus["status"]): string {
  switch (status) {
    case "added":
      return "status-added";
    case "modified":
      return "status-modified";
    case "deleted":
      return "status-deleted";
    case "renamed":
    case "copied":
      return "status-renamed";
    case "untracked":
      return "status-untracked";
    case "conflicted":
      return "status-conflicted";
    case "ignored":
      return "status-ignored";
    default:
      return "";
  }
}

function statusTitle(status: FileStatus["status"]): string {
  switch (status) {
    case "added":
      return "新增";
    case "modified":
      return "已修改";
    case "deleted":
      return "已删除";
    case "renamed":
      return "已重命名";
    case "copied":
      return "已复制";
    case "untracked":
      return "未跟踪";
    case "conflicted":
      return "冲突";
    case "ignored":
      return "已忽略";
    default:
      return status;
  }
}
</script>

<template>
  <span class="status-icon" :class="statusClass(props.status)" :title="statusTitle(props.status)">
    <!-- added: 加号（新增） -->
    <svg
      v-if="props.status === 'added'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>

    <!-- modified: 铅笔（修改） -->
    <svg
      v-else-if="props.status === 'modified'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>

    <!-- deleted: 减号（删除） -->
    <svg
      v-else-if="props.status === 'deleted'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>

    <!-- renamed: 右箭头（重命名/移动） -->
    <svg
      v-else-if="props.status === 'renamed'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>

    <!-- copied: 重叠方块（复制） -->
    <svg
      v-else-if="props.status === 'copied'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>

    <!-- untracked: 问号（未跟踪） -->
    <svg
      v-else-if="props.status === 'untracked'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>

    <!-- conflicted: 警告三角（冲突） -->
    <svg
      v-else-if="props.status === 'conflicted'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>

    <!-- ignored: 禁止圈（被忽略） -->
    <svg
      v-else-if="props.status === 'ignored'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </svg>

    <!-- fallback: 问号 -->
    <svg
      v-else
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  </span>
</template>

<style scoped>
.status-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.status-added {
  color: var(--color-git-added);
}
.status-modified {
  color: var(--color-git-modified);
}
.status-deleted {
  color: var(--color-git-deleted);
}
.status-renamed {
  color: var(--color-git-renamed);
}
.status-untracked {
  color: var(--color-git-untracked);
}
.status-conflicted {
  color: var(--color-error);
}
.status-ignored {
  color: var(--color-foreground-muted);
}
</style>
