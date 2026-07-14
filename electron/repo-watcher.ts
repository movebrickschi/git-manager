/**
 * Repo File System Watcher · 自动检测工作区/索引变化并通知渲染进程
 *
 * 解决的问题：
 *   用户在外部 IDE（VS Code / IDEA）改了仓库内文件，Git Manager 由于没有
 *   监听机制，必须手动点"刷新"或切 tab 才能看到新变更——体感上像静态快照。
 *
 * 实现策略：
 *   1. 监听工作区以及 rev-parse 解析出的实际 git-dir / common-dir；linked worktree
 *      的元数据位于主工作树 .git/worktrees 下，也能完整接收
 *   2. 忽略对象库等高噪声目录，保留 HEAD / index / refs / config / hooks /
 *      stash reflog / merge 与 rebase 半成态信号
 *   3. debounce 500ms：避免编辑器保存触发的 add/change/unlink 风暴
 *   4. 单仓库单 watcher，切仓库时关旧的；窗口关闭时全清
 *   5. 默认 ignored 还排除 node_modules / .DS_Store 等高噪声目录
 *
 * chokidar 5.x 加载策略：
 *   chokidar 5.x 是 ESM-only 包，Electron 主进程编译目标是 CommonJS，
 *   require("chokidar") 会触发 ERR_REQUIRE_ESM。改用 dynamic `await import()`，
 *   首次 setRepo 时按需加载并缓存模块引用，后续切仓库零开销。
 *
 * 安全：
 *   - chokidar 自身只读，不写文件
 *   - 监听器在 setRepo(null) 或 closeAll() 后释放，避免 memory leak
 */
import type { FSWatcher } from "chokidar";
import type { WebContents } from "electron";
import type { RepoWatcherEvent } from "../shared/repo-watcher-types";
import {
  classifyRepoWatchFile,
  createRepoWatchIgnoredPredicate,
  repoWatchFileRequiresContextRefresh,
  resolveRepoWatchContext,
} from "../server/services/_helpers";

type ChokidarModule = typeof import("chokidar");

/**
 * TS 在 module=CommonJS 下会把字面量 `import("chokidar")` 编译为
 * `Promise.resolve().then(() => require("chokidar"))`，对纯 ESM 包仍会触发
 * ERR_REQUIRE_ESM。用 Function 构造器在运行时构造原生 import，绕过 tsc 改写。
 *
 * Node 20+（Electron 33 内置）原生支持 dynamic import ESM 模块，这是官方推荐
 * 的"CJS 加载 ESM"模式。
 */
const dynamicImport = new Function(
  "specifier",
  "return import(specifier)"
) as <T = unknown>(specifier: string) => Promise<T>;

let chokidarModPromise: Promise<ChokidarModule> | null = null;
function loadChokidar(): Promise<ChokidarModule> {
  if (!chokidarModPromise) {
    chokidarModPromise = dynamicImport<ChokidarModule>("chokidar");
  }
  return chokidarModPromise;
}

const DEBOUNCE_MS = 500;

export type RepoWatcherCallback = (e: RepoWatcherEvent) => void;

export class RepoWatcherManager {
  private watcher: FSWatcher | null = null;
  private currentRepo: string | null = null;
  private debounceTimers = new Map<RepoWatcherEvent["kind"], NodeJS.Timeout>();
  private contextRefreshKinds = new Set<RepoWatcherEvent["kind"]>();
  private listeners = new Set<RepoWatcherCallback>();
  private generation = 0;
  private settleReadyWait: (() => void) | null = null;

  /** 切到新仓库（同路径默认复用）；force 用于 config 变化后重新解析 hooks 等动态路径。 */
  async setRepo(repoPath: string | null, force = false): Promise<void> {
    if (!force && repoPath === this.currentRepo && this.watcher) return;
    const generation = ++this.generation;
    await this.closeWatcher();
    if (generation !== this.generation) return;
    if (!repoPath) return;

    try {
      const context = await resolveRepoWatchContext(repoPath);
      if (generation !== this.generation) return;
      const { watch } = await loadChokidar();
      if (generation !== this.generation) return;

      const watcher = watch(context.watchPaths, {
        ignored: createRepoWatchIgnoredPredicate(context),
        ignoreInitial: true,
        persistent: true,
        // depth: 不限，由 ignored 控制深度
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      });

      if (generation !== this.generation) {
        await watcher.close();
        return;
      }
      this.currentRepo = repoPath;
      this.watcher = watcher;

      const ready = new Promise<void>((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          watcher.off("ready", settle);
          if (this.settleReadyWait === settle) this.settleReadyWait = null;
          resolve();
        };
        this.settleReadyWait = settle;
        watcher.once("ready", settle);
      });

      watcher.on("all", (_event: string, filePath: string) => {
        if (generation !== this.generation) return;
        this.scheduleEmit(
          classifyRepoWatchFile(context, filePath),
          repoPath,
          generation,
          repoWatchFileRequiresContextRefresh(context, filePath)
        );
      });
      watcher.on("error", (err: unknown) => {
        console.warn(`[repo-watcher] error on ${repoPath}:`, err);
      });
      await ready;
    } catch (e) {
      if (generation !== this.generation) return;
      console.error(`[repo-watcher] failed to watch ${repoPath}:`, e);
      this.currentRepo = null;
      this.watcher = null;
    }
  }

  on(cb: RepoWatcherCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async close(): Promise<void> {
    this.generation += 1;
    await this.closeWatcher();
  }

  private async closeWatcher(): Promise<void> {
    this.settleReadyWait?.();
    this.settleReadyWait = null;
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    this.contextRefreshKinds.clear();
    if (this.watcher) {
      try {
        await this.watcher.close();
      } catch (e) {
        console.warn("[repo-watcher] close failed:", e);
      }
      this.watcher = null;
    }
    this.currentRepo = null;
  }

  private scheduleEmit(
    kind: RepoWatcherEvent["kind"],
    repoPath: string,
    generation: number,
    requiresContextRefresh = false
  ): void {
    if (requiresContextRefresh) this.contextRefreshKinds.add(kind);
    const existing = this.debounceTimers.get(kind);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(kind);
      if (generation !== this.generation || this.currentRepo !== repoPath) return;
      const payload: RepoWatcherEvent = {
        repoPath,
        at: Date.now(),
        kind,
        ...(this.contextRefreshKinds.delete(kind) ? { requiresContextRefresh: true } : {}),
      };
      for (const cb of this.listeners) {
        try {
          cb(payload);
        } catch (e) {
          console.warn("[repo-watcher] listener throw:", e);
        }
      }
    }, DEBOUNCE_MS);
    this.debounceTimers.set(kind, timer);
  }
}

/**
 * 把 watcher 事件桥接到 BrowserWindow.webContents。
 * 关闭窗口时务必调 dispose() 释放 watcher。
 */
export function attachRepoWatcherToWebContents(wc: WebContents): {
  manager: RepoWatcherManager;
  dispose: () => Promise<void>;
} {
  const manager = new RepoWatcherManager();
  const off = manager.on((e) => {
    if (wc.isDestroyed()) return;
    wc.send("repo:changed", e);
  });
  return {
    manager,
    dispose: async () => {
      off();
      await manager.close();
    },
  };
}
