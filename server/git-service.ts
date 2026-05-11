import { simpleGit, type SimpleGit } from "simple-git";
import * as path from "path";
import * as fs from "fs";
import { safeJoin } from "./utils/path-safe.js";

export interface RepoOpenResult {
  path: string;
  name: string;
  currentBranch: string;
}

export interface CommitInfo {
  id: string;
  shortId: string;
  message: string;
  summary: string;
  author: string;
  authorEmail: string;
  authorTime: number;
  committer: string;
  committerEmail: string;
  commitTime: number;
  parents: string[];
  refs: RefInfo[];
  isMerge: boolean;
}

export interface RefInfo {
  name: string;
  refType: "local" | "remote" | "tag" | "head";
  isHead: boolean;
}

export interface GraphRow {
  commitId: string;
  column: number;
  color: number;
  edges: GraphEdge[];
}

export interface GraphEdge {
  fromCol: number;
  toCol: number;
  color: number;
  edgeType: "straight" | "merge" | "fork";
}

export interface LogResult {
  commits: CommitInfo[];
  graphRows: GraphRow[];
}

export interface LogFilter {
  skip: number;
  limit: number;
  branch: string | null;
  author: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  path: string | null;
  searchText: string;
  useRegex: boolean;
  matchCase: boolean;
}

export interface BranchInfo {
  name: string;
  isHead: boolean;
  upstream: string | null;
  aheadBehind: [number, number] | null;
  lastCommitId: string;
  lastCommitSummary: string;
  lastCommitTime: number;
}

export interface BranchesResult {
  local: BranchInfo[];
  remote: BranchInfo[];
  tags: string[];
}

/** 解析 `git branch -vv` 中 label 里 `[upstream: ahead n, behind m] subject` 片段 */
function parseBranchVerboseLabel(label: string): {
  upstream: string | null;
  aheadBehind: [number, number] | null;
  subject: string;
} {
  const trimmed = label.trim();
  const bracket = /^\[([^\]]*)\]\s*(.*)$/s.exec(trimmed);
  if (!bracket) {
    return { upstream: null, aheadBehind: null, subject: trimmed };
  }
  const inside = bracket[1];
  const subject = bracket[2].trim();
  const colon = inside.indexOf(":");
  const upstreamPart = (colon >= 0 ? inside.slice(0, colon) : inside).trim();
  let upstream: string | null = null;
  if (upstreamPart && upstreamPart !== "gone") {
    upstream = upstreamPart;
  }
  const aheadM = /ahead (\d+)/.exec(inside);
  const behindM = /behind (\d+)/.exec(inside);
  const ahead = aheadM ? parseInt(aheadM[1], 10) : 0;
  const behind = behindM ? parseInt(behindM[1], 10) : 0;
  const aheadBehind: [number, number] | null =
    ahead || behind ? [ahead, behind] : null;
  return { upstream, aheadBehind, subject: subject || trimmed };
}

export interface FileStatus {
  path: string;
  oldPath: string | null;
  status:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "copied"
    | "untracked"
    | "conflicted"
    | "ignored";
  staged: boolean;
}

export interface StatusResult {
  staged: FileStatus[];
  unstaged: FileStatus[];
  untracked: FileStatus[];
}

