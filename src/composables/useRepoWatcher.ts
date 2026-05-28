/**
 * useRepoWatcher · 订阅主进程推送的 repo:changed 事件
 *
 * - 只在 Electron 模式生效；Web 模式下 isElectron=false，hook 返回 no-op
 * - 自动在组件卸载时解绑监听
 * - 内置 dedup 窗口：同 kind 在 100ms 内重复触发只回调一次（防止 OS 文件系统
 *   抖动 → preload IPC 批量送达 → 渲染端连续 N 次 store.loadStatus）
 */
import { onScopeDispose } from "vue";
import { platform } from "@/utils/commands";
import type { RepoWatcherEvent } from "../../shared/repo-watcher-types";

type Cb = (e: RepoWatcherEvent) => void;

const DEDUP_WINDOW_MS = 100;

export function useRepoWatcher(callback: Cb): () => void {
  if (!platform.isElectron || !window.electronAPI?.on) {
    return () => {};
  }
  const lastFiredAt = new Map<RepoWatcherEvent["kind"], number>();

  const wrapped = (payload: unknown) => {
    const e = payload as RepoWatcherEvent;
    if (!e || typeof e.kind !== "string") return;
    const now = Date.now();
    const last = lastFiredAt.get(e.kind) ?? 0;
    if (now - last < DEDUP_WINDOW_MS) return;
    lastFiredAt.set(e.kind, now);
    callback(e);
  };

  const off = window.electronAPI.on("repo:changed", wrapped);
  onScopeDispose(off);
  return off;
}

/**
 * 通知主进程"现在监听这个仓库"。传 null 停止监听。
 * 切仓库时由 repoStore 主动调用。
 * Web 模式静默 no-op。
 */
export async function setWatchedRepo(repoPath: string | null): Promise<void> {
  if (!platform.isElectron) return;
  try {
    await window.electronAPI?.invoke("repo:watch", repoPath);
  } catch (e) {
    console.warn("[useRepoWatcher] setWatchedRepo failed:", e);
  }
}
