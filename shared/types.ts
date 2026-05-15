/**
 * Single source of truth for domain DTOs and the Commands interface.
 *
 * 之前 `server/git-service.ts`、`src/utils/types.ts` 各自定义一份重复的 interface；
 * P5 合并到本文件，三个端（前端 / Express server / Electron main）通过 tsconfig 的
 * `include "shared/**"` 引用同一份定义。任意字段变动只改这里一处。
 */

export interface RepoOpenResult {
  path: string;
  name: string;
  currentBranch: string;
}

export interface RefInfo {
  name: string;
  refType: "local" | "remote" | "tag" | "head";
  isHead: boolean;
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

export interface GraphEdge {
  fromCol: number;
  toCol: number;
  color: number;
  edgeType: "straight" | "merge" | "fork";
}

export interface GraphRow {
  commitId: string;
  column: number;
  color: number;
  edges: GraphEdge[];
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

export interface DiffLine {
  lineType: "context" | "addition" | "deletion";
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffResult {
  oldPath: string | null;
  newPath: string | null;
  hunks: DiffHunk[];
  binary: boolean;
  oldContent: string | null;
  newContent: string | null;
}

/** 历史上 server 端使用过 DiffResultModel 名字，保留 alias 兼容旧 import。 */
export type DiffResultModel = DiffResult;

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

export interface BlameInfo {
  lines: BlameLine[];
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

/**
 * `git submodule status` 解析出的子模块状态。
 *
 * `state` 取自前缀字符：` ` initialized / `-` uninitialized / `+` modified /
 * `U` merge-conflict（详见 git-submodule(1)）。
 */
export interface Submodule {
  path: string;
  name: string;
  /** 来自 .gitmodules 的 url；读不到时为空字符串 */
  url: string;
  /** 当前 working tree 的 commit；uninitialized 时为 null */
  head: string | null;
  /** `git describe` 描述，可能为 null */
  described: string | null;
  state: "initialized" | "uninitialized" | "modified" | "merge-conflict";
}

/**
 * `git reflog show HEAD --format=...` 解析出的一条记录。
 * 用于「迷路（reflog）」面板恢复误操作丢失的 commit。
 */
export interface ReflogEntry {
  /** 0 = HEAD@{0}（最新），向下递增 */
  index: number;
  /** 形如 `HEAD@{0}` 的 reflog ref，可直接 `git reset --hard` 它 */
  ref: string;
  commitId: string;
  shortId: string;
  /** reflog subject，例如 `reset: moving to HEAD~`、`commit: feat: ...` */
  action: string;
  /** commit 本身的 subject（一句话），用于显示 commit 内容 */
  subject: string;
  /** unix ms */
  time: number;
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

/**
 * Push 选项。所有字段可选，未传则走普通 `git push`。
 *
 * 互斥规则（前端 UI 也应阻止同时勾选）：
 *   `force` 与 `forceWithLease` 互斥；同时设置时 `forceWithLease` 优先。
 */
export interface PushOptions {
  /** `--force-with-lease`：远端被他人改动则失败（安全的强推，推荐） */
  forceWithLease?: boolean;
  /** `--force`：覆盖远端 history（危险，需用户明确二次确认） */
  force?: boolean;
  /** `-u/--set-upstream`：推送同时设置上游分支 */
  setUpstream?: boolean;
  /** `--tags`：连带本地所有标签一起推送 */
  pushTags?: boolean;
}

export interface ProgressEvent {
  operation: string;
  current: number;
  total: number;
  message: string;
}

export interface Commands {
  openRepo(path: string): Promise<RepoOpenResult>;
  getLog(repoPath: string, filter: LogFilter): Promise<LogResult>;
  getCommitDetail(repoPath: string, commitId: string): Promise<CommitInfo>;
  getCommitFiles(repoPath: string, commitId: string): Promise<FileStatus[]>;
  getCommitDiff(repoPath: string, commitId: string, filePath: string): Promise<DiffResult>;
  getFileDiff(repoPath: string, filePath: string, staged: boolean): Promise<DiffResult>;
  compareCommits(repoPath: string, fromId: string, toId: string): Promise<FileStatus[]>;
  getBranches(repoPath: string): Promise<BranchesResult>;
  createBranch(repoPath: string, name: string, startPoint?: string): Promise<void>;
  checkoutBranch(repoPath: string, name: string): Promise<void>;
  forceCheckoutBranch(repoPath: string, name: string): Promise<void>;
  smartCheckoutBranch(repoPath: string, name: string): Promise<MergeResult>;
  previewCheckoutConflicts(
    repoPath: string,
    branch: string,
    dirtyFiles: string[]
  ): Promise<{ wouldConflict: string[]; safe: string[] }>;
  deleteBranch(repoPath: string, name: string, force: boolean): Promise<void>;
  renameBranch(repoPath: string, oldName: string, newName: string): Promise<void>;
  mergeBranch(repoPath: string, name: string): Promise<MergeResult>;
  rebaseBranch(repoPath: string, upstream: string): Promise<MergeResult>;
  cherryPick(repoPath: string, commitId: string): Promise<MergeResult>;
  revertCommit(repoPath: string, commitId: string): Promise<MergeResult>;
  resetToCommit(
    repoPath: string,
    commitId: string,
    mode: "soft" | "mixed" | "hard"
  ): Promise<void>;
  squashCommits(repoPath: string, count: number, message: string): Promise<string>;
  getStatus(repoPath: string): Promise<StatusResult>;
  stageFile(repoPath: string, filePath: string): Promise<void>;
  unstageFile(repoPath: string, filePath: string): Promise<void>;
  stageAll(repoPath: string): Promise<void>;
  unstageAll(repoPath: string): Promise<void>;
  commit(repoPath: string, message: string, amend: boolean): Promise<string>;
  push(
    repoPath: string,
    remote?: string,
    branch?: string,
    options?: PushOptions
  ): Promise<void>;
  getUnpushedCommits(
    repoPath: string,
    remote?: string,
    branch?: string
  ): Promise<CommitInfo[]>;
  pull(repoPath: string, remote?: string, rebase?: boolean): Promise<MergeResult>;
  fetch(repoPath: string, remote?: string): Promise<void>;
  fetchAll(repoPath: string): Promise<void>;
  fetchBranch(repoPath: string, remote: string, branchName: string): Promise<void>;
  getRemotes(repoPath: string): Promise<RemoteInfo[]>;
  getStashList(repoPath: string): Promise<StashEntry[]>;
  stashSave(repoPath: string, message: string, includeUntracked: boolean): Promise<void>;
  stashApply(repoPath: string, index: number): Promise<void>;
  stashPop(repoPath: string, index: number): Promise<void>;
  stashDrop(repoPath: string, index: number): Promise<void>;
  getStashFiles(repoPath: string, index: number): Promise<FileStatus[]>;
  getStashFileDiff(
    repoPath: string,
    index: number,
    filePath: string
  ): Promise<DiffResult>;
  getBlame(repoPath: string, filePath: string, commitId?: string): Promise<BlameInfo>;
  getConflictFiles(repoPath: string): Promise<string[]>;
  getConflictContent(repoPath: string, filePath: string): Promise<ConflictFile>;
  resolveConflict(repoPath: string, filePath: string, content: string): Promise<void>;
  getWorkingFileContent(repoPath: string, filePath: string): Promise<string>;
  getMergeState(repoPath: string): Promise<{
    state: "none" | "merge" | "rebase" | "cherry-pick" | "revert";
    hasConflicts: boolean;
  }>;
  continueOperation(
    repoPath: string,
    op: "merge" | "rebase" | "cherry-pick" | "revert"
  ): Promise<MergeResult>;
  abortOperation(
    repoPath: string,
    op: "merge" | "rebase" | "cherry-pick" | "revert"
  ): Promise<void>;
  cloneRepo(url: string, path: string): Promise<void>;
  getFileContent(repoPath: string, commitId: string, filePath: string): Promise<string>;
  discardFileChanges(repoPath: string, filePath: string): Promise<void>;
  getFileDiffRaw(repoPath: string, filePath: string, staged: boolean): Promise<string>;
  deleteFile(repoPath: string, filePath: string): Promise<void>;
  stashFile(repoPath: string, filePath: string, message?: string): Promise<void>;
  createTag(
    repoPath: string,
    name: string,
    commitId?: string,
    message?: string
  ): Promise<void>;
  deleteTag(repoPath: string, name: string): Promise<void>;
  pushTag(repoPath: string, remote: string, name: string): Promise<void>;
  deleteRemoteTag(repoPath: string, remote: string, name: string): Promise<void>;
  checkoutTag(repoPath: string, name: string): Promise<void>;
  getReflog(repoPath: string, limit?: number): Promise<ReflogEntry[]>;
  createPatch(repoPath: string, commitId: string): Promise<string>;
  applyPatch(repoPath: string, patchContent: string): Promise<MergeResult>;
  getSubmodules(repoPath: string): Promise<Submodule[]>;
  initSubmodules(repoPath: string, paths?: string[]): Promise<void>;
  updateSubmodules(repoPath: string, paths?: string[]): Promise<void>;
  syncSubmodules(repoPath: string, paths?: string[]): Promise<void>;
}

export interface Platform {
  isElectron: boolean;
  selectDirectory(): Promise<string | null>;
}
