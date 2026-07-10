/**
 * RepoWatcherEvent · 主进程 → 渲染进程的"仓库变化"事件 payload。
 *
 * 三端共享类型。
 * Electron、Web 服务端和前端都从这里获取事件类型与路径分类规则。
 */
export type RepoWatcherEventKind = "work" | "index" | "head" | "refs" | "merge";

export interface RepoWatcherEvent {
  /** 监听变化的仓库根路径（绝对路径）。 */
  repoPath: string;
  /** 触发时间戳（ms）。用于前端可选 dedup。 */
  at: number;
  /**
   * 变化粒度：
   *  - "work"  工作区文件改了 → 重拉 status
   *  - "index" .git/index 改了 → 暂存区变化，重拉 status
   *  - "head"  .git/HEAD 改了 → 外部 checkout / branch 切换，重拉 branches + log + status
   *  - "refs"  本地/远端/标签引用改了 → 外部 commit / fetch / pull / push，重拉 branches + log + status
   *  - "merge" 半成态文件改了 → 重判 mergeState + 重拉 status
   */
  kind: RepoWatcherEventKind;
}

/**
 * 将相对仓库根目录的路径归类为刷新事件。
 * 调用方可以传 Windows 或 POSIX 分隔符，避免 Electron 与 Web 端各维护一份规则。
 */
export function classifyRepoWatcherPath(relativePath: string): RepoWatcherEventKind {
  const rel = relativePath.replace(/\\/g, "/");

  if (rel === ".git/HEAD" || rel === ".git/HEAD.lock") return "head";
  if (rel === ".git/index" || rel === ".git/index.lock") return "index";
  if (
    rel === ".git/MERGE_HEAD" ||
    rel === ".git/CHERRY_PICK_HEAD" ||
    rel === ".git/REVERT_HEAD" ||
    rel.startsWith(".git/rebase-merge/") ||
    rel.startsWith(".git/rebase-apply/")
  ) {
    return "merge";
  }
  if (
    rel.startsWith(".git/refs/") ||
    rel === ".git/FETCH_HEAD" ||
    rel === ".git/FETCH_HEAD.lock" ||
    rel === ".git/ORIG_HEAD" ||
    rel === ".git/ORIG_HEAD.lock" ||
    rel === ".git/packed-refs" ||
    rel === ".git/packed-refs.lock"
  ) {
    return "refs";
  }
  return "work";
}
