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
import {
  buildUntrackedDiff,
  getGit,
  parseDiffOutput,
  recoverMisdetectedBinaryDiff,
  parseNameStatus,
  parseRefs,
  errStr,
  LOG_FORMAT,
} from "./_helpers.js";

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
    // 仅需当前 HEAD 分支名给 parseRefs 标记 isHead。用轻量 rev-parse（O(1) 读 .git/HEAD）
    // 取代 git.branch()——后者会枚举所有本地+远程分支，多分支大仓库下明显更慢，且是
    // getLog 串行队列里排在 git log 之前的额外一跳。detached HEAD 返回 "HEAD"，不会误把
    // 任何 local 分支标成 head（与 rebase.service 取 HEAD 的方式保持一致）。
    const headBranch = (await git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "")).trim();

    const args: string[] = [
      `--skip=${filter.skip}`,
      `-n`,
      `${filter.limit}`,
      `--format=${LOG_FORMAT}%x01`,
    ];

    // 未显式选择分支时，只显示当前检出分支（HEAD）的历史，而非 `--all`。
    // `--all` 会展开 refs/ 下所有引用（含 refs/stash 及其它本地/远程分支），导致日志
    // 列表混入 stash 提交（On <b>/index on <b>/untracked files on <b>）与无关分支提交；
    // 用户期望默认看到的是「当前分支的日志」。仍可在左侧分支栏点击分支按 filter.branch 切换。
    if (filter.branch) args.push(filter.branch);
    else args.push("HEAD");

    if (filter.author) args.push(`--author=${filter.author}`);
    if (filter.dateFrom) {
      // 纯日期 yyyy-mm-dd 显式补到当天 00:00:00。
      // git 对纯日期 --after=DATE 默认按「DATE 当天结束之后」解析（即 23:59:59），
      // 会漏掉当天所有 commit；补 00:00:00 后语义变为「DATE 当天起始之后」= 包含当天。
      const v = /^\d{4}-\d{2}-\d{2}$/.test(filter.dateFrom)
        ? `${filter.dateFrom} 00:00:00`
        : filter.dateFrom;
      args.push(`--after=${v}`);
    }
    if (filter.dateTo) {
      // 纯日期补到当天 23:59:59，与 git 默认行为一致，明确包含整天。
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

    let raw: string;
    try {
      raw = await git.raw(["log", ...args]);
    } catch (e) {
      // 空仓库 / 尚无提交的 unborn 分支下 `git log HEAD` 会直接 fatal，而旧的 `--all`
      // 在空仓库会安静返回空。仅当「未选分支（默认走 HEAD）+ 确属无提交」时吞掉错误返回
      // 空日志，保持空仓库不报错的既有体验；其余真实错误（坏仓库 / 损坏 ref 等）照常上抛。
      const noCommitsYet =
        /does not have any commits yet|bad default revision|ambiguous argument '?HEAD'?|unknown revision|bad revision/i.test(
          errStr(e)
        );
      if (!filter.branch && noCommitsYet) {
        return { commits: [], graphRows: [] };
      }
      throw e;
    }
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

    if (!staged && !raw.trim()) {
      return buildUntrackedDiff(repoPath, filePath);
    }

    const parsed = parseDiffOutput(raw, filePath);
    if (parsed.binary) {
      const recovered = await recoverMisdetectedBinaryDiff(repoPath, filePath, staged);
      if (recovered) return recovered;
    }
    return parsed;
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
