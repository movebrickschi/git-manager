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

export interface DiffResult {
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
  deleteBranch(repoPath: string, name: string, force: boolean): Promise<void>;
  renameBranch(repoPath: string, oldName: string, newName: string): Promise<void>;
  mergeBranch(repoPath: string, name: string): Promise<MergeResult>;
  rebaseBranch(repoPath: string, upstream: string): Promise<MergeResult>;
  cherryPick(repoPath: string, commitId: string): Promise<MergeResult>;
  revertCommit(repoPath: string, commitId: string): Promise<MergeResult>;
  resetToCommit(repoPath: string, commitId: string, mode: "soft" | "mixed" | "hard"): Promise<void>;
  getStatus(repoPath: string): Promise<StatusResult>;
  stageFile(repoPath: string, filePath: string): Promise<void>;
  unstageFile(repoPath: string, filePath: string): Promise<void>;
  stageAll(repoPath: string): Promise<void>;
  unstageAll(repoPath: string): Promise<void>;
  commit(repoPath: string, message: string, amend: boolean): Promise<string>;
  push(repoPath: string, remote?: string, branch?: string): Promise<void>;
  getUnpushedCommits(repoPath: string, remote?: string, branch?: string): Promise<CommitInfo[]>;
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
  getStashFileDiff(repoPath: string, index: number, filePath: string): Promise<DiffResult>;
  getBlame(repoPath: string, filePath: string, commitId?: string): Promise<BlameInfo>;
  getConflictFiles(repoPath: string): Promise<string[]>;
  getConflictContent(repoPath: string, filePath: string): Promise<ConflictFile>;
  resolveConflict(repoPath: string, filePath: string, content: string): Promise<void>;
  getWorkingFileContent(repoPath: string, filePath: string): Promise<string>;
  cloneRepo(url: string, path: string): Promise<void>;
  getFileContent(repoPath: string, commitId: string, filePath: string): Promise<string>;
  discardFileChanges(repoPath: string, filePath: string): Promise<void>;
  getFileDiffRaw(repoPath: string, filePath: string, staged: boolean): Promise<string>;
  deleteFile(repoPath: string, filePath: string): Promise<void>;
  stashFile(repoPath: string, filePath: string, message?: string): Promise<void>;
}

export interface Platform {
  isElectron: boolean;
  selectDirectory(): Promise<string | null>;
}