export interface DiffResultModel {
  oldPath: string | null;
  newPath: string | null;
  hunks: DiffHunk[];
  binary: boolean;
  oldContent: string | null;
  newContent: string | null;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  lineType: "context" | "addition" | "deletion";
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export interface BlameInfo {
  lines: BlameLine[];
}

export interface BlameLine {
  lineNo: number;
  content: string;
  commitId: string;
  shortId: string;
  author: string;
  authorEmail: string;
  time: number;
  summary: string;
}

export interface StashEntry {
  index: number;
  message: string;
  commitId: string;
  time: number;
}

export interface MergeResult {
  success: boolean;
  conflicts: string[];
  message: string;
}

export interface ConflictFile {
  path: string;
  oursContent: string;
  theirsContent: string;
  baseContent: string;
}

export interface RemoteInfo {
  name: string;
  url: string;
  fetchUrl: string;
}

const GIT_TIMEOUT_MS = 30_000;

const NON_RETRYABLE_PATTERNS = [
  /authentication/i,
  /permission denied/i,
  /non-fast-forward/i,
  /conflict/i,
  /path traversal/i,
  /not a git repository/i,
];
const RETRYABLE_PATTERNS = [
  /network/i,
  /timeout|timed out/i,
  /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i,
  /temporarily/i,
  /could not resolve/i,
  /unable to access/i,
  /server side error|service unavailable/i,
];

function shouldRetry(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (NON_RETRYABLE_PATTERNS.some((p) => p.test(msg))) return false;
  return RETRYABLE_PATTERNS.some((p) => p.test(msg));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; baseMs?: number; label?: string } = {}
): Promise<T> {
  const tries = opts.tries ?? 3;
  const base = opts.baseMs ?? 500;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === tries - 1 || !shouldRetry(e)) throw e;
      const delay = base * 2 ** i + Math.random() * base;
      console.warn(
        `[withRetry] ${opts.label ?? "op"} attempt ${i + 1}/${tries} failed: ${errStr(e)} ; retry in ${Math.round(delay)}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function errStr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}

function getGit(repoPath: string): SimpleGit {
  return simpleGit({
    baseDir: repoPath,
    binary: "git",
    maxConcurrentProcesses: 6,
    timeout: { block: GIT_TIMEOUT_MS },
  });
}

function parseStatusCode(
  x: string,
  y: string
): { status: FileStatus["status"]; staged: boolean }[] {
  const results: { status: FileStatus["status"]; staged: boolean }[] = [];

  // Both are untracked
  if (x === "?" && y === "?") {
    results.push({ status: "untracked", staged: false });
    return results;
  }

  // Handle conflicts - various conflict indicators
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
    results.push({ status: "conflicted", staged: false });
    return results;
  }

  // Handle case where file is marked as ignored in working directory (!)
  if (y === "!") {
    // If a file is ignored, treat it appropriately
    // For our purposes, we'll treat it as a modified file in the working directory
    // Or ignore it entirely depending on the context - let's include as modified for now
    results.push({ status: "modified", staged: false });
    return results;
  }

  const mapCode = (c: string): FileStatus["status"] | null => {
    switch (c) {
      case "A": return "added";
      case "M": return "modified";
      case "D": return "deleted";
      case "R": return "renamed";
      case "C": return "copied";
      // Include "!" for ignored files
      case "!": return "modified"; // or could be treated as "untracked" depending on needs
      default: return null;
    }
  };

  // Process index status (staged changes)
  if (x && x !== " " && x !== "?") {
    const s = mapCode(x);
    if (s) {
      results.push({ status: s, staged: true });
    } else {
      // If mapping failed, default to modified
      results.push({ status: "modified", staged: true });
    }
  }

  // Process working directory status (unstaged changes)
  if (y && y !== " " && y !== "?" && y !== "!") {
    const s = mapCode(y);
    if (s) {
      results.push({ status: s, staged: false });
    } else {
      // If mapping failed, default to modified
      results.push({ status: "modified", staged: false });
    }
  }

  return results;
}

function parseDiffOutput(raw: string, filePath?: string): DiffResultModel {
  const result: DiffResultModel = {
    oldPath: null,
    newPath: null,
    hunks: [],
    binary: false,
    oldContent: null,
    newContent: null,
  };

  if (raw.includes("Binary files")) {
    result.binary = true;
    return result;
  }

  const lines = raw.split("\n");
  let currentHunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      const p = line.substring(4);
      result.oldPath = p === "/dev/null" ? null : p.replace(/^[ab]\//, "");
    } else if (line.startsWith("+++ ")) {
      const p = line.substring(4);
      result.newPath = p === "/dev/null" ? null : p.replace(/^[ab]\//, "");
    } else if (line.startsWith("@@")) {
      const match = line.match(
        /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/
      );
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1]),
          oldLines: parseInt(match[2] ?? "1"),
          newStart: parseInt(match[3]),
          newLines: parseInt(match[4] ?? "1"),
          header: match[5]?.trim() ?? "",
          lines: [],
        };
        oldLineNo = currentHunk.oldStart;
        newLineNo = currentHunk.newStart;
        result.hunks.push(currentHunk);
      }
    } else if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({
          lineType: "addition",
          content: line.substring(1),
          oldLineNo: null,
          newLineNo: newLineNo++,
        });
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          lineType: "deletion",
          content: line.substring(1),
          oldLineNo: oldLineNo++,
          newLineNo: null,
        });
      } else if (line.startsWith(" ") || line === "") {
        currentHunk.lines.push({
          lineType: "context",
          content: line.startsWith(" ") ? line.substring(1) : line,
          oldLineNo: oldLineNo++,
          newLineNo: newLineNo++,
        });
      }
    }
  }

  if (!result.oldPath && !result.newPath && filePath) {
    result.newPath = filePath;
  }

  return result;
}

function parseRefs(
  refStr: string,
  headBranch: string
): RefInfo[] {
  if (!refStr) return [];
  return refStr
    .replace(/[()]/g, "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      if (r.startsWith("HEAD -> ")) {
        return {
          name: r.replace("HEAD -> ", ""),
          refType: "head" as const,
          isHead: true,
        };
      }
      if (r.startsWith("tag: ")) {
        return {
          name: r.replace("tag: ", ""),
          refType: "tag" as const,
          isHead: false,
        };
      }
      if (r.includes("/")) {
        return { name: r, refType: "remote" as const, isHead: false };
      }
      return {
        name: r,
        refType: "local" as const,
        isHead: r === headBranch,
      };
    });
}

export class GitService {
  async openRepo(repoPath: string): Promise<RepoOpenResult> {
    const git = getGit(repoPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) throw new Error(`Not a git repository: ${repoPath}`);
    // Resolve to actual git root so all subsequent operations use the correct base path
    const rootPath = (await git.revparse(["--show-toplevel"])).trim();
    const rootGit = getGit(rootPath);
    const branchSummary = await rootGit.branch();
    return {
      path: rootPath,
      name: path.basename(rootPath),
      currentBranch: branchSummary.current,
    };
  }

  async getLog(repoPath: string, filter: LogFilter): Promise<LogResult> {
    const git = getGit(repoPath);
    const branchSummary = await git.branch();
    const headBranch = branchSummary.current;

    const LOG_FORMAT = [
      "%H", "%h", "%s", "%an", "%ae", "%at", "%cn", "%ce", "%ct", "%P", "%D"
    ].join("%x00");

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
    if (filter.dateTo) args.push(`--before=${filter.dateTo}`);
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
    const commits: CommitInfo[] = [];
    const entries = raw.split("\x01").map(s => s.trim()).filter(Boolean);

    for (const entry of entries) {
      const fields = entry.split("\x00");
      if (fields.length < 11) continue;

      const [id, shortId, summary, author, authorEmail, atStr, committer, committerEmail, ctStr, parentStr, refStr] = fields;

      if (!id || id.length < 7) continue;

      const parents = parentStr ? parentStr.split(" ").filter(Boolean) : [];
      const refs = parseRefs(refStr ?? "", headBranch);

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
        refs,
        isMerge: parents.length > 1,
      });
    }

    const graphRows = this.buildSimpleGraph(commits);
    return { commits, graphRows };
  }

  /**
   * 提交图构建。原 O(N²) 实现使用 `activeLanes.indexOf(...)` 在 1k+ 提交时显著卡顿。
   * 改用 `lanes: (string|null)[]` + `laneByCommit: Map<commitId, col>` 双向索引：
   * - 查找 lane: O(1) Map.get
   * - 分配 lane: 优先复用第一个空闲 lane (lanes[i] === null)，减少 lane 单调增长
   * - 总复杂度 O(N * avgParents)
   */
  private buildSimpleGraph(commits: CommitInfo[]): GraphRow[] {
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
      if (col === undefined) {
        col = allocLane(commit.id);
      }
      laneByCommit.delete(commit.id);

      const edges: GraphEdge[] = [];
      const colorIdx = col % 8;

      if (commit.parents.length === 0) {
        lanes[col] = null;
      } else {
        const firstParent = commit.parents[0];
        lanes[col] = firstParent;
        laneByCommit.set(firstParent, col);
        edges.push({
          fromCol: col,
          toCol: col,
          color: colorIdx,
          edgeType: "straight",
        });

        for (let i = 1; i < commit.parents.length; i++) {
          const parentId = commit.parents[i];
          let parentCol = laneByCommit.get(parentId);
          if (parentCol === undefined) {
            parentCol = allocLane(parentId);
          }
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

  async getCommitDetail(
    repoPath: string,
    commitId: string
  ): Promise<CommitInfo> {
    const git = getGit(repoPath);
    const branchSummary = await git.branch();

    const DETAIL_FORMAT = [
      "%H", "%h", "%s", "%an", "%ae", "%at", "%cn", "%ce", "%ct", "%P", "%D"
    ].join("%x00") + "%x00%B";

    const raw = await git.raw([
      "log",
      "-1",
      `--format=${DETAIL_FORMAT}`,
      commitId,
    ]);

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
  }

  async getCommitFiles(
    repoPath: string,
    commitId: string
  ): Promise<FileStatus[]> {
    const git = getGit(repoPath);
    const raw = await git.raw([
      "diff-tree",
      "--no-commit-id",
      "-r",
      "--name-status",
      commitId,
    ]);
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("\t");
        const code = parts[0]?.[0] ?? "M";
        const statusMap: Record<string, FileStatus["status"]> = {
          A: "added",
          M: "modified",
          D: "deleted",
          R: "renamed",
          C: "copied",
        };
        const filePath = parts.length >= 3 ? parts[2]! : parts[1]!;
        const oldPath = parts.length >= 3 ? parts[1]! : null;
        return {
          path: filePath,
          oldPath,
          status: statusMap[code] ?? "modified",
          staged: false,
        };
      });
  }

  async getCommitDiff(
    repoPath: string,
    commitId: string,
    filePath: string
  ): Promise<DiffResultModel> {
    const git = getGit(repoPath);
    const raw = await git.raw(["diff", `${commitId}~1`, commitId, "--", filePath]).catch(() =>
      git.raw(["diff", "--root", commitId, "--", filePath])
    );
    return parseDiffOutput(raw, filePath);
  }

  async getFileDiff(
    repoPath: string,
    filePath: string,
    staged: boolean
  ): Promise<DiffResultModel> {
    const git = getGit(repoPath);
    const args = staged
      ? ["diff", "--cached", "--", filePath]
      : ["diff", "--", filePath];
    const raw = await git.raw(args);
    return parseDiffOutput(raw, filePath);
  }

  async compareCommits(
    repoPath: string,
    fromId: string,
    toId: string
  ): Promise<FileStatus[]> {
    const git = getGit(repoPath);
    const raw = await git.raw([
      "diff",
      "--name-status",
      fromId,
      toId,
    ]);
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("\t");
        const code = parts[0]?.[0] ?? "M";
        const statusMap: Record<string, FileStatus["status"]> = {
          A: "added",
          M: "modified",
          D: "deleted",
          R: "renamed",
          C: "copied",
        };
        const fp = parts.length >= 3 ? parts[2]! : parts[1]!;
        const oldP = parts.length >= 3 ? parts[1]! : null;
        return {
          path: fp,
          oldPath: oldP,
          status: statusMap[code] ?? "modified",
          staged: false,
        };
      });
  }

  async getBranches(repoPath: string): Promise<BranchesResult> {
    const git = getGit(repoPath);
    const branchSummary = await git.branch(["-a", "-vv"]);
    const local: BranchInfo[] = [];
    const remote: BranchInfo[] = [];

    for (const [name, data] of Object.entries(branchSummary.branches)) {
      const shortName = name.replace(/^remotes\//, "");
      const isRemote = name.startsWith("remotes/");
      const parsed = isRemote
        ? {
            upstream: null as string | null,
            aheadBehind: null as [number, number] | null,
            subject: data.label.trim(),
          }
        : parseBranchVerboseLabel(data.label);
      const info: BranchInfo = {
        name: shortName,
        isHead: data.current,
        upstream: parsed.upstream,
        aheadBehind: parsed.aheadBehind,
        lastCommitId: data.commit,
        lastCommitSummary: parsed.subject,
        lastCommitTime: 0,
      };
      if (isRemote) {
        remote.push(info);
      } else {
        local.push(info);
      }
    }

    let tags: string[] = [];
    try {
      const tagResult = await git.tags();
      tags = tagResult.all;
    } catch {
      // no tags
    }

    return { local, remote, tags };
  }

  async createBranch(
    repoPath: string,
    name: string,
    startPoint?: string
  ): Promise<void> {
    const git = getGit(repoPath);
    if (startPoint) {
      await git.branch([name, startPoint]);
    } else {
      await git.branch([name]);
    }
  }

  async checkoutBranch(repoPath: string, name: string): Promise<void> {
    const git = getGit(repoPath);
    await git.checkout(name);
  }

  async deleteBranch(
    repoPath: string,
    name: string,
    force: boolean
  ): Promise<void> {
    const git = getGit(repoPath);
    await git.branch([force ? "-D" : "-d", name]);
  }

  async renameBranch(
    repoPath: string,
    oldName: string,
    newName: string
  ): Promise<void> {
    const git = getGit(repoPath);
    await git.branch(["-m", oldName, newName]);
  }

  async mergeBranch(repoPath: string, name: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      const result = await git.merge([name]);
      const conflicts = (result.conflicts ?? []).map((c) =>
        typeof c === "string" ? c : (c as { file?: string }).file ?? String(c)
      );
      return {
        success: true,
        conflicts,
        message: result.result ?? "Merge completed",
      };
    } catch (e: unknown) {
      const conflicts = await this.getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Merge failed with conflicts",
      };
    }
  }

  async rebaseBranch(repoPath: string, upstream: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      await git.rebase([upstream]);
      return { success: true, conflicts: [], message: "Rebase completed" };
    } catch (e: unknown) {
      const conflicts = await this.getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Rebase failed with conflicts",
      };
    }
  }

  async cherryPick(repoPath: string, commitId: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      await git.raw(["cherry-pick", commitId]);
      return { success: true, conflicts: [], message: "Cherry-pick completed" };
    } catch (e: unknown) {
      const conflicts = await this.getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Cherry-pick failed with conflicts",
      };
    }
  }

  async getStatus(repoPath: string): Promise<StatusResult> {
    const git = getGit(repoPath);
    const status = await git.status();

    // For debugging: Log the raw status result if needed
    // console.log('Raw git status result:', status);

    const staged: FileStatus[] = [];
    const unstaged: FileStatus[] = [];
    const untracked: FileStatus[] = [];

    for (const f of status.files) {
      const x = f.index;
      const y = f.working_dir;
      const filePath = f.path;

      if (x === "?" && y === "?") {
        untracked.push({
          path: filePath,
          oldPath: null,
          status: "untracked",
          staged: false,
        });
        continue;
      }

      const entries = parseStatusCode(x, y);
      for (const e of entries) {
        const item: FileStatus = {
          path: filePath,
          oldPath: f.from && f.from !== f.path ? f.from : null, // Properly handle renames
          status: e.status,
          staged: e.staged,
        };
        if (e.staged) staged.push(item);
        else unstaged.push(item);
      }
    }

    return { staged, unstaged, untracked };
  }

  async stageFile(repoPath: string, filePath: string): Promise<void> {
    const git = getGit(repoPath);
    await git.add(filePath);
  }

  async unstageFile(repoPath: string, filePath: string): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["reset", "HEAD", "--", filePath]);
  }

  async stageAll(repoPath: string): Promise<void> {
    const git = getGit(repoPath);
    await git.add("-A");
  }

  async unstageAll(repoPath: string): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["reset", "HEAD"]);
  }

  async commit(
    repoPath: string,
    message: string,
    amend: boolean
  ): Promise<string> {
    const git = getGit(repoPath);
    const args = amend ? ["commit", "--amend", "-m", message] : ["commit", "-m", message];
    const result = await git.raw(args);
    const match = result.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
    return match?.[1] ?? "";
  }

  async push(
    repoPath: string,
    remote?: string,
    branch?: string
  ): Promise<void> {
    const git = getGit(repoPath);
    const args: string[] = ["push"];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    await withRetry(() => git.raw(args), { label: `push ${remote ?? ""} ${branch ?? ""}` });
  }

  async getUnpushedCommits(
    repoPath: string,
    remote?: string,
    branch?: string
  ): Promise<CommitInfo[]> {
    const git = getGit(repoPath);
    const LOG_FORMAT = [
      "%H", "%h", "%s", "%an", "%ae", "%at", "%cn", "%ce", "%ct", "%P", "%D"
    ].join("%x00");

    let rangeArg: string;
    try {
      // 优先使用 upstream 作为范围
      if (remote && branch) {
        rangeArg = `${remote}/${branch}..HEAD`;
      } else {
        // 尝试 @{u}..HEAD，若无 upstream 则捕获错误
        await git.raw(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
        rangeArg = "@{u}..HEAD";
      }
    } catch {
      // 无 upstream，返回空列表
      return [];
    }

    let raw: string;
    try {
      raw = await git.raw(["log", rangeArg, `--format=${LOG_FORMAT}%x01`]);
    } catch {
      return [];
    }

    const branchSummary = await git.branch();
    const headBranch = branchSummary.current;
    const commits: CommitInfo[] = [];
    const entries = raw.split("\x01").map(s => s.trim()).filter(Boolean);

    for (const entry of entries) {
      const fields = entry.split("\x00");
      if (fields.length < 11) continue;
      const [id, shortId, summary, author, authorEmail, atStr, committer, committerEmail, ctStr, parentStr, refStr] = fields;
      if (!id || id.length < 7) continue;
      const parents = parentStr ? parentStr.split(" ").filter(Boolean) : [];
      const refs = parseRefs(refStr ?? "", headBranch);
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
        refs,
        isMerge: parents.length > 1,
      });
    }
    return commits;
  }

  async pull(
    repoPath: string,
    remote?: string,
    rebase?: boolean
  ): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      const args: string[] = ["pull"];
      if (rebase) args.push("--rebase");
      if (remote) args.push(remote);
      await git.raw(args);
      return { success: true, conflicts: [], message: "Pull completed" };
    } catch (e: unknown) {
      const conflicts = await this.getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Pull failed",
      };
    }
  }

  async fetch(repoPath: string, remote?: string): Promise<void> {
    const git = getGit(repoPath);
    await withRetry(
      () => (remote ? git.fetch(remote) : git.fetch()),
      { label: `fetch ${remote ?? "(default)"}` }
    );
  }

  async fetchAll(repoPath: string): Promise<void> {
    const git = getGit(repoPath);
    await withRetry(() => git.fetch(["--all"]), { label: "fetch --all" });
  }

  async fetchBranch(repoPath: string, remote: string, branchName: string): Promise<void> {
    const git = getGit(repoPath);
    await withRetry(
      () => git.raw(["fetch", remote, `${branchName}:${branchName}`]),
      { label: `fetch ${remote} ${branchName}` }
    );
  }

  async getRemotes(repoPath: string): Promise<RemoteInfo[]> {
    const git = getGit(repoPath);
    const remotes = await git.getRemotes(true);
    return remotes.map((r) => ({
      name: r.name,
      url: r.refs.push ?? r.refs.fetch ?? "",
      fetchUrl: r.refs.fetch ?? "",
    }));
  }

  async getStashList(repoPath: string): Promise<StashEntry[]> {
    const git = getGit(repoPath);
    const raw = await git.raw(["stash", "list", "--format=%H%n%at%n%s"]);
    if (!raw.trim()) return [];
    const lines = raw.trim().split("\n");
    const entries: StashEntry[] = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      entries.push({
        index: entries.length,
        commitId: lines[i]!,
        time: parseInt(lines[i + 1]!) * 1000,
        message: lines[i + 2]!,
      });
    }
    return entries;
  }

  async stashSave(
    repoPath: string,
    message: string,
    includeUntracked: boolean
  ): Promise<void> {
    const git = getGit(repoPath);
    const args = ["stash", "push", "-m", message];
    if (includeUntracked) args.push("--include-untracked");
    await git.raw(args);
  }

  async stashApply(repoPath: string, index: number): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["stash", "apply", `stash@{${index}}`]);
  }

  async stashPop(repoPath: string, index: number): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["stash", "pop", `stash@{${index}}`]);
  }

  async stashDrop(repoPath: string, index: number): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["stash", "drop", `stash@{${index}}`]);
  }

  async getStashFiles(repoPath: string, index: number): Promise<FileStatus[]> {
    const git = getGit(repoPath);
    const raw = await git.raw([
      "stash",
      "show",
      "--name-status",
      `stash@{${index}}`,
    ]);
    if (!raw.trim()) return [];
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("\t");
        const code = parts[0]?.[0] ?? "M";
        const statusMap: Record<string, FileStatus["status"]> = {
          A: "added",
          M: "modified",
          D: "deleted",
          R: "renamed",
          C: "copied",
        };
        const fp = parts.length >= 3 ? parts[2]! : parts[1]!;
        const oldP = parts.length >= 3 ? parts[1]! : null;
        return {
          path: fp ?? "",
          oldPath: oldP,
          status: statusMap[code] ?? "modified",
          staged: false,
        };
      })
      .filter((f) => f.path);
  }

  async getStashFileDiff(
    repoPath: string,
    index: number,
    filePath: string
  ): Promise<DiffResultModel> {
    const git = getGit(repoPath);
    const raw = await git
      .raw([
        "diff",
        `stash@{${index}}^1`,
        `stash@{${index}}`,
        "--",
        filePath,
      ])
      .catch(() =>
        git.raw([
          "diff",
          "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
          `stash@{${index}}`,
          "--",
          filePath,
        ])
      );
    return parseDiffOutput(raw, filePath);
  }

  async getBlame(
    repoPath: string,
    filePath: string,
    commitId?: string
  ): Promise<BlameInfo> {
    const git = getGit(repoPath);
    const args = ["blame", "--porcelain"];
    if (commitId) args.push(commitId);
    args.push("--", filePath);
    const raw = await git.raw(args);

    const lines: BlameLine[] = [];
    const blameLines = raw.split("\n");
    let currentCommit = "";
    let currentAuthor = "";
    let currentEmail = "";
    let currentTime = 0;
    let currentSummary = "";
    let lineNo = 0;

    for (const line of blameLines) {
      const headerMatch = line.match(/^([a-f0-9]{40}) \d+ (\d+)/);
      if (headerMatch) {
        currentCommit = headerMatch[1]!;
        lineNo = parseInt(headerMatch[2]!);
        continue;
      }
      if (line.startsWith("author ")) {
        currentAuthor = line.substring(7);
      } else if (line.startsWith("author-mail ")) {
        currentEmail = line.substring(12).replace(/[<>]/g, "");
      } else if (line.startsWith("author-time ")) {
        currentTime = parseInt(line.substring(12)) * 1000;
      } else if (line.startsWith("summary ")) {
        currentSummary = line.substring(8);
      } else if (line.startsWith("\t")) {
        lines.push({
          lineNo,
          content: line.substring(1),
          commitId: currentCommit,
          shortId: currentCommit.substring(0, 7),
          author: currentAuthor,
          authorEmail: currentEmail,
          time: currentTime,
          summary: currentSummary,
        });
      }
    }

    return { lines };
  }

  async getConflictFiles(repoPath: string): Promise<string[]> {
    const git = getGit(repoPath);
    const status = await git.status();
    return status.conflicted;
  }

  async getConflictContent(
    repoPath: string,
    filePath: string
  ): Promise<ConflictFile> {
    const git = getGit(repoPath);
    const [ours, theirs, base] = await Promise.all([
      git.raw(["show", `:2:${filePath}`]).catch(() => ""),
      git.raw(["show", `:3:${filePath}`]).catch(() => ""),
      git.raw(["show", `:1:${filePath}`]).catch(() => ""),
    ]);
    return {
      path: filePath,
      oursContent: ours,
      theirsContent: theirs,
      baseContent: base,
    };
  }

  async resolveConflict(
    repoPath: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const fullPath = safeJoin(repoPath, filePath);
    fs.writeFileSync(fullPath, content, "utf-8");
    const git = getGit(repoPath);
    await git.add(filePath);
  }

  /**
   * 检测仓库当前是否处于 merge / rebase / cherry-pick / revert 半成态。
   * 通过 .git 目录下的标记文件判断（git 标准实现）。
   */
  async getMergeState(repoPath: string): Promise<{
    state: "none" | "merge" | "rebase" | "cherry-pick" | "revert";
    hasConflicts: boolean;
  }> {
    const gitDir = path.join(repoPath, ".git");
    const checkFile = (rel: string) => {
      try {
        return fs.existsSync(path.join(gitDir, rel));
      } catch {
        return false;
      }
    };
    let state: "none" | "merge" | "rebase" | "cherry-pick" | "revert" = "none";
    if (checkFile("MERGE_HEAD")) state = "merge";
    else if (checkFile("rebase-merge") || checkFile("rebase-apply"))
      state = "rebase";
    else if (checkFile("CHERRY_PICK_HEAD")) state = "cherry-pick";
    else if (checkFile("REVERT_HEAD")) state = "revert";

    const conflicts = await this.getConflictFiles(repoPath);
    return { state, hasConflicts: conflicts.length > 0 };
  }

  async continueOperation(
    repoPath: string,
    op: "merge" | "rebase" | "cherry-pick" | "revert"
  ): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      if (op === "merge") {
        await git.raw(["commit", "--no-edit"]);
      } else if (op === "rebase") {
        await git.raw(["rebase", "--continue"]);
      } else if (op === "cherry-pick") {
        await git.raw(["cherry-pick", "--continue"]);
      } else {
        await git.raw(["revert", "--continue"]);
      }
      return { success: true, conflicts: [], message: `${op} continued` };
    } catch (e: unknown) {
      const conflicts = await this.getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || `${op} continue failed`,
      };
    }
  }

  async abortOperation(
    repoPath: string,
    op: "merge" | "rebase" | "cherry-pick" | "revert"
  ): Promise<void> {
    const git = getGit(repoPath);
    if (op === "merge") {
      await git.raw(["merge", "--abort"]);
    } else if (op === "rebase") {
      await git.raw(["rebase", "--abort"]);
    } else if (op === "cherry-pick") {
      await git.raw(["cherry-pick", "--abort"]);
    } else {
      await git.raw(["revert", "--abort"]);
    }
  }

  async getWorkingFileContent(
    repoPath: string,
    filePath: string
  ): Promise<string> {
    const fullPath = safeJoin(repoPath, filePath);
    return fs.readFileSync(fullPath, "utf-8");
  }

  async cloneRepo(url: string, targetPath: string): Promise<void> {
    const git = simpleGit({
      binary: "git",
      maxConcurrentProcesses: 1,
      timeout: { block: GIT_TIMEOUT_MS * 4 },
    });
    await withRetry(() => git.clone(url, targetPath), {
      tries: 3,
      baseMs: 1000,
      label: `clone ${url}`,
    });
  }

  async getFileContent(
    repoPath: string,
    commitId: string,
    filePath: string
  ): Promise<string> {
    const git = getGit(repoPath);
    return git.raw(["show", `${commitId}:${filePath}`]);
  }

  async revertCommit(repoPath: string, commitId: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      await git.raw(["revert", "--no-edit", commitId]);
      return { success: true, conflicts: [], message: "Revert completed" };
    } catch (e: unknown) {
      const conflicts = await this.getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Revert failed with conflicts",
      };
    }
  }

  async resetToCommit(
    repoPath: string,
    commitId: string,
    mode: "soft" | "mixed" | "hard"
  ): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["reset", `--${mode}`, commitId]);
  }

  async discardFileChanges(repoPath: string, filePath: string): Promise<void> {
    const git = getGit(repoPath);
    // unstage first (no-op if not staged), then restore working tree
    await git.raw(["reset", "HEAD", "--", filePath]).catch(() => {});
    await git.raw(["checkout", "--", filePath]).catch(async () => {
      // fallback for new git versions
      await git.raw(["restore", "--", filePath]);
    });
  }

  async getFileDiffRaw(
    repoPath: string,
    filePath: string,
    staged: boolean
  ): Promise<string> {
    const git = getGit(repoPath);
    const args = staged
      ? ["diff", "--cached", "--", filePath]
      : ["diff", "--", filePath];
    return git.raw(args);
  }

  async deleteFile(repoPath: string, filePath: string): Promise<void> {
    const fullPath = safeJoin(repoPath, filePath);
    fs.unlinkSync(fullPath);
  }

  async stashFile(
    repoPath: string,
    filePath: string,
    message?: string
  ): Promise<void> {
    const git = getGit(repoPath);
    const args = ["stash", "push", "--include-untracked"];
    if (message) {
      args.push("-m", message);
    }
    args.push("--", filePath);
    await git.raw(args);
  }
}

export const gitService = new GitService();
