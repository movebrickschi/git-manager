import { createElectronAdapter, createElectronPlatform } from "./electron-adapter";
import { createWebAdapter, createWebPlatform } from "./web-adapter";
import { runGitWrite } from "./git-busy";
import { runNetworkBusy } from "./network-busy";
import type { CommandMethod } from "../../shared/command-manifest";
import type { Commands, Platform } from "./types";

export type {
  AheadBehind,
  RepoOpenResult,
  CommitInfo,
  RefInfo,
  GraphRow,
  GraphEdge,
  LogResult,
  LogFilter,
  BranchInfo,
  BranchesResult,
  FileStatus,
  StatusResult,
  BatchFileResult,
  DiffResult,
  DiffHunk,
  DiffLine,
  BlameInfo,
  BlameLine,
  StashEntry,
  MergeResult,
  ConflictFile,
  RemoteInfo,
  PushOptions,
  ReflogEntry,
  Submodule,
  ProgressEvent,
  RebaseAction,
  RebaseTodoEntry,
  RebaseStatus,
} from "./types";

const isElectron = typeof window !== "undefined" && !!window.electronAPI;

/**
 * 会改变仓库状态或联网的「写命令」白名单。这些命令执行期间会点亮全局 isGitWriting
 * 信号（见 git-busy.ts），让三个后台自动刷新器暂停，避免与写操作并发触发 git
 * （第二道防线；后端共享串行实例 getOrCreateGit 是第一道）。
 *
 * 维护提示：在 shared/command-manifest.ts 新增「写 / 联网」命令时，请同步登记到这里。
 * 漏登记不会导致撞锁（后端串行兜底），仅少了「写期间冻结后台刷新」这层体验优化；
 * 只读查询命令（getXxx / listXxx / previewCheckoutConflicts 等）不应登记。
 */
const WRITE_COMMANDS = new Set<CommandMethod>([
  // 分支 / 提交历史变更
  "createBranch", "checkoutBranch", "forceCheckoutBranch", "smartCheckoutBranch",
  "deleteBranch", "deleteRemoteBranch", "renameBranch", "mergeBranch", "rebaseBranch", "rebaseAutosquash",
  "cherryPick", "cherryPickRange", "revertCommit", "resetToCommit", "squashCommits",
  "startInteractiveRebase",
  // 暂存区 / 工作区
  "stageFile", "unstageFile", "stageAll", "unstageAll", "stageFilesBatch",
  "unstageFilesBatch", "addToGitignore", "discardFileChanges", "discardFilesBatch",
  "deleteFile", "deleteFilesBatch",
  // 提交
  "commit", "commitFixup", "commitFiles",
  // 联网：previewPullConflicts 内部会 fetch（写 refs），一并纳入冻结范围
  "push", "pull", "forcePull", "resetToRemote", "fetch", "fetchAll", "fetchBranch", "previewPullConflicts",
  // stash
  "stashSave", "stashApply", "stashPop", "stashDrop", "stashRename", "stashFile", "stashFiles",
  // 冲突 / 合并态
  "resolveConflict", "continueOperation", "abortOperation",
  // 标签
  "createTag", "deleteTag", "pushTag", "deleteRemoteTag", "checkoutTag",
  // 补丁 / 子模块 / 钩子 / worktree / clone
  "applyPatch", "initSubmodules", "updateSubmodules", "syncSubmodules",
  "writeHookContent", "enableHook", "disableHook",
  "addWorktree", "removeWorktree", "lockWorktree", "unlockWorktree", "pruneWorktrees",
  "cloneRepo",
]);

/**
 * 「联网」写命令子集。这些命令额外点亮 isNetworkBusy（见 network-busy.ts），驱动状态栏
 * 的「联网中…[中止]」指示器——让任意入口（PushDialog / 工具栏 Pull / 分支右键等）发起的
 * push/pull/fetch 在卡住时都能一键 cancelNetworkOps。第一个参数恒为 repoPath。
 */
const NETWORK_COMMANDS = new Set<CommandMethod>([
  "push", "pull", "forcePull", "resetToRemote", "fetch", "fetchAll", "fetchBranch", "previewPullConflicts",
  "deleteRemoteBranch",
]);

/**
 * 用 Proxy 包裹 adapter：拦截写命令，在调用期间维持 isGitWriting 信号；联网写命令再额外
 * 维持 isNetworkBusy（按 repoPath）。读命令零开销透传。一处接入即覆盖全部写操作，无需逐个
 * store 手动埋点。
 */
function withGitBusy(adapter: Commands): Commands {
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function" && WRITE_COMMANDS.has(prop as CommandMethod)) {
        const method = prop as CommandMethod;
        const fn = value as (...args: unknown[]) => Promise<unknown>;
        if (NETWORK_COMMANDS.has(method)) {
          return (...args: unknown[]) => {
            const repoPath = typeof args[0] === "string" ? args[0] : "";
            return runGitWrite(() => runNetworkBusy(repoPath, () => fn.apply(target, args)));
          };
        }
        return (...args: unknown[]) => runGitWrite(() => fn.apply(target, args));
      }
      return value;
    },
  });
}

export const commands: Commands = withGitBusy(
  isElectron ? createElectronAdapter() : createWebAdapter()
);

export const platform: Platform = isElectron ? createElectronPlatform() : createWebPlatform();
