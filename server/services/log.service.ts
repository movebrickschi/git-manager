import type {
  CommitInfo,
  DiffResultModel,
  FileStatus,
  GraphEdge,
  GraphRow,
  LogFilter,
  LogResult,
  ReflogEntry,
} from "../git-service.js";
import { getGit, parseDiffOutput, parseNameStatus, parseRefs, LOG_FORMAT } from "./_helpers.js";

/**
 * 提交图构建。原 O(N²) 实现使用 `activeLanes.indexOf(...)` 在 1k+ 提交时显著卡顿。
 * 改用 `lanes: (string|null)[]` + `laneByCommit: Map<commitId, col>` 双向索引：
 * - 查找 lane: O(1) Map.get
 * - 分配 lane: 优先复用第一个空闲 lane (lanes[i] === null)，减少 lane 单调增长
 * - 总复杂度 O(N * avgParents)
 */
function buildSimpleGraph(commits: CommitInfo[]): GraphRow[] {
  const rows: GraphRow[] = [];
  const lanes: (string | null)[] = [];
  const laneByCommit = new Map<string, number>();

  const allocLane = (commitId: string): number => {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) {
        lanes[i] = commitId;
        laneByCommit.set(commitId, i);
        return i;
      }
    }
    const col = lanes.length;
    lanes.push(commitId);
    laneByCommit.set(commitId, col);
    return col;
  };

  for (const commit of commits) {
    let col = laneByCommit.get(commit.id);
    if (col === undefined) col = allocLane(commit.id);
    laneByCommit.delete(commit.id);

    const edges: GraphEdge[] = [];
    const colorIdx = col % 8;

    if (commit.parents.length === 0) {
      lanes[col] = null;
    } else {
      const firstParent = commit.parents[0]!;
      lanes[col] = firstParent;
      laneByCommit.set(firstParent, col);
      edges.push({ fromCol: col, toCol: col, color: colorIdx, edgeType: "straight" });

      for (let i = 1; i < commit.parents.length; i++) {
        const parentId = commit.parents[i]!;
        let parentCol = laneByCommit.get(parentId);
        if (parentCol === undefined) parentCol = allocLane(parentId);
        edges.push({
          fromCol: col,
          toCol: parentCol,
          color: parentCol % 8,
          edgeType: "merge",
        });
      }
    }

    rows.push({ commitId: commit.id, column: col, color: colorIdx, edges });
  }
  return rows;
}

function parseLogEntries(raw: string, headBranch: string): CommitInfo[] {
  const commits: CommitInfo[] = [];
  const entries = raw
    .split("\x01")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const fields = entry.split("\x00");
    if (fields.length < 11) continue;
    const [
      id,
      shortId,
      summary,
      author,
      authorEmail,
      atStr,
      committer,
      committerEmail,
      ctStr,
      parentStr,
      refStr,
    ] = fields;
    if (!id || id.length < 7) continue;

    const parents = parentStr ? parentStr.split(" ").filter(Boolean) : [];
    commits.push({
      id,
      shortId: shortId ?? "",
      message: summary ?? "",
      summary: summary ?? "",
      author: author ?? "",
      authorEmail: authorEmail ?? "",
      authorTime: parseInt(atStr ?? "0") * 1000,
      committer: committer ?? "",
      committerEmail: committerEmail ?? "",
      commitTime: parseInt(ctStr ?? "0") * 1000,
      parents,
      refs: parseRefs(refStr ?? "", headBranch),
      isMerge: parents.length > 1,
    });
  }
  return commits;
}

