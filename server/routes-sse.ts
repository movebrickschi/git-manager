/**
 * SSE Routes · Server-Sent Events 推送仓库变化给 Web 模式前端
 *
 * 设计：
 *   GET /api/repo/events?repoPath=<encoded>
 *     - 建立长连接，按 repoPath 启 chokidar watcher
 *     - 文件变化 debounce 500ms 后推 `event: repo-changed` 数据
 *     - 客户端断开（res.close）→ 释放 watcher + timer
 *
 *   不做"多连接共享 watcher"优化：Web 模式预期单用户场景，per-connection
 *   一个 watcher 更易释放、内存占用可预测。
 *
 * 安全：
 *   - repoPath 由前端传入，未做白名单（与 git API 同信任面）
 *   - chokidar 只读，无写副作用
 *   - 默认 ignored 与 electron/repo-watcher.ts 保持一致
 */
import { Router, Request, Response } from "express";
import { watch, FSWatcher } from "chokidar";
import { type RepoWatcherEventKind } from "../shared/repo-watcher-types.js";
import {
  classifyRepoWatchFile,
  createRepoWatchIgnoredPredicate,
  repoWatchFileRequiresContextRefresh,
  resolveRepoWatchContext,
} from "./services/_helpers.js";

const router = Router();

const DEBOUNCE_MS = 500;

function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.get("/repo/events", async (req: Request, res: Response) => {
  const repoPath = typeof req.query.repoPath === "string" ? req.query.repoPath : "";
  if (!repoPath) {
    res.status(400).json({ error: "MISSING_REPO_PATH" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // SSE 在反代后常因 buffering 被掐掉，加 nginx 专用头
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let watcher: FSWatcher | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let settleReadyWait: (() => void) | null = null;
  let closed = false;
  const debounceTimers = new Map<RepoWatcherEventKind, NodeJS.Timeout>();
  const contextRefreshKinds = new Set<RepoWatcherEventKind>();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
    for (const t of debounceTimers.values()) clearTimeout(t);
    debounceTimers.clear();
    contextRefreshKinds.clear();
    settleReadyWait?.();
    settleReadyWait = null;
    if (watcher) {
      void watcher.close().catch(() => {});
      watcher = null;
    }
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
  res.on("close", cleanup);

  const scheduleEmit = (kind: RepoWatcherEventKind, requiresContextRefresh = false) => {
    if (closed) return;
    if (requiresContextRefresh) contextRefreshKinds.add(kind);
    const existing = debounceTimers.get(kind);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(kind);
      if (closed || res.writableEnded) return;
      writeSseEvent(res, "repo-changed", {
        repoPath,
        at: Date.now(),
        kind,
        ...(contextRefreshKinds.delete(kind) ? { requiresContextRefresh: true } : {}),
      });
    }, DEBOUNCE_MS);
    debounceTimers.set(kind, timer);
  };

  try {
    const context = await resolveRepoWatchContext(repoPath);
    if (closed) return;

    watcher = watch(context.watchPaths, {
      ignored: createRepoWatchIgnoredPredicate(context),
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    watcher.on("all", (_event: string, filePath: string) => {
      scheduleEmit(
        classifyRepoWatchFile(context, filePath),
        repoWatchFileRequiresContextRefresh(context, filePath)
      );
    });

    watcher.on("error", (err: unknown) => {
      console.warn(`[sse] watcher error on ${repoPath}:`, err);
      if (!closed && !res.writableEnded) {
        writeSseEvent(res, "error", { message: err instanceof Error ? err.message : String(err) });
      }
    });

    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        watcher?.off("ready", settle);
        if (settleReadyWait === settle) settleReadyWait = null;
        resolve();
      };
      settleReadyWait = settle;
      watcher!.once("ready", settle);
    });
    if (closed || res.writableEnded) return;
    writeSseEvent(res, "ready", { repoPath, at: Date.now() });
  } catch (e) {
    if (closed) return;
    console.error(`[sse] failed to watch ${repoPath}:`, e);
    writeSseEvent(res, "error", { message: e instanceof Error ? e.message : String(e) });
    res.end();
    return;
  }

  // 保活 ping，避免某些代理 60s 超时
  keepAlive = setInterval(() => {
    if (closed || res.writableEnded) return;
    res.write(": keep-alive\n\n");
  }, 30_000);
});

export default router;
