/**
 * RepoWatcherEvent · 主进程 → 渲染进程的"仓库变化"事件 payload。
 *
 * 三端共享类型。
 * Electron、Web 服务端和前端都从这里获取事件类型与路径分类规则。
 */
export type RepoWatcherEventKind =
  | "work"
  | "index"
  | "head"
  | "refs"
  | "stash"
  | "merge"
  | "config"
  | "hooks"
  | "worktree"
  | "submodule";

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
   *  - "stash" refs/stash 或对应 reflog 改了 → 只刷新已打开的 stash 视图
   *  - "merge" 半成态文件改了 → 重判 mergeState + 重拉 status
   *  - "config" 仓库配置改了 → 刷新远端/集成信息
   *  - "hooks" hooks 目录改了 → 只刷新已打开的 hooks 弹窗
   *  - "worktree" common-dir/worktrees 改了 → 只刷新已打开的 worktree 弹窗
   *  - "submodule" .gitmodules 或 modules 元数据改了 → 刷新子模块状态
   */
  kind: RepoWatcherEventKind;
  /** `.gitmodules` 等改变 watcher 入口的文件发生变化时，请 transport 重建监听上下文。 */
  requiresContextRefresh?: boolean;
}

function normalizeWatcherPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^\.git\//, "");
}

/**
 * 将相对实际 git-dir / common-dir 的路径归类。
 *
 * linked worktree 的元数据不在工作区的 `.git/` 目录下，因此不能继续依赖
 * `path.relative(repoPath, filePath)`。Electron 与 Web watcher 解析真实目录后都走
 * 这一个分类器，确保普通仓库和 linked worktree 行为一致。
 */
export function classifyGitMetadataPath(relativePath: string): RepoWatcherEventKind {
  const rel = normalizeWatcherPath(relativePath);

  if (
    rel === "refs/stash" ||
    rel === "refs/stash.lock" ||
    rel === "logs/refs/stash" ||
    rel === "logs/refs/stash.lock"
  ) {
    return "stash";
  }
  if (rel === "HEAD" || rel === "HEAD.lock") return "head";
  if (rel === "index" || rel === "index.lock") return "index";
  if (
    rel === "MERGE_HEAD" ||
    rel === "MERGE_MSG" ||
    rel === "MERGE_MODE" ||
    rel === "AUTO_MERGE" ||
    rel === "REBASE_HEAD" ||
    rel === "CHERRY_PICK_HEAD" ||
    rel === "REVERT_HEAD" ||
    rel === "rebase-merge" ||
    rel.startsWith("rebase-merge/") ||
    rel === "rebase-apply" ||
    rel.startsWith("rebase-apply/") ||
    rel === "sequencer" ||
    rel.startsWith("sequencer/")
  ) {
    return "merge";
  }
  if (
    rel === "config" ||
    rel === "config.lock" ||
    rel === "config.worktree" ||
    rel === "config.worktree.lock" ||
    rel === "remotes" ||
    rel.startsWith("remotes/") ||
    rel === "branches" ||
    rel.startsWith("branches/")
  ) {
    return "config";
  }
  if (rel === "hooks" || rel.startsWith("hooks/")) return "hooks";
  if (rel === "modules" || rel.startsWith("modules/")) return "submodule";
  if (rel === "locked" || rel === "gitdir" || rel === "commondir") return "worktree";
  if (rel === "worktrees" || rel.startsWith("worktrees/")) return "worktree";
  if (
    rel.startsWith("refs/") ||
    rel === "logs/HEAD" ||
    rel.startsWith("logs/refs/") ||
    rel === "FETCH_HEAD" ||
    rel === "FETCH_HEAD.lock" ||
    rel === "ORIG_HEAD" ||
    rel === "ORIG_HEAD.lock" ||
    rel === "packed-refs" ||
    rel === "packed-refs.lock"
  ) {
    return "refs";
  }
  return "work";
}

/**
 * 将相对仓库根目录的路径归类为刷新事件。
 * 调用方可以传 Windows 或 POSIX 分隔符，避免 Electron 与 Web 端各维护一份规则。
 */
export function classifyRepoWatcherPath(relativePath: string): RepoWatcherEventKind {
  const rel = relativePath.replace(/\\/g, "/");

  if (rel === ".gitmodules" || rel === ".gitmodules.lock") return "submodule";
  if (rel === ".git" || !rel.startsWith(".git/")) return "work";
  return classifyGitMetadataPath(rel);
}
