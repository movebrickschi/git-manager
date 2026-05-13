import { app, BrowserWindow, ipcMain, dialog, session, shell } from "electron";
import * as path from "path";
import { gitService } from "../server/git-service";

let mainWindow: BrowserWindow | null = null;

function installCsp() {
  // 生产环境严格 CSP；开发环境允许 Vite HMR
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const csp = isDev
    ? [
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: wss: http: https:",
        "img-src 'self' data: blob: https: http:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss: http: https:",
      ].join("; ")
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Git Manager",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  // 拦截新窗口打开：一律走系统浏览器，不允许在 app 内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // 阻止导航跳出 app 范围
  mainWindow.webContents.on("will-navigate", (e, url) => {
    const isDev = !!process.env.VITE_DEV_SERVER_URL;
    const allowedPrefixes = isDev ? [process.env.VITE_DEV_SERVER_URL ?? ""] : ["file://"];
    if (!allowedPrefixes.some((prefix) => prefix && url.startsWith(prefix))) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  installCsp();
  createWindow();
});

// 全局拦截：禁止应用层 webContents 创建跨域子 webContents
app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("dialog:openDirectory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "选择 Git 仓库",
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("open_repo", (_e, repoPath: string) => gitService.openRepo(repoPath));

ipcMain.handle("get_log", (_e, repoPath: string, filter: any) =>
  gitService.getLog(repoPath, filter)
);

ipcMain.handle("get_commit_detail", (_e, repoPath: string, commitId: string) =>
  gitService.getCommitDetail(repoPath, commitId)
);

ipcMain.handle("get_commit_files", (_e, repoPath: string, commitId: string) =>
  gitService.getCommitFiles(repoPath, commitId)
);

ipcMain.handle("get_commit_diff", (_e, repoPath: string, commitId: string, filePath: string) =>
  gitService.getCommitDiff(repoPath, commitId, filePath)
);

ipcMain.handle("get_file_diff", (_e, repoPath: string, filePath: string, staged: boolean) =>
  gitService.getFileDiff(repoPath, filePath, staged)
);

ipcMain.handle("compare_commits", (_e, repoPath: string, fromId: string, toId: string) =>
  gitService.compareCommits(repoPath, fromId, toId)
);

ipcMain.handle("get_branches", (_e, repoPath: string) => gitService.getBranches(repoPath));

ipcMain.handle("create_branch", (_e, repoPath: string, name: string, startPoint?: string) =>
  gitService.createBranch(repoPath, name, startPoint)
);

ipcMain.handle("checkout_branch", (_e, repoPath: string, name: string) =>
  gitService.checkoutBranch(repoPath, name)
);

ipcMain.handle("delete_branch", (_e, repoPath: string, name: string, force: boolean) =>
  gitService.deleteBranch(repoPath, name, force)
);

ipcMain.handle("rename_branch", (_e, repoPath: string, oldName: string, newName: string) =>
  gitService.renameBranch(repoPath, oldName, newName)
);

ipcMain.handle("merge_branch", (_e, repoPath: string, name: string) =>
  gitService.mergeBranch(repoPath, name)
);

ipcMain.handle("rebase_branch", (_e, repoPath: string, upstream: string) =>
  gitService.rebaseBranch(repoPath, upstream)
);

ipcMain.handle("cherry_pick", (_e, repoPath: string, commitId: string) =>
  gitService.cherryPick(repoPath, commitId)
);

ipcMain.handle("revert_commit", (_e, repoPath: string, commitId: string) =>
  gitService.revertCommit(repoPath, commitId)
);

ipcMain.handle(
  "reset_to_commit",
  (_e, repoPath: string, commitId: string, mode: "soft" | "mixed" | "hard") =>
    gitService.resetToCommit(repoPath, commitId, mode)
);

ipcMain.handle("get_status", (_e, repoPath: string) => gitService.getStatus(repoPath));

ipcMain.handle("stage_file", (_e, repoPath: string, filePath: string) =>
  gitService.stageFile(repoPath, filePath)
);

ipcMain.handle("unstage_file", (_e, repoPath: string, filePath: string) =>
  gitService.unstageFile(repoPath, filePath)
);

ipcMain.handle("stage_all", (_e, repoPath: string) => gitService.stageAll(repoPath));

ipcMain.handle("unstage_all", (_e, repoPath: string) => gitService.unstageAll(repoPath));

ipcMain.handle("commit", (_e, repoPath: string, message: string, amend: boolean) =>
  gitService.commit(repoPath, message, amend)
);

ipcMain.handle("push_remote", (_e, repoPath: string, remote?: string, branch?: string) =>
  gitService.push(repoPath, remote, branch)
);

ipcMain.handle("get_unpushed_commits", (_e, repoPath: string, remote?: string, branch?: string) =>
  gitService.getUnpushedCommits(repoPath, remote, branch)
);

ipcMain.handle("pull_remote", (_e, repoPath: string, remote?: string, rebase?: boolean) =>
  gitService.pull(repoPath, remote, rebase)
);

ipcMain.handle("fetch_remote", (_e, repoPath: string, remote?: string) =>
  gitService.fetch(repoPath, remote)
);

ipcMain.handle("fetch_all", (_e, repoPath: string) => gitService.fetchAll(repoPath));

ipcMain.handle("fetch_branch", (_e, repoPath: string, remote: string, branchName: string) =>
  gitService.fetchBranch(repoPath, remote, branchName)
);

ipcMain.handle("get_remotes", (_e, repoPath: string) => gitService.getRemotes(repoPath));

ipcMain.handle("get_stash_list", (_e, repoPath: string) => gitService.getStashList(repoPath));

ipcMain.handle("stash_save", (_e, repoPath: string, message: string, includeUntracked: boolean) =>
  gitService.stashSave(repoPath, message, includeUntracked)
);

ipcMain.handle("stash_apply", (_e, repoPath: string, index: number) =>
  gitService.stashApply(repoPath, index)
);

ipcMain.handle("stash_pop", (_e, repoPath: string, index: number) =>
  gitService.stashPop(repoPath, index)
);

ipcMain.handle("stash_drop", (_e, repoPath: string, index: number) =>
  gitService.stashDrop(repoPath, index)
);

ipcMain.handle("get_stash_files", (_e, repoPath: string, index: number) =>
  gitService.getStashFiles(repoPath, index)
);

ipcMain.handle("get_stash_file_diff", (_e, repoPath: string, index: number, filePath: string) =>
  gitService.getStashFileDiff(repoPath, index, filePath)
);

ipcMain.handle("get_blame", (_e, repoPath: string, filePath: string, commitId?: string) =>
  gitService.getBlame(repoPath, filePath, commitId)
);

ipcMain.handle("get_conflict_files", (_e, repoPath: string) =>
  gitService.getConflictFiles(repoPath)
);

ipcMain.handle("get_conflict_content", (_e, repoPath: string, filePath: string) =>
  gitService.getConflictContent(repoPath, filePath)
);

ipcMain.handle("resolve_conflict", (_e, repoPath: string, filePath: string, content: string) =>
  gitService.resolveConflict(repoPath, filePath, content)
);

ipcMain.handle("get_working_file_content", (_e, repoPath: string, filePath: string) =>
  gitService.getWorkingFileContent(repoPath, filePath)
);

ipcMain.handle("get_merge_state", (_e, repoPath: string) => gitService.getMergeState(repoPath));

ipcMain.handle(
  "continue_operation",
  (_e, repoPath: string, op: "merge" | "rebase" | "cherry-pick" | "revert") =>
    gitService.continueOperation(repoPath, op)
);

ipcMain.handle(
  "abort_operation",
  (_e, repoPath: string, op: "merge" | "rebase" | "cherry-pick" | "revert") =>
    gitService.abortOperation(repoPath, op)
);

ipcMain.handle("clone_repo", (_e, url: string, targetPath: string) =>
  gitService.cloneRepo(url, targetPath)
);

ipcMain.handle("get_file_content", (_e, repoPath: string, commitId: string, filePath: string) =>
  gitService.getFileContent(repoPath, commitId, filePath)
);

ipcMain.handle("discard_file_changes", (_e, repoPath: string, filePath: string) =>
  gitService.discardFileChanges(repoPath, filePath)
);

ipcMain.handle("get_file_diff_raw", (_e, repoPath: string, filePath: string, staged: boolean) =>
  gitService.getFileDiffRaw(repoPath, filePath, staged)
);

ipcMain.handle("delete_file", (_e, repoPath: string, filePath: string) =>
  gitService.deleteFile(repoPath, filePath)
);

ipcMain.handle("stash_file", (_e, repoPath: string, filePath: string, message?: string) =>
  gitService.stashFile(repoPath, filePath, message)
);
