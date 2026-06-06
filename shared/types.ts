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

/** 批量文件操作（回滚 / 删除）的逐文件结果：ok 为成功路径，failed 携带失败原因。 */
export interface BatchFileResult {
  ok: string[];
  failed: { path: string; error: string }[];
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
  /**
   * 当本次操作前自动 stash 过本地改动、且随后产生冲突时携带，用于前端冲突解决后正确收尾：
   * - "merge"：pull 产生 merge 冲突，stash 尚未 pop（内含本地改动），解决后应 stash pop 恢复
   * - "stash-pop"：pull 已成功但 stash pop 撞车（改动已落工作区）→ 解决后应 stash drop
   */
  autoStash?: { kind: "merge" | "stash-pop" } | null;
}

/**
 * Interactive Rebase 的 todo 行。UI 上每行 commit 选择 6 种 action 之一。
 *
 * - `pick`：保留（默认）
 * - `drop`：丢弃
 * - `reword`：保留 commit 但用 `newMessage` 改写消息
 * - `squash`：合并到上一个 commit（保留所有 message）
 * - `fixup`：合并到上一个 commit（丢弃本 commit 自己的 message）
 * - `edit`：rebase 到该 commit 时**暂停**，等用户改完文件再 continue
 *
 * UI 拖拽 reorder 通过数组元素顺序体现，后端无需另读 sortKey。
 */
export type RebaseAction = "pick" | "drop" | "reword" | "squash" | "fixup" | "edit";

export interface RebaseTodoEntry {
  action: RebaseAction;
  commitId: string;
  shortId: string;
  subject: string;
  /** 当 action === "reword" 时，作为新 commit message；其它 action 忽略 */
  newMessage?: string;
}

/** Interactive Rebase 的实时状态，供 UI 在状态栏显示进度。 */
export interface RebaseStatus {
  inProgress: boolean;
  total: number;
  done: number;
  currentCommitId: string | null;
  currentAction: string | null;
  conflictFiles: string[];
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

/**
 * Pull 预检测结果（仿 IDEA「Update Project」弹窗前的状态摸底）。
 *
 * 字段语义：
 * - `dirtyFiles`：当前工作区脏文件（staged + unstaged + untracked），用户在 Pull 前没提交的所有改动
 * - `wouldConflict`：dirty ∩ remote-also-changed —— Smart Pull 时 stash pop 大概率冲突
 * - `safe`：dirty 中未与 remote 改动撞车的文件 —— Smart Pull 时基本能无痛恢复
 * - `upstream`：upstream 引用（如 `origin/main`），未设置 upstream 时为 null
 * - `remoteCommitsAhead`：remote 比 local 多几个 commit；为 0 表示本地已是最新
 * - `fetched`：true 表示 preview 期间成功 fetch 过最新远端；false 表示用户离线 / 认证失败，
 *   预测基于上次 fetch 的旧 remote tracking branch（UI 应提示"网络异常，预测可能过期"）
 */
export interface PullPreview {
  dirtyFiles: string[];
  wouldConflict: string[];
  safe: string[];
  upstream: string | null;
  remoteCommitsAhead: number;
  fetched: boolean;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
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

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  main: boolean;
}

export interface HookInfo {
  name: string;
  state: "enabled" | "disabled" | "sample-only" | "missing";
  filePath: string | null;
  size: number | null;
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
  ): Promise<{ wouldConflict: string[]; safe: string[]; untrackedConflict: string[] }>;
  deleteBranch(repoPath: string, name: string, force: boolean): Promise<void>;
  renameBranch(repoPath: string, oldName: string, newName: string): Promise<void>;
  mergeBranch(repoPath: string, name: string): Promise<MergeResult>;
  rebaseBranch(repoPath: string, upstream: string): Promise<MergeResult>;
  cherryPick(repoPath: string, commitId: string): Promise<MergeResult>;
  /** 批量 cherry-pick：commitIds 须按时间从旧到新排序。 */
  cherryPickRange(repoPath: string, commitIds: string[]): Promise<MergeResult>;
  /** Rebase --autosquash：自动合并 fixup!/squash! 提交，无需手动 interactive。 */
  rebaseAutosquash(repoPath: string, upstream: string): Promise<MergeResult>;
  revertCommit(repoPath: string, commitId: string): Promise<MergeResult>;
  resetToCommit(
    repoPath: string,
    commitId: string,
    mode: "soft" | "mixed" | "hard"
  ): Promise<void>;
  squashCommits(repoPath: string, count: number, message: string): Promise<string>;
  getRebaseTodoPreview(repoPath: string, baseRef: string): Promise<CommitInfo[]>;
  startInteractiveRebase(
    repoPath: string,
    baseRef: string,
    todos: RebaseTodoEntry[]
  ): Promise<MergeResult>;
  getRebaseStatus(repoPath: string): Promise<RebaseStatus>;
  getStatus(repoPath: string): Promise<StatusResult>;
  stageFile(repoPath: string, filePath: string): Promise<void>;
  unstageFile(repoPath: string, filePath: string): Promise<void>;
  stageAll(repoPath: string): Promise<void>;
  unstageAll(repoPath: string): Promise<void>;
  /** 一次性 stage N 个文件（`git add -- p1 p2 ... pN`），等价于 N 次 stageFile 但更快。 */
  stageFilesBatch(repoPath: string, filePaths: string[]): Promise<void>;
  /** 一次性 unstage N 个文件（`git reset HEAD -- p1 p2 ... pN`）。 */
  unstageFilesBatch(repoPath: string, filePaths: string[]): Promise<void>;
  /** 把文件路径追加到仓库根 .gitignore，自动去重 + 创建文件。 */
  addToGitignore(repoPath: string, filePath: string): Promise<void>;

