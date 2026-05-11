import { contextBridge, ipcRenderer } from "electron";

/**
 * IPC channel allowlist —— 必须与 main.ts ipcMain.handle 一一对应。
 * 新增 IPC 时**必须**先在此处显式声明，否则渲染进程无法调用。
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
  "delete_branch",
  "rename_branch",
  "merge_branch",
  "rebase_branch",
  "cherry_pick",
  "revert_commit",
  "reset_to_commit",
  "get_status",
  "stage_file",
  "unstage_file",
  "stage_all",
  "unstage_all",
  "commit",
  "push",
  "get_unpushed_commits",
  "pull",
  "fetch",
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
]);

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel: string, ...args: unknown[]) => {
    if (typeof channel !== "string" || !ALLOWED_CHANNELS.has(channel)) {
      return Promise.reject(
        new Error(`IPC channel "${channel}" is not allowed`)
      );
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  selectDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
});