export const logService = {
  async getLog(repoPath: string, filter: LogFilter): Promise<LogResult> {
    const git = getGit(repoPath);
    const branchSummary = await git.branch();
    const headBranch = branchSummary.current;

    const args: string[] = [
      `--skip=${filter.skip}`,
      `-n`,
      `${filter.limit}`,
      `--format=${LOG_FORMAT}%x01`,
    ];

    if (filter.branch) args.push(filter.branch);
    else args.push("--all");

    if (filter.author) args.push(`--author=${filter.author}`);
    if (filter.dateFrom) args.push(`--after=${filter.dateFrom}`);
    if (filter.dateTo) {
      // 纯日期 yyyy-mm-dd 补到当天 23:59:59，让 --before 包含整天的 commit
      // 否则 git 把 "2026-05-18" 解析为 "2026-05-18 00:00:00"，会漏掉当天所有 commit
      const v = /^\d{4}-\d{2}-\d{2}$/.test(filter.dateTo)
        ? `${filter.dateTo} 23:59:59`
        : filter.dateTo;
      args.push(`--before=${v}`);
    }
    if (filter.searchText) {
      if (filter.useRegex) {
        args.push(`--grep=${filter.searchText}`);
        args.push("--extended-regexp");
      } else {
        args.push(`--grep=${filter.searchText}`);
        if (!filter.matchCase) args.push("-i");
      }
    }
    if (filter.path) {
      args.push("--");
      args.push(filter.path);
    }

    const raw = await git.raw(["log", ...args]);
    const commits = parseLogEntries(raw, headBranch);
    const graphRows = buildSimpleGraph(commits);
    return { commits, graphRows };
  },

  async getCommitDetail(repoPath: string, commitId: string): Promise<CommitInfo> {
    const git = getGit(repoPath);
    const branchSummary = await git.branch();
    const DETAIL_FORMAT = LOG_FORMAT + "%x00%B";

    const raw = await git.raw(["log", "-1", `--format=${DETAIL_FORMAT}`, commitId]);
    const fields = raw.trim().split("\x00");
    const id = fields[0] ?? "";
    const shortId = fields[1] ?? "";
    const summary = fields[2] ?? "";
    const author = fields[3] ?? "";
    const authorEmail = fields[4] ?? "";
    const authorTime = parseInt(fields[5] ?? "0") * 1000;
    const committer = fields[6] ?? "";
    const committerEmail = fields[7] ?? "";
    const commitTime = parseInt(fields[8] ?? "0") * 1000;
    const parentStr = fields[9] ?? "";
    const refStr = fields[10] ?? "";
    const body = (fields.slice(11).join("\x00") ?? "").trim();
    const message = body || summary;

    const parents = parentStr ? parentStr.split(" ").filter(Boolean) : [];
    return {
      id,
      shortId,
      message,
      summary,
      author,
      authorEmail,
      authorTime,
      committer,
      committerEmail,
      commitTime,
      parents,
      refs: parseRefs(refStr, branchSummary.current),
      isMerge: parents.length > 1,
    };
  },

  async getCommitFiles(repoPath: string, commitId: string): Promise<FileStatus[]> {
    const git = getGit(repoPath);
    const raw = await git.raw(["diff-tree", "--no-commit-id", "-r", "--name-status", commitId]);
    return parseNameStatus(raw);
  },

  async getCommitDiff(
    repoPath: string,
    commitId: string,
    filePath: string
  ): Promise<DiffResultModel> {
    const git = getGit(repoPath);
    const raw = await git
      .raw(["diff", `${commitId}~1`, commitId, "--", filePath])
      .catch(() => git.raw(["diff", "--root", commitId, "--", filePath]));
    return parseDiffOutput(raw, filePath);
  },

  async getFileDiff(
    repoPath: string,
    filePath: string,
    staged: boolean
  ): Promise<DiffResultModel> {
    const git = getGit(repoPath);
    const args = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];
    const raw = await git.raw(args);
    return parseDiffOutput(raw, filePath);
  },

  async compareCommits(
    repoPath: string,
    fromId: string,
    toId: string
  ): Promise<FileStatus[]> {
    const git = getGit(repoPath);
    const raw = await git.raw(["diff", "--name-status", fromId, toId]);
    return parseNameStatus(raw);
  },

  async getFileContent(
    repoPath: string,
    commitId: string,
    filePath: string
  ): Promise<string> {
    const git = getGit(repoPath);
    return git.raw(["show", `${commitId}:${filePath}`]);
  },

  async getFileDiffRaw(
    repoPath: string,
    filePath: string,
    staged: boolean
  ): Promise<string> {
    const git = getGit(repoPath);
    const args = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];
    return git.raw(args);
  },

  /**
   * 读取 HEAD 的 reflog，最多 limit 条（默认 200）。
   * 每行：%H|%h|%gd|%gs|%s|%at（以 \x00 分隔以避免 message 内的 `|` 误匹配）。
   * 失败（仓库无 reflog / 空仓库）→ 返回空数组而不是 throw。
   */
  async getReflog(repoPath: string, limit = 200): Promise<ReflogEntry[]> {
    const git = getGit(repoPath);
    const sep = "\x00";
    const fmt = `%H${sep}%h${sep}%gd${sep}%gs${sep}%s${sep}%at`;
    try {
      const raw = await git.raw([
        "reflog",
        "show",
        "HEAD",
        `--format=${fmt}`,
        "-n",
        String(Math.max(1, Math.min(limit, 5000))),
      ]);
      if (!raw.trim()) return [];
      const entries: ReflogEntry[] = [];
      const lines = raw.trim().split("\n");
      for (let i = 0; i < lines.length; i++) {
        const parts = lines[i]!.split(sep);
        if (parts.length < 6) continue;
        entries.push({
          index: i,
          commitId: parts[0] ?? "",
          shortId: parts[1] ?? "",
          ref: parts[2] ?? "",
          action: parts[3] ?? "",
          subject: parts[4] ?? "",
          time: parseInt(parts[5] ?? "0") * 1000,
        });
      }
      return entries;
    } catch {
      return [];
    }
  },
};
