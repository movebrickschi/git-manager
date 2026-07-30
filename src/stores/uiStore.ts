import { defineStore } from "pinia";
import { reactive, ref } from "vue";

export const useUiStore = defineStore("ui", () => {
  const toastMessage = ref("");
  const toastVisible = ref(false);
  // 按 repoPath 跟踪「前台 Git 进度」（拉取/抓取/强制拉取/重置…）及其文案。
  // 用 Map 按仓库隔离：A 仓库在途操作时切到 B 仓库不应再显示进度胶囊——多仓库互不影响。
  const progressLabels = reactive(new Map<string, string>());
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showToast(msg: string, durationMs = 3000) {
    toastMessage.value = msg;
    toastVisible.value = true;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastVisible.value = false;
    }, durationMs);
  }

  function startProgress(repoPath: string, label = "") {
    if (!repoPath) return;
    progressLabels.set(repoPath, label);
  }

  function stopProgress(repoPath: string) {
    if (!repoPath) return;
    progressLabels.delete(repoPath);
  }

  /**
   * 指定仓库当前是否有前台 Git 进度。在 computed / 模板中调用即具响应式：
   * reactive Map 的 has 会被依赖追踪，start/stopProgress 触发重算。
   */
  function isRepoProgressing(repoPath: string | null | undefined): boolean {
    if (!repoPath) return false;
    return progressLabels.has(repoPath);
  }

  /** 指定仓库当前的前台进度文案（无进度时空串）。 */
  function repoProgressLabel(repoPath: string | null | undefined): string {
    if (!repoPath) return "";
    return progressLabels.get(repoPath) ?? "";
  }

  return {
    toastMessage,
    toastVisible,
    showToast,
    startProgress,
    stopProgress,
    isRepoProgressing,
    repoProgressLabel,
  };
});
