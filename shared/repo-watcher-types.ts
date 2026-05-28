/**
 * RepoWatcherEvent · 主进程 → 渲染进程的"仓库变化"事件 payload。
 *
 * 三端共享类型。
 * 与 electron/repo-watcher.ts 中的同名 interface 保持一致；
 * 这里再定义一份是为了让前端不引 electron 内部模块也能拿到类型。
 */
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
   *  - "merge" 半成态文件改了 → 重判 mergeState + 重拉 status
   */
  kind: "work" | "index" | "head" | "merge";
}
