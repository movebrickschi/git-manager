import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRepoStore } from "@/stores/repoStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { commands } from "@/utils/commands";

/**
 * 后台定时 fetch 所有打开的仓库的 remote。
 *
 * 行为契约：
 * - 仅在 `settings.autoFetchEnabled === true` 时运行
 * - 间隔由 `settings.autoFetchIntervalMinutes` 控制（最小 1 分钟）
 * - 仅在 `document.visibilityState === 'visible'` 时执行（后台 tab 不浪费请求）
 * - 对每个 repo 串行 fetchAll，失败静默（写 lastError 但不抛出 / 不弹 toast）
 * - 设置项变更时立刻重启定时器并立即跑一次
 * - 单例：组件复用同一份 `state`，避免重复挂载导致并发 fetch
 */

const isFetching = ref(false);
const lastFetchAt = ref<number | null>(null);
const lastErrors = ref<Map<string, string>>(new Map());

let timer: ReturnType<typeof setInterval> | null = null;
let mountCount = 0;

async function tick() {
  const repoStore = useRepoStore();
  if (document.visibilityState !== "visible") return;
  if (isFetching.value) return;
  if (repoStore.repos.length === 0) return;
  isFetching.value = true;
  try {
    for (const repo of repoStore.repos) {
      try {
        await commands.fetchAll(repo.path);
        lastErrors.value.delete(repo.path);
      } catch (e: any) {
        lastErrors.value.set(repo.path, String(e?.message ?? e));
      }
    }
    lastFetchAt.value = Date.now();
  } finally {
    isFetching.value = false;
  }
}

function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function restart(): void {
  stop();
  const settings = useSettingsStore();
  if (!settings.autoFetchEnabled) return;
  const minutes = Math.max(1, settings.autoFetchIntervalMinutes);
  timer = setInterval(tick, minutes * 60_000);
  void tick();
}

export function useAutoFetch() {
  const settings = useSettingsStore();

  onMounted(() => {
    mountCount += 1;
    if (mountCount === 1) {
      restart();
    }
  });

  onUnmounted(() => {
    mountCount -= 1;
    if (mountCount === 0) {
      stop();
    }
  });

  watch(
    () => [settings.autoFetchEnabled, settings.autoFetchIntervalMinutes] as const,
    () => {
      if (mountCount > 0) restart();
    }
  );

  return {
    isFetching,
    lastFetchAt,
    lastErrors,
    triggerFetch: tick,
  };
}
