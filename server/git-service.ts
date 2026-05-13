/**
 * Git Service Facade.
 *
 * 历史上这是一个 1440 行的 god class；P3 重构为 8 个职责单一的子服务（位于
 * `services/`），本文件仅做两件事：
 *   1. export 所有领域 DTO 接口（消费者无需感知拆分）
 *   2. 把 8 个子服务的方法以对象 spread 形式合并到 `gitService` 上，保持
 *      `import { gitService } from "./git-service"` 这个 API 不变。
 *
 * P5 会把这些 interface 进一步抽到 `shared/types.ts` 作为唯一类型源。
 */

import { repoService } from "./services/repo.service.js";
import { logService } from "./services/log.service.js";
import { branchService } from "./services/branch.service.js";
import { statusService } from "./services/status.service.js";
import { remoteService } from "./services/remote.service.js";
import { stashService } from "./services/stash.service.js";
import { blameService } from "./services/blame.service.js";
import { conflictService } from "./services/conflict.service.js";

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

export const gitService = {
  ...repoService,
  ...logService,
  ...branchService,
  ...statusService,
  ...remoteService,
  ...stashService,
  ...blameService,
  ...conflictService,
};

export type GitService = typeof gitService;
