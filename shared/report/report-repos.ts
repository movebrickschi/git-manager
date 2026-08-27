/**
 * 日报仓库勾选列表：已打开 tab ∪ 最近打开，勾选是独立多选。
 *
 * 纯函数，三端共用；禁止 import node-only / browser-only API。
 */

export interface ReportRepoOption {
  path: string;
  name: string;
  color: string;
  /** 当前是否作为仓库 tab 打开。 */
  open: boolean;
}

const REPO_COLORS = [
  "#d73a49",
  "#22863a",
  "#b08800",
  "#0366d6",
  "#6f42c1",
  "#0086b3",
  "#cb2431",
  "#188038",
];

export function repoDisplayName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function colorForPath(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = (hash * 31 + path.charCodeAt(i)) >>> 0;
  }
  return REPO_COLORS[hash % REPO_COLORS.length] ?? REPO_COLORS[0]!;
}

export function buildReportRepoOptions(input: {
  openRepos: Array<{ path: string; name: string; color: string }>;
  recentRepos: Array<{ path: string }>;
}): ReportRepoOption[] {
  const seen = new Set<string>();
  const out: ReportRepoOption[] = [];

  for (const repo of input.openRepos) {
    if (!repo.path || seen.has(repo.path)) continue;
    seen.add(repo.path);
    out.push({
      path: repo.path,
      name: repo.name || repoDisplayName(repo.path),
      color: repo.color || colorForPath(repo.path),
      open: true,
    });
  }

  for (const repo of input.recentRepos) {
    if (!repo.path || seen.has(repo.path)) continue;
    seen.add(repo.path);
    out.push({
      path: repo.path,
      name: repoDisplayName(repo.path),
      color: colorForPath(repo.path),
      open: false,
    });
  }

  return out;
}

/** 勾选/取消某个仓库；绝不把其它已选项清掉。 */
export function toggleRepoSelection(
  selected: readonly string[],
  path: string,
  checked: boolean
): string[] {
  const set = new Set(selected);
  if (checked) set.add(path);
  else set.delete(path);
  return [...set];
}

/**
 * 首次进入日报时的默认勾选：
 * 1. 持久化里仍可选的路径
 * 2. 否则全部已打开仓库（不是只勾当前激活 tab）
 */
export function defaultSelectedRepos(input: {
  openPaths: readonly string[];
  availablePaths: readonly string[];
  persisted: readonly string[] | null;
}): string[] {
  const available = new Set(input.availablePaths);
  if (input.persisted && input.persisted.length > 0) {
    const kept = input.persisted.filter((p) => available.has(p));
    if (kept.length > 0) return [...new Set(kept)];
  }
  return input.openPaths.filter((p) => available.has(p));
}
