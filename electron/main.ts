import { app, BrowserWindow, ipcMain, dialog, session, shell } from "electron";
import * as path from "path";
import { gitService } from "../server/git-service";
import { COMMANDS } from "../shared/command-manifest";
import { registerAiHandlers } from "./ai-handlers";

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

