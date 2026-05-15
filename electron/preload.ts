import { contextBridge, ipcRenderer } from "electron";

/**
 * IPC channel allowlist —— 必须与 shared/command-manifest.ts 中的 `ipc` 字段
 * **逐字一致**。
 *
 * 为什么不直接 `import { COMMANDS } from "../shared/command-manifest"`？
 *   electron/main.ts `webPreferences.sandbox = true`，sandboxed preload 只能
 *   require electron 内置模块与极少数 Node 内置模块（events / timers / url），
 *   require 外部 .js / .ts 模块会让整个 preload 静默失败，导致 renderer 端
 *   `window.electronAPI` 为 undefined（症状：UI 退回 web 模式）。
 *
 * 改名 IPC 时**必须**同步本文件，CI 可加一个比对脚本守护。
 *
 * 安全意义：杜绝渲染进程（包括 XSS / 第三方资源）通过 invoke(arbitrary)
 * 触发任意主进程逻辑，例如 delete_file / reset_to_commit hard。
 */
const ALLOWED_CHANNELS = new Set<string>([
  "dialog:openDirectory",
  "open_repo",
  "get_log",
  "get_commit_detail",
  "get_commit_files",
  "get_commit_diff",
  "get_file_diff",
  "compare_commits",
  "get_branches",
  "create_branch",
  "checkout_branch",
  "force_checkout_branch",
  "smart_checkout_branch",
  "delete_branch",
  "rename_branch",
  "merge_branch",
  "rebase_branch",
  "cherry_pick",
  "revert_commit",
  "reset_to_commit",
  "squash_commits",
  "get_status",
  "stage_file",
  "unstage_file",
  "stage_all",
  "unstage_all",
  "commit",
  "push_remote",
  "get_unpushed_commits",
  "pull_remote",
  "fetch_remote",
  "fetch_all",
  "fetch_branch",
  "get_remotes",
  "get_stash_list",
  "stash_save",
  "stash_apply",
  "stash_pop",
  "stash_drop",
  "get_stash_files",
  "get_stash_file_diff",
  "get_blame",
  "get_conflict_files",
  "get_conflict_content",
  "resolve_conflict",
  "get_working_file_content",
  "get_merge_state",
  "continue_operation",
  "abort_operation",
  "clone_repo",
  "get_file_content",
  "discard_file_changes",
  "get_file_diff_raw",
  "delete_file",
  "stash_file",
  "create_tag",
  "delete_tag",
  "push_tag",
  "delete_remote_tag",
  "checkout_tag",
  "get_reflog",
  "create_patch",
  "apply_patch",
  "get_submodules",
  "init_submodules",
  "update_submodules",
  "sync_submodules",
  "ai:generate",
  "ai:get_settings",
  "ai:save_settings",
  "ai:test_connection",
  "ai:abort",
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
