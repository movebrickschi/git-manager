import type { Commands, Platform } from "./types";
import { COMMANDS } from "../../shared/command-manifest";

/**
 * 把 COMMANDS 字面量映射成 Commands 接口的实现。
 *
 * 每个 spec.method 对应 Commands 上同名方法，运行时把调用透传给 electronAPI.invoke(spec.ipc)。
 * 类型由 shared/typed-ipc.ts 的 TypedInvoke 保证：channel 与 args/return 类型对齐。
 *
 * 仍有一处 `as unknown as Commands` 是因为我们在用 Record<string, ...> 动态填充对象，
 * TS 无法静态证明 Record 的键穷尽了 Commands 的所有 method —— 这是 manifest-driven 写法
 * 不可避免的 trade-off；运行时通过 `pnpm test src/utils/command-manifest.test.ts` 守护
 * "Commands 接口的所有 method 都在 COMMANDS 数组里出现且签名一致"。
 */
export function createElectronAdapter(): Commands {
  const api = window.electronAPI!;
  const out: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const spec of COMMANDS) {
    out[spec.method] = (...args: unknown[]) => api.invoke(spec.ipc, ...args);
  }
  return out as unknown as Commands;
}

export function createElectronPlatform(): Platform {
  return {
    isElectron: true,
    selectDirectory: () => window.electronAPI!.selectDirectory(),
    revealInFolder: (absPath: string) => window.electronAPI!.revealInFolder(absPath),
  };
}
