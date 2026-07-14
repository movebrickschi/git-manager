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
import {
  onScopeDispose,
  readonly,
  shallowRef,
  toValue,
  watch as vueWatch,
  type MaybeRefOrGetter,
} from "vue";
import { platform } from "@/utils/commands";
import { isGitWriting } from "@/utils/git-busy";
import type {
  RepoWatcherEvent,
  RepoWatcherEventKind,
} from "../../shared/repo-watcher-types";

type Cb = (e: RepoWatcherEvent) => void;

const DEDUP_WINDOW_MS = 100;

/** HEAD 或任意 Git ref 变化都会影响分支、ahead/behind 与提交日志。 */
export function repoWatcherNeedsFullRefresh(kind: RepoWatcherEvent["kind"]): boolean {
  return kind === "head" || kind === "refs";
}

export interface RepoChangeSubscription {
  repoPath: MaybeRefOrGetter<string | null | undefined>;
  kinds?: readonly RepoWatcherEventKind[];
  onEvent: (event: RepoWatcherEvent) => void;
}

export interface RepoChangeSignal {
  sequence: number;
  event: RepoWatcherEvent;
}

const repoChangeSignalRef = shallowRef<RepoChangeSignal | null>(null);
const repoChangeSubscriptions = new Set<RepoChangeSubscription>();
let repoChangeSequence = 0;

/** App 发布、各视图消费的全局只读响应式仓库变化信号。 */
export const repoChangeSignal = readonly(repoChangeSignalRef);

function subscriptionMatches(
  subscription: RepoChangeSubscription,
  event: RepoWatcherEvent
): boolean {
  const repoPath = toValue(subscription.repoPath);
  if (!repoPath || repoPath !== event.repoPath) return false;
  return !subscription.kinds || subscription.kinds.includes(event.kind);
}

/** App.vue 的唯一 transport 订阅把通过旧仓库/设置防护的事件发布到这里。 */
export function publishRepoChange(event: RepoWatcherEvent): void {
  repoChangeSignalRef.value = { sequence: ++repoChangeSequence, event };
  for (const subscription of [...repoChangeSubscriptions]) {
    if (!subscriptionMatches(subscription, event)) continue;
    try {
      subscription.onEvent(event);
    } catch (error) {
      console.warn("[repo-change-events] subscriber failed:", error);
    }
  }
}

/** 非组件场景使用的命令式订阅。 */
export function subscribeRepoChanges(subscription: RepoChangeSubscription): () => void {
  repoChangeSubscriptions.add(subscription);
  return () => {
    repoChangeSubscriptions.delete(subscription);
  };
}

/** Vue/Pinia scope 订阅，scope 销毁时自动解绑。 */
export function useRepoChangeEvents(subscription: RepoChangeSubscription): () => void {
  const off = subscribeRepoChanges(subscription);
  onScopeDispose(off);
  return off;
}

/** 当前 Web 模式追踪目标；revision 允许同仓库强制重建 SSE 以重解析动态 hooksPath。 */
const webWatchTarget = shallowRef({ repoPath: null as string | null, revision: 0 });

function parseRepoWatcherEvent(raw: unknown): RepoWatcherEvent | null {
  const event = raw as RepoWatcherEvent;
  if (!event || typeof event.kind !== "string" || typeof event.repoPath !== "string") return null;
  return event;
}

/**
 * 普通 transport 事件按 repo/kind 做时间去重；pending flush 使用 dispatchImmediately
 * 保证写入期间合并出的最新事件不会被写入前留下的时间窗吞掉。
 */
export function createRepoChangeDeduper(callback: Cb, now: () => number = Date.now) {
  const lastFiredAt = new Map<string, number>();
  let stopped = false;

  const dispatch = (event: RepoWatcherEvent): void => {
    if (stopped) return;
    const key = `${event.repoPath}\0${event.kind}`;
    const firedAt = now();
    const last = lastFiredAt.get(key);
    if (last !== undefined && firedAt - last < DEDUP_WINDOW_MS) return;
    lastFiredAt.set(key, firedAt);
    callback(event);
  };

  const dispatchImmediately = (event: RepoWatcherEvent): void => {
    if (stopped) return;
    lastFiredAt.set(`${event.repoPath}\0${event.kind}`, now());
    callback(event);
  };

  const clear = (): void => {
    lastFiredAt.clear();
  };

  const stop = (): void => {
    stopped = true;
    clear();
  };

  return { dispatch, dispatchImmediately, clear, stop };
}