  /** Worktree 管理（IDEA "Checkout in New Worktree"）。 */
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>;
  addWorktree(
    repoPath: string,
    targetPath: string,
    branchOrCommit?: string,
    createBranch?: string
  ): Promise<void>;
  removeWorktree(repoPath: string, targetPath: string, force?: boolean): Promise<void>;
  lockWorktree(repoPath: string, targetPath: string, reason?: string): Promise<void>;
  unlockWorktree(repoPath: string, targetPath: string): Promise<void>;
  pruneWorktrees(repoPath: string): Promise<void>;

  /** Git Hooks 管理。 */
  listHooks(repoPath: string): Promise<HookInfo[]>;
  readHookContent(repoPath: string, hookName: string): Promise<string>;
  writeHookContent(repoPath: string, hookName: string, content: string): Promise<void>;
  enableHook(repoPath: string, hookName: string): Promise<void>;
  disableHook(repoPath: string, hookName: string): Promise<void>;
  commit(repoPath: string, message: string, amend: boolean): Promise<string>;
  commitFixup(repoPath: string, commitId: string): Promise<string>;
  commitFiles(repoPath: string, filePaths: string[], message: string): Promise<string>;
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
  previewPullConflicts(repoPath: string, remote?: string): Promise<PullPreview>;
  forcePull(repoPath: string, remote?: string, rebase?: boolean): Promise<MergeResult>;
  getBehindCount(repoPath: string, remote: string, branch: string): Promise<AheadBehind>;
  fetch(repoPath: string, remote?: string): Promise<void>;
  fetchAll(repoPath: string): Promise<void>;
  fetchBranch(repoPath: string, remote: string, branchName: string): Promise<void>;
  getRemotes(repoPath: string): Promise<RemoteInfo[]>;
  getStashList(repoPath: string): Promise<StashEntry[]>;
  stashSave(repoPath: string, message: string, includeUntracked: boolean): Promise<void>;
  stashApply(repoPath: string, index: number): Promise<void>;
  stashPop(repoPath: string, index: number): Promise<void>;
  stashDrop(repoPath: string, index: number): Promise<void>;
  stashRename(repoPath: string, index: number, newMessage: string): Promise<void>;
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
  /** 一次性回滚 N 个文件到 HEAD（reset + checkout pathspec），返回逐文件成功/失败。 */
  discardFilesBatch(repoPath: string, filePaths: string[]): Promise<BatchFileResult>;
  getFileDiffRaw(repoPath: string, filePath: string, staged: boolean): Promise<string>;
  deleteFile(repoPath: string, filePath: string): Promise<void>;
  /** 一次性从磁盘删除 N 个文件（并发 unlink），返回逐文件成功/失败。 */
  deleteFilesBatch(repoPath: string, filePaths: string[]): Promise<BatchFileResult>;
  stashFile(repoPath: string, filePath: string, message?: string): Promise<void>;
  stashFiles(repoPath: string, filePaths: string[], message?: string): Promise<void>;
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
  /**
   * 在系统文件管理器中定位并高亮某个文件 / 目录。
   * - Electron：调 shell.showItemInFolder（Win 资源管理器 / macOS Finder / Linux xdg）
   * - Web：当前不支持，调用即 reject 错误码 NOT_SUPPORTED
   * 调用方传**绝对路径**；前端拼接 `repoPath + filePath` 时务必用 path.join 保留分隔符。
   */
  revealInFolder(absPath: string): Promise<void>;
}
