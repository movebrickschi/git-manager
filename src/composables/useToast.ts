import { onUnmounted, ref } from "vue";

/**
 * 简易 toast：一条信息 + 自动隐藏（默认 2500ms）。
 * 卸载时自动清理定时器，避免内存泄漏与「卸载后 setState 警告」。
 */
export function useToast(autoHideMs = 2500) {
  const toastMessage = ref("");
  const toastVisible = ref(false);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function show(msg: string) {
    toastMessage.value = msg;
    toastVisible.value = true;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastVisible.value = false;
    }, autoHideMs);
  }

  function hide() {
    toastVisible.value = false;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  onUnmounted(() => {
    if (toastTimer) clearTimeout(toastTimer);
  });

  return { toastMessage, toastVisible, show, hide };
}