/**
 * Git 写入期间合并 watcher 事件；写入结束后每个 repo/kind 只补发最新一次。
 * 纯函数式控制器便于验证 pending 不会永久丢失。
 */
export function createPendingRepoChangeDispatcher(
  callback: Cb,
  writing: () => boolean,
  flushCallback: Cb = callback
) {
  const pending = new Map<string, RepoWatcherEvent>();
  let stopped = false;

  const enqueue = (event: RepoWatcherEvent): void => {
    const key = `${event.repoPath}\0${event.kind}`;
    const previous = pending.get(key);
    pending.set(
      key,
      previous?.requiresContextRefresh || event.requiresContextRefresh
        ? { ...event, requiresContextRefresh: true }
        : event
    );
  };

  const deliver = (event: RepoWatcherEvent, fromFlush = false): void => {
    if (stopped) return;
    if (writing()) {
      enqueue(event);
      return;
    }
    (fromFlush ? flushCallback : callback)(event);
  };

  const dispatch = (event: RepoWatcherEvent): void => deliver(event);

  const flush = (): void => {
    if (stopped || writing() || pending.size === 0) return;
    const events = [...pending.values()];
    pending.clear();
    for (const event of events) deliver(event, true);
  };

  const clear = (): void => pending.clear();
  const stop = (): void => {
    stopped = true;
    clear();
  };

  return {
    dispatch,
    flush,
    clear,
    stop,
    pendingCount: () => pending.size,
  };
}

export function useRepoWatcher(callback: Cb): () => void {
  const deduper = createRepoChangeDeduper(callback);
  const pendingDispatcher = createPendingRepoChangeDispatcher(
    deduper.dispatch,
    () => isGitWriting.value,
    deduper.dispatchImmediately
  );
  const wrapped = (raw: unknown): void => {
    const event = parseRepoWatcherEvent(raw);
    if (event) pendingDispatcher.dispatch(event);
  };
  const stopWritingWatch = vueWatch(isGitWriting, (writing) => {
    if (!writing) pendingDispatcher.flush();
  });
  let disposeTransport: () => void;

  if (platform.isElectron && window.electronAPI?.on) {
    disposeTransport = window.electronAPI.on("repo:changed", wrapped);
  } else {
    // Web 模式：用 EventSource 订阅 /api/repo/events，按 webWatchTarget 变化重连
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
      webWatchTarget,
      ({ repoPath }) => {
        if (repoPath) open(repoPath);
        else close();
      },
      { immediate: true }
    );
    disposeTransport = () => {
      stopWatch();
      close();
    };
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeTransport();
    stopWritingWatch();
    pendingDispatcher.stop();
    deduper.stop();
  };
  onScopeDispose(dispose);
  return dispose;
}

/**
 * 通知主进程"现在监听这个仓库"。传 null 停止监听。
 * 切仓库时由 repoStore 主动调用。
 *
 * - Electron 模式：调 IPC `repo:watch`
 * - Web 模式：更新 webWatchTarget，触发 useRepoWatcher 内 EventSource 重连
 */
export async function setWatchedRepo(repoPath: string | null, force = false): Promise<void> {
  if (platform.isElectron) {
    try {
      await window.electronAPI?.invoke("repo:watch", repoPath, force);
    } catch (e) {
      console.warn("[useRepoWatcher] setWatchedRepo (electron) failed:", e);
    }
    return;
  }
  if (!force && webWatchTarget.value.repoPath === repoPath) return;
  webWatchTarget.value = {
    repoPath,
    revision: webWatchTarget.value.revision + 1,
  };
}
