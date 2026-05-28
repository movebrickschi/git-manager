/**
 * Typed IPC mapping · 把 `COMMANDS` 字面量 + `Commands` 接口编织成
 * 编译期"channel → method → 参数/返回值"映射，让 `electronAPI.invoke` 与
 * `createElectronAdapter` 不再依赖 `as unknown as` cast，而是真正类型安全。
 *
 * 用法（caller 视角）：
 *   const r = await window.electronAPI?.invoke("open_repo", "/path/to/repo");
 *   //                                          ↑ 字面量类型 IpcChannel
 *   //                                                    ↑ 参数自动推断为 string
 *   //          ↑ 返回 Promise<RepoOpenResult>
 *
 * 任何在 COMMANDS 不存在的 channel 字面量会被 TS 编译期拒绝。
 */
import { COMMANDS } from "./command-manifest.js";
import type { Commands } from "./types.js";

/** COMMANDS 数组里所有的 ipc channel literal union。 */
export type IpcChannel = (typeof COMMANDS)[number]["ipc"];

/** channel → method 反查表（编译期，无运行时开销）。 */
type IpcChannelToMethodMap = {
  [Spec in (typeof COMMANDS)[number] as Spec["ipc"]]: Spec["method"];
};

/** 给定 channel，对应 Commands 接口上的方法名。 */
export type MethodOfChannel<C extends IpcChannel> = IpcChannelToMethodMap[C];

/** 给定 channel，对应方法的参数元组类型。 */
export type IpcArgs<C extends IpcChannel> = Parameters<Commands[MethodOfChannel<C>]>;

/** 给定 channel，对应方法的 Promise 返回值类型。 */
export type IpcReturn<C extends IpcChannel> = ReturnType<Commands[MethodOfChannel<C>]>;

/**
 * 类型化 invoke 签名 —— 重载：
 *   1. 已知 channel 字面量 → 强类型 args + return
 *   2. string 兜底 → 用于动态拼 channel 名等转场，TS 推断 unknown
 *
 * preload.ts 的 ALLOWED_CHANNELS 仍在运行时做 allowlist 校验（双保险）。
 */
export interface TypedInvoke {
  <C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): IpcReturn<C>;
  (channel: string, ...args: unknown[]): Promise<unknown>;
}
