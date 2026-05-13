import { onMounted, onUnmounted } from "vue";

/**
 * 周期性轮询。仅在 document.visible 时调用 `tick`，避免后台 tab 浪费请求。
 * 不在 mounted 时立即执行一次；如需首屏立即拉取，由调用方在 onMounted 中自行触发。
 */
export function useStatusPolling(tick: () => Promise<void> | void, intervalMs = 10_000) {
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function start(): void {
    stop();
    pollTimer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        await tick();
      } catch {
        // 轮询失败静默，避免污染日志
      }
    }, intervalMs);
  }

  function stop(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  onMounted(start);
  onUnmounted(stop);

  return { start, stop };
}
