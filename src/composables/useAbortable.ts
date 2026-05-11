import { getCurrentScope, onScopeDispose } from "vue";

export type AbortableFn<TArgs extends unknown[], TResult> = (
  signal: AbortSignal,
  ...args: TArgs
) => Promise<TResult>;

export interface UseAbortableReturn<TArgs extends unknown[], TResult> {
  /**
   * 触发一次受控调用。如果有上一次未完成调用会被自动 abort。
   * 函数体内可读 `signal.aborted` 主动早退，或监听 `signal` 的 abort 事件。
   */
  run: (...args: TArgs) => Promise<TResult>;
  /**
   * 立即 abort 当前 in-flight 调用（如有）。幂等：无 in-flight 调用时无副作用。
   */
  cancel: (reason?: string) => void;
  /**
   * 是否有 in-flight 调用。
   */
  inFlight: () => boolean;
}

/**
 * 把异步函数包装成"可取消、且新调用自动顶替旧调用"的版本。
 *
 * 典型用途：仓库切换 / 列表过滤 / 输入搜索等高频触发场景，旧请求返回时不应再覆盖 UI。
 *
 * - 每次 `run` 会先 `abort()` 上一次的 AbortController，再新建一个并把 signal 传给 fn
 * - 组件 / `effectScope` 卸载时自动 abort 当前 in-flight 调用，防止泄漏到已销毁的组件
 * - `fn` 自身需要正确响应 `signal.aborted`（监听 abort 事件抛出 DOMException 是惯例）
 */
export function useAbortable<TArgs extends unknown[], TResult>(
  fn: AbortableFn<TArgs, TResult>,
): UseAbortableReturn<TArgs, TResult> {
  let current: AbortController | null = null;

  function cancel(reason?: string): void {
    if (current && !current.signal.aborted) {
      current.abort(reason ?? "useAbortable: cancelled");
    }
    current = null;
  }

  async function run(...args: TArgs): Promise<TResult> {
    // 用新调用顶替旧调用前先发出 abort 信号
    cancel("useAbortable: superseded by newer call");
    const controller = new AbortController();
    current = controller;
    try {
      return await fn(controller.signal, ...args);
    } finally {
      // 只在 current 仍是本次 controller 时清空，避免清掉后发请求新建的 controller
      if (current === controller) current = null;
    }
  }

  function inFlight(): boolean {
    return current !== null && !current.signal.aborted;
  }

  if (getCurrentScope()) {
    onScopeDispose(() => cancel("useAbortable: scope disposed"));
  }

  return { run, cancel, inFlight };
}
