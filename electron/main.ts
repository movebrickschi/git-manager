import { app, BrowserWindow, ipcMain, dialog, session, shell, Menu } from "electron";
import { promises as fs } from "fs";
import * as path from "path";
import { gitService } from "../server/git-service";
import { COMMANDS } from "../shared/command-manifest";
import { registerAiHandlers } from "./ai-handlers";
import { registerReportHandlers } from "./report-handlers";
import { attachRepoWatcherToWebContents } from "./repo-watcher";
import { setupElectronCredentialStorage } from "./credential-store";

let mainWindow: BrowserWindow | null = null;
let repoWatcher: ReturnType<typeof attachRepoWatcherToWebContents> | null = null;

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

/**
 * 注册带标准编辑角色的应用菜单。
 *
 * 关键：Electron 里 Ctrl+C/X/V、Ctrl+A、撤销/重做这些加速键是绑定在应用菜单的
 * role 上的；不注册菜单 → 加速键无人处理 → 复制粘贴整体失效。窗口用的是自定义
 * 标题栏（titleBarStyle: hidden），配合 autoHideMenuBar 让菜单栏默认不可见
 * （Windows/Linux 按 Alt 临时唤出），加速键全程有效；macOS 照常显示全局菜单栏。
 */
function installAppMenu() {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: "appMenu" }] as Electron.MenuItemConstructorOptions[]) : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * 给 webContents 接上原生右键菜单。Electron 桌面应用默认没有网页右键菜单，必须
 * 监听 context-menu 事件手动弹出。按右键位置是否可编辑 / 是否有选中文本给出不同
 * 菜单项（全部用内置 role，自带剪贴板能力且自动本地化）。
 */
function attachContextMenu(wc: Electron.WebContents) {
  wc.on("context-menu", (_event, params) => {
    const hasSelection = params.selectionText.trim().length > 0;
    let template: Electron.MenuItemConstructorOptions[];
    if (params.isEditable) {
      template = [
        { role: "undo", enabled: params.editFlags.canUndo },
        { role: "redo", enabled: params.editFlags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll" },
      ];
    } else if (hasSelection) {
      template = [{ role: "copy" }];
    } else {
      return;
    }
    const win = BrowserWindow.fromWebContents(wc) ?? undefined;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Git Manager",
    backgroundColor: "#1a1b23",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#22242e",
      symbolColor: "#d1d5e0",
      height: 36,
    },
    autoHideMenuBar: true,
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
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    // dev 下 electron 可能先于 Vite dev server ready 启动；loadURL 失败时短间隔重试，避免白屏。
    const loadDevServer = () => {
      mainWindow?.loadURL(devUrl).catch(() => {
        setTimeout(loadDevServer, 300);
      });
    };
    loadDevServer();
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

  attachContextMenu(mainWindow.webContents);

  repoWatcher = attachRepoWatcherToWebContents(mainWindow.webContents);

  mainWindow.on("closed", () => {
    if (repoWatcher) {
      void repoWatcher.dispose();
      repoWatcher = null;
    }
    mainWindow = null;
  });
}

ipcMain.handle("repo:watch", async (_e, repoPath: unknown, force: unknown = false) => {
  if (!repoWatcher) return;
  if (repoPath !== null && typeof repoPath !== "string") {
    throw new Error("INVALID_REPO_PATH: must be string or null");
  }
  if (typeof force !== "boolean") {
    throw new Error("INVALID_FORCE: must be boolean");
  }
  await repoWatcher.manager.setRepo(repoPath as string | null, force);
});

app.whenReady().then(() => {
  setupElectronCredentialStorage();
  installCsp();
  installAppMenu();
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

ipcMain.handle("titlebar:set-theme", (_e, isDark: boolean) => {
  if (!mainWindow) return;
  mainWindow.setTitleBarOverlay({
    color: isDark ? "#22242e" : "#ffffff",
    symbolColor: isDark ? "#d1d5e0" : "#1f2937",
    height: 36,
  });
  mainWindow.setBackgroundColor(isDark ? "#1a1b23" : "#f8f9fc");
});

ipcMain.handle("dialog:openDirectory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "选择 Git 仓库",
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

/**
 * 在系统文件管理器中定位并选中给定路径。
 * - Windows：资源管理器
 * - macOS：Finder
 * - Linux：默认文件管理器
 *
 * 安全：要求绝对路径，且必须真实存在；目录/文件均接受。
 * 路径不存在或参数非法时回 INVALID_PATH，主进程不会崩。
 */
ipcMain.handle("system:reveal_in_folder", async (_e, absPath: unknown) => {
  if (typeof absPath !== "string" || absPath.length === 0) {
    throw new Error("INVALID_PATH: absPath must be a non-empty string");
  }
  if (!path.isAbsolute(absPath)) {
    throw new Error(`INVALID_PATH: not absolute: ${absPath}`);
  }
  // Windows 下 shell.showItemInFolder 遇正斜杠路径会静默失效（electron/electron#11617），
  // 必须先规范化为原生分隔符；mac/Linux 上 path.normalize 保持正斜杠不变。
  const nativePath = path.normalize(absPath);
  try {
    await fs.access(nativePath);
  } catch {
    throw new Error(`INVALID_PATH: not found: ${nativePath}`);
  }
  shell.showItemInFolder(nativePath);
});

for (const spec of COMMANDS) {
  const handler = (gitService as unknown as Record<string, (...args: unknown[]) => unknown>)[
    spec.method
  ];
  if (typeof handler !== "function") {
    console.error(`[ipc-bind] gitService.${spec.method} is not a function; skip ${spec.ipc}`);
    continue;
  }
  ipcMain.handle(spec.ipc, async (_e, ...args: unknown[]) => {
    try {
      return await handler.call(gitService, ...args);
    } catch (err) {
      // packaged app 没有 stderr 直接可见，但 console.error 会写入 OS 事件日志 + dev tools
      console.error(`[ipc:${spec.ipc}]`, err);
      throw err;
    }
  });
}

registerAiHandlers();
registerReportHandlers();

