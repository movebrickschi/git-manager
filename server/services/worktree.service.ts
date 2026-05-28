/**
 * Worktree Service · Git Worktree（多工作树）管理
 *
 * 等价命令：
 *   git worktree list --porcelain         # 列出
 *   git worktree add <path> [<branch>]    # 新建
 *   git worktree remove <path>            # 删除
 *   git worktree lock/unlock <path>       # 锁/解锁
 *   git worktree prune                    # 清理失效记录
 *
 * porcelain 输出格式（按段，段间空行分隔）：
 *   worktree /abs/path
 *   HEAD 6b4ce92...
 *   branch refs/heads/feature
 *   [bare | detached | locked [reason]]
 */
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface WorktreeInfo {
  /** 工作树绝对路径 */
  path: string;
  /** 当前 HEAD sha；detached 状态仍有 */
  head: string;
  /** 分支名（不含 refs/heads/）；detached 时为 null */
  branch: string | null;
  /** detached HEAD 状态 */
  detached: boolean;
  /** bare 仓库（无工作目录） */
  bare: boolean;
  /** lock 状态（locked 不可 remove） */
  locked: boolean;
  /** locked 原因（git worktree lock --reason 时设置） */
  lockReason: string | null;
  /** 主工作树（main worktree）。git worktree list 的第一条通常是主 */
  main: boolean;
}

export const worktreeService = {
  /** 列出所有 worktree（含主 + 附加），按 git worktree list 顺序返回。 */
  async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const { stdout } = await execFile(
      "git",
      ["-C", repoPath, "worktree", "list", "--porcelain"],
      { encoding: "utf8", maxBuffer: 1024 * 1024 }
    );
    return parseWorktreePorcelain(stdout);
  },

  /**
   * 新建一个 worktree。
   * @param targetPath 工作树落盘绝对路径（不能与现有 worktree 重叠）
   * @param branchOrCommit 可选：现有分支名 / commit sha；不传则从 HEAD 创建 detached
   * @param createBranch 可选：新建分支名（git worktree add -b <new> <path> <start>）
   */
  async addWorktree(
    repoPath: string,
    targetPath: string,
    branchOrCommit?: string,
    createBranch?: string
  ): Promise<void> {
    if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
      throw new Error("INVALID_PATH: worktree 路径不能为空");
    }
    const args = ["worktree", "add"];
    if (createBranch) {
      args.push("-b", createBranch);
    }
    args.push(targetPath.trim());
    if (branchOrCommit) args.push(branchOrCommit);
    await execFile("git", ["-C", repoPath, ...args], { encoding: "utf8" });
  },

  /**
   * 删除 worktree。
   * @param force 工作树 dirty 或 locked 时也强制删（小心）
   */
  async removeWorktree(repoPath: string, targetPath: string, force = false): Promise<void> {
    const args = ["worktree", "remove"];
    if (force) args.push("--force");
    args.push(targetPath);
    await execFile("git", ["-C", repoPath, ...args], { encoding: "utf8" });
  },

  /** 锁定 worktree（防止误删 / git worktree prune 误清） */
  async lockWorktree(repoPath: string, targetPath: string, reason?: string): Promise<void> {
    const args = ["worktree", "lock"];
    if (reason && reason.trim()) {
      args.push("--reason", reason.trim());
    }
    args.push(targetPath);
    await execFile("git", ["-C", repoPath, ...args], { encoding: "utf8" });
  },

  /** 解锁 worktree */
  async unlockWorktree(repoPath: string, targetPath: string): Promise<void> {
    await execFile(
      "git",
      ["-C", repoPath, "worktree", "unlock", targetPath],
      { encoding: "utf8" }
    );
  },

  /** 清理失效 worktree 记录（git worktree prune） */
  async pruneWorktrees(repoPath: string): Promise<void> {
    await execFile("git", ["-C", repoPath, "worktree", "prune"], { encoding: "utf8" });
  },
};

/**
 * 解析 `git worktree list --porcelain` 输出。
 *
 * 输出按段；每段以 `worktree <path>` 开头，键值对到下一空行结束。
 * 第一段是主工作树。
 */
export function parseWorktreePorcelain(raw: string): WorktreeInfo[] {
  if (!raw.trim()) return [];
  const sections = raw.split(/\r?\n\r?\n/).filter((s) => s.trim().length > 0);
  const list: WorktreeInfo[] = [];
  sections.forEach((section, idx) => {
    const lines = section.split(/\r?\n/);
    let path = "";
    let head = "";
    let branch: string | null = null;
    let detached = false;
    let bare = false;
    let locked = false;
    let lockReason: string | null = null;
    for (const line of lines) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim();
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length).trim();
      else if (line.startsWith("branch ")) {
        const raw = line.slice("branch ".length).trim();
        branch = raw.replace(/^refs\/heads\//, "");
      } else if (line === "detached") {
        detached = true;
      } else if (line === "bare") {
        bare = true;
      } else if (line === "locked" || line.startsWith("locked ")) {
        locked = true;
        const rest = line.slice("locked".length).trim();
        if (rest) lockReason = rest;
      }
    }
    if (!path) return;
    list.push({
      path,
      head,
      branch,
      detached,
      bare,
      locked,
      lockReason,
      main: idx === 0,
    });
  });
  return list;
}
