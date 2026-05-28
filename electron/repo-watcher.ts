/**
 * Repo File System Watcher · 自动检测工作区/索引变化并通知渲染进程
 *
 * 解决的问题：
 *   用户在外部 IDE（VS Code / IDEA）改了仓库内文件，Git Manager 由于没有
 *   监听机制，必须手动点"刷新"或切 tab 才能看到新变更——体感上像静态快照。
 *
 * 实现策略：
 *   1. 监听 repo 根目录全树，但忽略 .git/objects、.git/refs/{heads,remotes}、
 *      .git/logs（git 自身写入频率高、噪声大），保留 .git/HEAD / .git/index / .git/MERGE_HEAD
 *      （分支切换、暂存区变化、merge 半成态变化都靠它们驱动）
 *   2. debounce 500ms：避免编辑器保存触发的 add/change/unlink 风暴
 *   3. 单仓库单 watcher，切仓库时关旧的；窗口关闭时全清
 *   4. 默认 ignored 还排除 node_modules / .DS_Store 等高噪声目录
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
import * as path from "path";
import type { FSWatcher } from "chokidar";
import type { WebContents } from "electron";

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

const ALWAYS_IGNORED = [
  /(^|[\\/])\.git[\\/]objects([\\/]|$)/,
  /(^|[\\/])\.git[\\/]refs[\\/](heads|remotes|tags)([\\/]|$)/,
  /(^|[\\/])\.git[\\/]logs([\\/]|$)/,
  /(^|[\\/])\.git[\\/]hooks([\\/]|$)/,
  /(^|[\\/])\.git[\\/](FETCH_HEAD|ORIG_HEAD|packed-refs)$/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])(dist|dist-electron|dist-server|build|release)([\\/]|$)/,
  /(^|[\\/])\.DS_Store$/,
  /(^|[\\/])Thumbs\.db$/,
];

export interface RepoWatcherEvent {
  /** 监听变化的仓库根路径（与 setRepo 入参一致） */
  repoPath: string;
  /** 触发时间戳，方便前端 dedup（如果在 IPC 缓冲里堆了两条相邻事件） */
  at: number;
  /**
   * 变化粒度：
   *  - "work"  工作区文件改了（最常见，需重新拉 status / diff）
   *  - "index" .git/index 改了（暂存区变更，stage/unstage 的外部触发）
   *  - "head"  .git/HEAD 改了（外部 checkout / branch 切换）
   *  - "merge" .git/MERGE_HEAD 等半成态文件改了（外部 git merge / rebase）
   */
  kind: "work" | "index" | "head" | "merge";
}

export type RepoWatcherCallback = (e: RepoWatcherEvent) => void;

export class RepoWatcherManager {
  private watcher: FSWatcher | null = null;
  private currentRepo: string | null = null;
  private debounceTimers = new Map<RepoWatcherEvent["kind"], NodeJS.Timeout>();
  private listeners = new Set<RepoWatcherCallback>();

  /** 切到新仓库（同路径直接复用）。传 null 表示停止监听。 */
  async setRepo(repoPath: string | null): Promise<void> {
    if (repoPath === this.currentRepo) return;
    await this.close();
    if (!repoPath) return;

    this.currentRepo = repoPath;
    try {
      const { watch } = await loadChokidar();
      this.watcher = watch(repoPath, {
        ignored: (file: string) => ALWAYS_IGNORED.some((re) => re.test(file)),
        ignoreInitial: true,
        persistent: true,
        // depth: 不限，由 ignored 控制深度
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      });

      this.watcher.on("all", (_event: string, filePath: string) => {
        const kind = classify(repoPath, filePath);
        this.scheduleEmit(kind);
      });
      this.watcher.on("error", (err: unknown) => {
        console.warn(`[repo-watcher] error on ${repoPath}:`, err);
      });
    } catch (e) {
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
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
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

  private scheduleEmit(kind: RepoWatcherEvent["kind"]): void {
    const existing = this.debounceTimers.get(kind);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(kind);
      if (!this.currentRepo) return;
      const payload: RepoWatcherEvent = {
        repoPath: this.currentRepo,
        at: Date.now(),
        kind,
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

function classify(repoPath: string, file: string): RepoWatcherEvent["kind"] {
  const rel = path.relative(repoPath, file).replace(/\\/g, "/");
  if (rel === ".git/HEAD") return "head";
  if (rel === ".git/index") return "index";
  if (
    rel === ".git/MERGE_HEAD" ||
    rel === ".git/CHERRY_PICK_HEAD" ||
    rel === ".git/REVERT_HEAD" ||
    rel.startsWith(".git/rebase-merge/") ||
    rel.startsWith(".git/rebase-apply/")
  ) {
    return "merge";
  }
  return "work";
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
