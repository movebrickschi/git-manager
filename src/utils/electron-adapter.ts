import type { Commands, Platform } from "./types";

declare global {
  interface Window {
    electronAPI?: {
      invoke(channel: string, ...args: any[]): Promise<any>;
      selectDirectory(): Promise<string | null>;
    };
  }
}

export function createElectronAdapter(): Commands {
  const api = window.electronAPI!;

  return {
    openRepo: (path) => api.invoke("open_repo", path),
    getLog: (repoPath, filter) => api.invoke("get_log", repoPath, filter),
    getCommitDetail: (repoPath, commitId) => api.invoke("get_commit_detail", repoPath, commitId),
    getCommitFiles: (repoPath, commitId) => api.invoke("get_commit_files", repoPath, commitId),
    getCommitDiff: (repoPath, commitId, filePath) => api.invoke("get_commit_diff", repoPath, commitId, filePath),
    getFileDiff: (repoPath, filePath, staged) => api.invoke("get_file_diff", repoPath, filePath, staged),
    compareCommits: (repoPath, fromId, toId) => api.invoke("compare_commits", repoPath, fromId, toId),
    getBranches: (repoPath) => api.invoke("get_branches", repoPath),
    createBranch: (repoPath, name, startPoint?) => api.invoke("create_branch", repoPath, name, startPoint),
    checkoutBranch: (repoPath, name) => api.invoke("checkout_branch", repoPath, name),
    deleteBranch: (repoPath, name, force) => api.invoke("delete_branch", repoPath, name, force),
    renameBranch: (repoPath, oldName, newName) => api.invoke("rename_branch", repoPath, oldName, newName),
    mergeBranch: (repoPath, name) => api.invoke("merge_branch", repoPath, name),
    rebaseBranch: (repoPath, upstream) => api.invoke("rebase_branch", repoPath, upstream),
    cherryPick: (repoPath, commitId) => api.invoke("cherry_pick", repoPath, commitId),
    revertCommit: (repoPath, commitId) => api.invoke("revert_commit", repoPath, commitId),
    resetToCommit: (repoPath, commitId, mode) => api.invoke("reset_to_commit", repoPath, commitId, mode),
    getStatus: (repoPath) => api.invoke("get_status", repoPath),
    stageFile: (repoPath, filePath) => api.invoke("stage_file", repoPath, filePath),
    unstageFile: (repoPath, filePath) => api.invoke("unstage_file", repoPath, filePath),
    stageAll: (repoPath) => api.invoke("stage_all", repoPath),
    unstageAll: (repoPath) => api.invoke("unstage_all", repoPath),
    commit: (repoPath, message, amend) => api.invoke("commit", repoPath, message, amend),
    push: (repoPath, remote?, branch?) => api.invoke("push_remote", repoPath, remote, branch),
    getUnpushedCommits: (repoPath, remote?, branch?) => api.invoke("get_unpushed_commits", repoPath, remote, branch),
    pull: (repoPath, remote?, rebase?) => api.invoke("pull_remote", repoPath, remote, rebase),
    fetch: (repoPath, remote?) => api.invoke("fetch_remote", repoPath, remote),
    fetchAll: (repoPath) => api.invoke("fetch_all", repoPath),
    fetchBranch: (repoPath, remote, branchName) => api.invoke("fetch_branch", repoPath, remote, branchName),
    getRemotes: (repoPath) => api.invoke("get_remotes", repoPath),
    getStashList: (repoPath) => api.invoke("get_stash_list", repoPath),
    stashSave: (repoPath, message, includeUntracked) => api.invoke("stash_save", repoPath, message, includeUntracked),
    stashApply: (repoPath, index) => api.invoke("stash_apply", repoPath, index),
    stashPop: (repoPath, index) => api.invoke("stash_pop", repoPath, index),
    stashDrop: (repoPath, index) => api.invoke("stash_drop", repoPath, index),
    getStashFiles: (repoPath, index) => api.invoke("get_stash_files", repoPath, index),
    getStashFileDiff: (repoPath, index, filePath) => api.invoke("get_stash_file_diff", repoPath, index, filePath),
    getBlame: (repoPath, filePath, commitId?) => api.invoke("get_blame", repoPath, filePath, commitId),
    getConflictFiles: (repoPath) => api.invoke("get_conflict_files", repoPath),
    getConflictContent: (repoPath, filePath) => api.invoke("get_conflict_content", repoPath, filePath),
    resolveConflict: (repoPath, filePath, content) => api.invoke("resolve_conflict", repoPath, filePath, content),
    getWorkingFileContent: (repoPath, filePath) => api.invoke("get_working_file_content", repoPath, filePath),
    getMergeState: (repoPath) => api.invoke("get_merge_state", repoPath),
    continueOperation: (repoPath, op) => api.invoke("continue_operation", repoPath, op),
    abortOperation: (repoPath, op) => api.invoke("abort_operation", repoPath, op),
    cloneRepo: (url, path) => api.invoke("clone_repo", url, path),
    getFileContent: (repoPath, commitId, filePath) => api.invoke("get_file_content", repoPath, commitId, filePath),
    discardFileChanges: (repoPath, filePath) => api.invoke("discard_file_changes", repoPath, filePath),
    getFileDiffRaw: (repoPath, filePath, staged) => api.invoke("get_file_diff_raw", repoPath, filePath, staged),
    deleteFile: (repoPath, filePath) => api.invoke("delete_file", repoPath, filePath),
    stashFile: (repoPath, filePath, message?) => api.invoke("stash_file", repoPath, filePath, message),
  };
}

export function createElectronPlatform(): Platform {
  return {
    isElectron: true,
    selectDirectory: () => window.electronAPI!.selectDirectory(),
  };
}
