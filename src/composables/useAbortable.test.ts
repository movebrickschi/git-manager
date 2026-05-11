import { describe, it, expect } from "vitest";
import { effectScope } from "vue";
import { useAbortable } from "./useAbortable";

function nextTick(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("useAbortable", () => {
  it("单次 run 直接返回 fn 的 resolved 值", async () => {
    const scope = effectScope();
    const result = await scope.run(async () => {
      const { run } = useAbortable(async (_signal: AbortSignal, x: number) => x * 2);
      return run(3);
    })!;
    expect(result).toBe(6);
    scope.stop();
  });

  it("连续两次 run 应 abort 前一次（信号已 aborted, 前一次 promise reject AbortError）", async () => {
    const scope = effectScope();
    const seenSignals: AbortSignal[] = [];

    async function payload(signal: AbortSignal, id: number): Promise<number> {
      seenSignals.push(signal);
      return new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => resolve(id), 50);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }

    const outcome = await scope.run(async () => {
      const { run } = useAbortable(payload);
      const p1 = run(1).catch((e: unknown) => e);
      // 立即触发第二次调用，覆盖第一次
      const p2 = run(2);
      return Promise.all([p1, p2]);
    })!;
    scope.stop();

    const [r1, r2] = outcome;
    expect(r2).toBe(2);
    expect(seenSignals[0]?.aborted).toBe(true);
    expect(seenSignals[1]?.aborted).toBe(false);
    expect((r1 as DOMException).name).toBe("AbortError");
  });

  it("cancel() 应立即 abort 当前请求", async () => {
    const scope = effectScope();
    const settled = await scope.run(async () => {
      const fn = (signal: AbortSignal): Promise<string> =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve("done"), 100);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      const { run, cancel } = useAbortable(fn);
      const p = run().catch((e: unknown) => e);
      cancel();
      return p;
    })!;
    scope.stop();
    expect((settled as DOMException).name).toBe("AbortError");
  });

  it("scope.stop() 应 abort 当前 in-flight 请求", async () => {
    const scope = effectScope();
    let captured: AbortSignal | null = null;
    let runPromise: Promise<unknown> | null = null;

    scope.run(() => {
      const fn = (signal: AbortSignal): Promise<string> => {
        captured = signal;
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve("ok"), 100);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      };
      const { run } = useAbortable(fn);
      runPromise = run().catch((e: unknown) => e);
    });

    await nextTick(0);
    scope.stop();
    expect(runPromise).not.toBeNull();
    const err = (await runPromise!) as DOMException;
    expect(captured).not.toBeNull();
    expect(captured!.aborted).toBe(true);
    expect(err.name).toBe("AbortError");
  });

  it("inFlight() 在进行中为 true，结束/取消后为 false", async () => {
    const scope = effectScope();
    await scope.run(async () => {
      let resolveOuter!: () => void;
      const fn = (_signal: AbortSignal): Promise<void> =>
        new Promise<void>((resolve) => {
          resolveOuter = resolve;
        });
      const { run, inFlight } = useAbortable(fn);
      const p = run();
      expect(inFlight()).toBe(true);
      resolveOuter();
      await p;
      expect(inFlight()).toBe(false);
    });
    scope.stop();
  });

  it("无 scope 上下文调用不抛错（允许非组件使用）", async () => {
    const { run, cancel } = useAbortable(async (_signal: AbortSignal) => 42);
    const v = await run();
    expect(v).toBe(42);
    expect(() => cancel()).not.toThrow();
  });
});
