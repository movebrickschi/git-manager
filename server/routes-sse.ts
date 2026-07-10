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
import * as path from "node:path";
import { makeIgnoredPredicate } from "../shared/repo-watcher-ignored.js";
import {
  classifyRepoWatcherPath,
  type RepoWatcherEventKind,
} from "../shared/repo-watcher-types.js";

const router = Router();

const DEBOUNCE_MS = 500;
const IGNORED_PREDICATE = makeIgnoredPredicate();

function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.get("/repo/events", (req: Request, res: Response) => {
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

  writeSseEvent(res, "ready", { repoPath, at: Date.now() });

  let watcher: FSWatcher | null = null;
  const debounceTimers = new Map<RepoWatcherEventKind, NodeJS.Timeout>();

  const scheduleEmit = (kind: RepoWatcherEventKind) => {
    const existing = debounceTimers.get(kind);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(kind);
      if (res.writableEnded) return;
      writeSseEvent(res, "repo-changed", { repoPath, at: Date.now(), kind });
    }, DEBOUNCE_MS);
    debounceTimers.set(kind, timer);
  };

  try {
    watcher = watch(repoPath, {
      ignored: IGNORED_PREDICATE,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    watcher.on("all", (_event: string, filePath: string) => {
      scheduleEmit(classifyRepoWatcherPath(path.relative(repoPath, filePath)));
    });

    watcher.on("error", (err: unknown) => {
      console.warn(`[sse] watcher error on ${repoPath}:`, err);
      if (!res.writableEnded) {
        writeSseEvent(res, "error", { message: err instanceof Error ? err.message : String(err) });
      }
    });
  } catch (e) {
    console.error(`[sse] failed to watch ${repoPath}:`, e);
    writeSseEvent(res, "error", { message: e instanceof Error ? e.message : String(e) });
    res.end();
    return;
  }

  // 保活 ping，避免某些代理 60s 超时
  const keepAlive = setInterval(() => {
    if (res.writableEnded) return;
    res.write(": keep-alive\n\n");
  }, 30_000);

  const cleanup = () => {
    clearInterval(keepAlive);
    for (const t of debounceTimers.values()) clearTimeout(t);
    debounceTimers.clear();
    if (watcher) {
      void watcher.close().catch(() => {});
      watcher = null;
    }
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
  res.on("close", cleanup);
});

export default router;
