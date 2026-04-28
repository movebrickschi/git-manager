import type { Commands, Platform } from "./types";

const BASE = "/api";

async function post<T>(endpoint: string, body: Record<string, any> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("无法连接后端服务，请确认服务器已启动");
  }
  if (!res.ok && res.status >= 500) {
    let msg = `服务器错误 (${res.status})`;
    try {
      const json = await res.json();
      if (json.error) msg = json.error;
    } catch { /* ignore parse error */ }
    throw new Error(msg);
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "请求失败");
  return json.data as T;
}

export function createWebAdapter(): Commands {
  return {
    openRepo: (path) => post("/repo/open", { path }),
    getLog: (repoPath, filter) => post("/log", { repoPath, filter }),
    getCommitDetail: (repoPath, commitId) => post("/commit/detail", { repoPath, commitId }),
    getCommitFiles: (repoPath, commitId) => post("/commit/files", { repoPath, commitId }),
    getCommitDiff: (repoPath, commitId, filePath) => post("/commit/diff", { repoPath, commitId, filePath }),
    getFileDiff: (repoPath, filePath, staged) => post("/file/diff", { repoPath, filePath, staged }),
    compareCommits: (repoPath, fromId, toId) => post("/commits/compare", { repoPath, fromId, toId }),
    getBranches: (repoPath) => post("/branches", { repoPath }),
    createBranch: (repoPath, name, startPoint?) => post("/branch/create", { repoPath, name, startPoint }),
    checkoutBranch: (repoPath, name) => post("/branch/checkout", { repoPath, name }),
    deleteBranch: (repoPath, name, force) => post("/branch/delete", { repoPath, name, force }),
    renameBranch: (repoPath, oldName, newName) => post("/branch/rename", { repoPath, oldName, newName }),
    mergeBranch: (repoPath, name) => post("/branch/merge", { repoPath, name }),
    rebaseBranch: (repoPath, upstream) => post("/branch/rebase", { repoPath, upstream }),
    cherryPick: (repoPath, commitId) => post("/cherry-pick", { repoPath, commitId }),
    revertCommit: (repoPath, commitId) => post("/commit/revert", { repoPath, commitId }),
    resetToCommit: (repoPath, commitId, mode) => post("/commit/reset", { repoPath, commitId, mode }),
    getStatus: (repoPath) => post("/status", { repoPath }),
    stageFile: (repoPath, filePath) => post("/stage/file", { repoPath, filePath }),
    unstageFile: (repoPath, filePath) => post("/unstage/file", { repoPath, filePath }),
    stageAll: (repoPath) => post("/stage/all", { repoPath }),
    unstageAll: (repoPath) => post("/unstage/all", { repoPath }),
    commit: (repoPath, message, amend) => post("/commit", { repoPath, message, amend }),
    push: (repoPath, remote?, branch?) => post("/push", { repoPath, remote, branch }),
    getUnpushedCommits: (repoPath, remote?, branch?) => post("/unpushed-commits", { repoPath, remote, branch }),
    pull: (repoPath, remote?, rebase?) => post("/pull", { repoPath, remote, rebase }),
    fetch: (repoPath, remote?) => post("/fetch", { repoPath, remote }),
    fetchAll: (repoPath) => post("/fetch/all", { repoPath }),
    fetchBranch: (repoPath, remote, branchName) => post("/branch/fetch-update", { repoPath, remote, branchName }),
    getRemotes: (repoPath) => post("/remotes", { repoPath }),
    getStashList: (repoPath) => post("/stash/list", { repoPath }),
    stashSave: (repoPath, message, includeUntracked) => post("/stash/save", { repoPath, message, includeUntracked }),
    stashApply: (repoPath, index) => post("/stash/apply", { repoPath, index }),
    stashPop: (repoPath, index) => post("/stash/pop", { repoPath, index }),
    stashDrop: (repoPath, index) => post("/stash/drop", { repoPath, index }),
    getStashFiles: (repoPath, index) => post("/stash/files", { repoPath, index }),
    getStashFileDiff: (repoPath, index, filePath) => post("/stash/file-diff", { repoPath, index, filePath }),
    getBlame: (repoPath, filePath, commitId?) => post("/blame", { repoPath, filePath, commitId }),
    getConflictFiles: (repoPath) => post("/conflict/files", { repoPath }),
    getConflictContent: (repoPath, filePath) => post("/conflict/content", { repoPath, filePath }),
    resolveConflict: (repoPath, filePath, content) => post("/conflict/resolve", { repoPath, filePath, content }),
    getWorkingFileContent: (repoPath, filePath) => post("/conflict/working-content", { repoPath, filePath }),
    cloneRepo: (url, path) => post("/clone", { url, path }),
    getFileContent: (repoPath, commitId, filePath) => post("/file/content", { repoPath, commitId, filePath }),
    discardFileChanges: (repoPath, filePath) => post("/file/discard", { repoPath, filePath }),
    getFileDiffRaw: (repoPath, filePath, staged) => post("/file/diff-raw", { repoPath, filePath, staged }),
    deleteFile: (repoPath, filePath) => post("/file/delete", { repoPath, filePath }),
    stashFile: (repoPath, filePath, message?) => post("/stash/file", { repoPath, filePath, message }),
  };
}

export function createWebPlatform(): Platform {
  return {
    isElectron: false,
    selectDirectory: () => {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.setAttribute("webkitdirectory", "");
        input.setAttribute("directory", "");
        input.onchange = () => {
          const files = input.files;
          if (files && files.length > 0) {
            const relativePath = files[0]!.webkitRelativePath;
            const dirName = relativePath.split("/")[0] ?? null;
            resolve(dirName);
          } else {
            resolve(null);
          }
        };
        input.oncancel = () => resolve(null);
        input.click();
      });
    },
  };
}
