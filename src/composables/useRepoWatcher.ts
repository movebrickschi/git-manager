/**
 * useRepoWatcher · 订阅仓库变化事件，两种 transport：
 *
 * - **Electron 模式**：通过 preload 暴露的 `electronAPI.on("repo:changed")` 接 IPC 推送
 * - **Web 模式**：通过 EventSource 连接后端 `GET /api/repo/events?repoPath=...` 接 SSE 推送
 *
 * 共同：
 * - 自动在组件卸载时解绑监听
 * - 内置 dedup 窗口（100ms）：避免 OS 文件系统抖动导致连续多次 store.loadStatus
 */
import { onScopeDispose, ref, watch as vueWatch } from "vue";
import { platform } from "@/utils/commands";
import type { RepoWatcherEvent } from "../../shared/repo-watcher-types";

type Cb = (e: RepoWatcherEvent) => void;

const DEDUP_WINDOW_MS = 100;

/** 当前 Web 模式追踪的 repoPath（由 setWatchedRepo 写入）。Electron 模式不使用。 */
const webWatchedRepo = ref<string | null>(null);

function makeDedupedCallback(callback: Cb): (raw: unknown) => void {
  const lastFiredAt = new Map<RepoWatcherEvent["kind"], number>();
  return (raw: unknown) => {
    const e = raw as RepoWatcherEvent;
    if (!e || typeof e.kind !== "string") return;
    const now = Date.now();
    const last = lastFiredAt.get(e.kind) ?? 0;
    if (now - last < DEDUP_WINDOW_MS) return;
    lastFiredAt.set(e.kind, now);
    callback(e);
  };
}

export function useRepoWatcher(callback: Cb): () => void {
  const wrapped = makeDedupedCallback(callback);

  if (platform.isElectron && window.electronAPI?.on) {
    const off = window.electronAPI.on("repo:changed", wrapped);
    onScopeDispose(off);
    return off;
  }

  // Web 模式：用 EventSource 订阅 /api/repo/events，按 webWatchedRepo 变化重连
  let es: EventSource | null = null;
  const close = () => {
    if (es) {
      es.close();
      es = null;
    }
  };
  const open = (repoPath: string) => {
    close();
    const url = `/api/repo/events?repoPath=${encodeURIComponent(repoPath)}`;
    es = new EventSource(url);
    es.addEventListener("repo-changed", (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent).data);
        wrapped(payload);
      } catch (err) {
        console.warn("[useRepoWatcher] parse SSE payload failed:", err);
      }
    });
    es.addEventListener("error", () => {
      // EventSource 自带 reconnect，但如果是 4xx 服务器拒绝会反复抖
      // 这里只 warn，不强制 close（让浏览器决定重连）
    });
  };

  const stopWatch = vueWatch(
    webWatchedRepo,
    (p) => {
      if (p) open(p);
      else close();
    },
    { immediate: true }
  );

  const dispose = () => {
    stopWatch();
    close();
  };
  onScopeDispose(dispose);
  return dispose;
}

/**
 * 通知主进程"现在监听这个仓库"。传 null 停止监听。
 * 切仓库时由 repoStore 主动调用。
 *
 * - Electron 模式：调 IPC `repo:watch`
 * - Web 模式：写入 webWatchedRepo，触发 useRepoWatcher 内 EventSource 重连
 */
export async function setWatchedRepo(repoPath: string | null): Promise<void> {
  if (platform.isElectron) {
    try {
      await window.electronAPI?.invoke("repo:watch", repoPath);
    } catch (e) {
      console.warn("[useRepoWatcher] setWatchedRepo (electron) failed:", e);
    }
    return;
  }
  webWatchedRepo.value = repoPath;
}
