import { contextBridge, ipcRenderer } from "electron";
import { COMMANDS } from "../shared/command-manifest";

/**
 * IPC channel allowlist —— 直接从 shared/command-manifest 派生。
 *
 * 历史 bug：preload 手写 allowlist 与 manifest 漂移过（push/pull/fetch 改名为
 * push_remote/pull_remote/fetch_remote 时漏改 preload，导致这三条命令在
 * packaged 模式下被 preload 拒绝）。改为从 manifest 自动派生后，新增 / 改名 IPC
 * 只需改 manifest 一处。
 *
 * 安全意义：杜绝渲染进程（包括 XSS / 第三方资源）通过 invoke(arbitrary)
 * 触发任意主进程逻辑，例如 delete_file / reset_to_commit hard。
 */
const ALLOWED_CHANNELS = new Set<string>([
  "dialog:openDirectory",
  ...COMMANDS.map((c) => c.ipc),
]);

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel: string, ...args: unknown[]) => {
    if (typeof channel !== "string" || !ALLOWED_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`IPC channel "${channel}" is not allowed`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  selectDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
});
