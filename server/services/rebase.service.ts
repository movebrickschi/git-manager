/**
 * Interactive Rebase 服务（IDEA 风格 Rebase Editor）。
 *
 * 设计核心：把 reword / squash 的"打开编辑器改消息"步骤，转译为 todo 文件中的
 * `exec git commit --amend -m '<new message>'` 行；这样**只需** GIT_SEQUENCE_EDITOR
 * 一个临时脚本，无需 GIT_EDITOR（GIT_EDITOR 会被多次调用、状态难追踪、跨平台脆弱）。
 *
 * 用户能选 6 种 action：pick / drop / reword / squash / fixup / edit。
 * - pick：原 commit 不动
 * - drop：丢弃该 commit
 * - reword：保留 commit + 改 message（pick + exec --amend -m）
 * - squash：合并到上一个 commit（顺序所需的合并语义；UI 必须保证不是第一行）
 * - fixup：squash 的兄弟语义，丢弃本 commit 自己的 message
 * - edit：rebase 到该 commit 后**暂停**，等用户改完文件再 `git rebase --continue`
 *
 * UI 的 reorder 通过 todos[] 元素位置体现，无需服务端再做排序。
 *
 * 调用方式：
 * - `getRebaseTodoPreview(repoPath, baseRef)`：返回 baseRef..HEAD 的 commit 列表，
 *   UI 用来构造初始 todo（默认全部 pick）
 * - `startInteractiveRebase(repoPath, baseRef, todos)`：序列化 todos 为 git
 *   rebase todo 格式 → 启 GIT_SEQUENCE_EDITOR → 跑 `git rebase -i <baseRef>`
 * - `getRebaseStatus(repoPath)`：读 .git/rebase-merge/ 下的进度文件，返回当前
 *   step / total / 当前 commit / 当前 action / conflict 列表
 *
 * Continue / Abort 复用 conflict.service 的 continueOperation('rebase') /
 * abortOperation('rebase')。
 */
import * as path from "path";
import * as fs from "fs";
import type { CommitInfo, MergeResult } from "../git-service.js";
import { errStr, getConflictFiles, getGit, LOG_FORMAT, parseRefs } from "./_helpers.js";
import { createSequenceEditor, shellEscapeSingleQuote } from "../utils/git-rebase-editor.js";

export type RebaseAction = "pick" | "drop" | "reword" | "squash" | "fixup" | "edit";

/** UI 提交给后端的一行 rebase 编排。`newMessage` 仅 reword 必填。 */
export interface RebaseTodoEntry {
  action: RebaseAction;
  commitId: string;
  shortId: string;
  subject: string;
  /** 当 action === "reword" 时，作为 `git commit --amend -m <msg>` 的新消息 */
  newMessage?: string;
}

export interface RebaseStatus {
  /** 是否处于 rebase 半成态（rebase-merge / rebase-apply 任一存在） */
  inProgress: boolean;
  /** 总步骤数（todo + done 行数之和） */
  total: number;
  /** 已完成步骤数 */
  done: number;
  /** 当前正在执行的 commit id（rebase-merge/stopped-sha 或当前 todo 第一行） */
  currentCommitId: string | null;
  /** 当前 action（来自 todo 当前行第一个 token） */
  currentAction: string | null;
  /** 冲突文件列表（如有） */
  conflictFiles: string[];
}

export const rebaseService = {
  /**
   * 列出 baseRef..HEAD 之间的所有 commit（不含 baseRef 本身），按时间倒序但
   * UI 渲染时通常**反转**为时间正序（git rebase todo 文件也是时间正序）。
   */
  async getRebaseTodoPreview(repoPath: string, baseRef: string): Promise<CommitInfo[]> {
    if (typeof baseRef !== "string" || baseRef.trim().length === 0) {
      throw new Error("getRebaseTodoPreview: baseRef 不能为空");
    }
    const git = getGit(repoPath);
    // 用 LOG_FORMAT 保持与 logService 一致的 CommitInfo 形状
    const raw = await git.raw([
      "log",
      "--reverse",
      `--pretty=format:${LOG_FORMAT}`,
      `${baseRef}..HEAD`,
    ]);
    if (!raw.trim()) return [];
    const headBranch = await git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    return lines.map((line) => {
      const parts = line.split("\x00");
      const parents = (parts[9] || "").trim().split(/\s+/).filter(Boolean);
      return {
        id: parts[0] || "",
        shortId: parts[1] || "",
        message: parts[2] || "",
        summary: parts[2] || "",
        author: parts[3] || "",
        authorEmail: parts[4] || "",
        authorTime: parseInt(parts[5] || "0", 10) * 1000,
        committer: parts[6] || "",
        committerEmail: parts[7] || "",
        commitTime: parseInt(parts[8] || "0", 10) * 1000,
        parents,
        refs: parseRefs(parts[10] || "", headBranch),
        isMerge: parents.length > 1,
      };
    });
  },

  /**
   * 启动交互式 rebase。
   *
   * 流程：
   *   1. 校验 todos 非空、squash/fixup 不能是第一行（git 要求）
   *   2. 序列化为 git rebase todo 文本（含 exec --amend 转译）
   *   3. 写一次性 GIT_SEQUENCE_EDITOR 脚本
   *   4. 调 `git -c sequence.editor=<script> rebase -i <baseRef>`
   *      （同时 env 设 GIT_EDITOR=true 兜底任何意外的编辑器调用）
   *   5. 成功 → cleanup → 返回 success
   *      冲突 → 不 cleanup（用户后续 continue 还需该脚本被 git 重新调用？
   *      实际不会：编辑器只在最开始调一次，所以可以马上 cleanup）→ 返回 conflicts
   *
   * 注意：edit action 会让 git 在该 commit 停下；此时 git rebase 命令本身**会**
   * 报错退出（exit code 非 0），但 .git 留下 rebase-merge 半成态。我们把这种
   * "stopped at edit" 也当作"需要用户继续"返回。
   */
  async startInteractiveRebase(
    repoPath: string,
    baseRef: string,
    todos: RebaseTodoEntry[]
  ): Promise<MergeResult> {
    if (!Array.isArray(todos) || todos.length === 0) {
      throw new Error("startInteractiveRebase: todos 不能为空");
    }
    if (typeof baseRef !== "string" || baseRef.trim().length === 0) {
      throw new Error("startInteractiveRebase: baseRef 不能为空");
    }
    const firstAction = todos.find((t) => t.action !== "drop")?.action;
    if (firstAction === "squash" || firstAction === "fixup") {
      throw new Error("第一个非 drop 的 todo 不能是 squash/fixup（没有前一个 commit 可合并）");
    }

    const todoText = serializeTodos(todos);
    const editor = await createSequenceEditor(todoText);
    const git = getGit(repoPath);
    try {
      await git.env({
        ...process.env,
        GIT_SEQUENCE_EDITOR: editor.command,
        GIT_EDITOR: "true",
      }).raw(["rebase", "-i", "--no-autosquash", baseRef]);
      return { success: true, conflicts: [], message: "Interactive rebase 完成" };
    } catch (e: unknown) {
      // 区分"停在 edit"与"真冲突"——前者 hasConflicts=false 但 rebase 进行中
      const conflicts = await getConflictFiles(repoPath);
      const inProgress = await isRebaseInProgress(repoPath);
      if (inProgress) {
        return {
          success: false,
          conflicts,
          message:
            conflicts.length > 0
              ? `Rebase 在第 ${(await readRebaseProgress(repoPath)).done} 步遇到冲突，请解决后 Continue`
              : `Rebase 暂停（edit 步骤），请修改后 Continue`,
        };
      }
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Interactive rebase 失败",
      };
    } finally {
      await editor.cleanup();
    }
  },

  /**
   * 读 `.git/rebase-merge/` 进度文件获取当前 interactive rebase 状态。
   *
   * 文件含义（git 标准）：
   *   - `msgnum`：当前正在 / 即将执行的 step 编号（1-based）
   *   - `end`：总 step 数
   *   - `stopped-sha`：edit/conflict 暂停时的当前 commit
   *   - `git-rebase-todo`：剩余 todo
   *   - `done`：已完成 todo
   */
  async getRebaseStatus(repoPath: string): Promise<RebaseStatus> {
    const empty: RebaseStatus = {
      inProgress: false,
      total: 0,
      done: 0,
      currentCommitId: null,
      currentAction: null,
      conflictFiles: [],
    };
    if (!(await isRebaseInProgress(repoPath))) return empty;

    const progress = await readRebaseProgress(repoPath);
    const conflicts = await getConflictFiles(repoPath);
    return {
      inProgress: true,
      total: progress.total,
      done: progress.done,
      currentCommitId: progress.currentCommitId,
      currentAction: progress.currentAction,
      conflictFiles: conflicts,
    };
  },
};

/**
 * 把 RebaseTodoEntry[] 序列化为 git rebase todo 文件内容。
 *
 * 关键转译：
 *   reword X → pick X + exec git commit --amend --no-verify -m '<msg>'
 *
 * 注意 message 的 shell 转义；新消息用单引号包裹避免大多数特殊字符问题，
 * 单引号自己用 `'\''` 经典转义。
 */
export function serializeTodos(todos: RebaseTodoEntry[]): string {
  const lines: string[] = [];
  for (const t of todos) {
    if (t.action === "drop") {
      // git 支持 `drop` 直接丢弃；也接受 `d`
      lines.push(`drop ${t.shortId} ${t.subject}`);
    } else if (t.action === "fixup") {
      lines.push(`fixup ${t.shortId} ${t.subject}`);
    } else if (t.action === "squash") {
      lines.push(`squash ${t.shortId} ${t.subject}`);
    } else if (t.action === "edit") {
      lines.push(`edit ${t.shortId} ${t.subject}`);
    } else if (t.action === "reword") {
      const msg = (t.newMessage || t.subject).trim();
      lines.push(`pick ${t.shortId} ${t.subject}`);
      lines.push(
        `exec git commit --amend --no-verify -m '${shellEscapeSingleQuote(msg)}'`
      );
    } else {
      // pick (default)
      lines.push(`pick ${t.shortId} ${t.subject}`);
    }
  }
  // git 期望文件以换行结尾
  return lines.join("\n") + "\n";
}

async function isRebaseInProgress(repoPath: string): Promise<boolean> {
  const gitDir = path.join(repoPath, ".git");
  return (
    safeExists(path.join(gitDir, "rebase-merge")) ||
    safeExists(path.join(gitDir, "rebase-apply"))
  );
}

interface RebaseProgress {
  total: number;
  done: number;
  currentCommitId: string | null;
  currentAction: string | null;
}

async function readRebaseProgress(repoPath: string): Promise<RebaseProgress> {
  const mergeDir = path.join(repoPath, ".git", "rebase-merge");
  const result: RebaseProgress = {
    total: 0,
    done: 0,
    currentCommitId: null,
    currentAction: null,
  };
  if (!safeExists(mergeDir)) return result;
  try {
    const endStr = await fs.promises.readFile(path.join(mergeDir, "end"), "utf-8");
    result.total = parseInt(endStr.trim(), 10) || 0;
  } catch {
    // end 不存在就不读
  }
  try {
    const msgnumStr = await fs.promises.readFile(path.join(mergeDir, "msgnum"), "utf-8");
    // msgnum 是即将执行的 step 编号（1-based），done = msgnum - 1
    const msgnum = parseInt(msgnumStr.trim(), 10) || 0;
    result.done = Math.max(0, msgnum - 1);
  } catch {
    // 读不到时 done 维持 0
  }
  try {
    const sha = (
      await fs.promises.readFile(path.join(mergeDir, "stopped-sha"), "utf-8")
    ).trim();
    if (sha) result.currentCommitId = sha;
  } catch {
    // 没 stopped-sha 说明不是 stop 状态
  }
  // 当前 action：todo 文件第一行第一个 token
  try {
    const todoRaw = await fs.promises.readFile(
      path.join(mergeDir, "git-rebase-todo"),
      "utf-8"
    );
    const firstLine = todoRaw.split("\n").find((l) => l.trim() && !l.startsWith("#"));
    if (firstLine) {
      const token = firstLine.trim().split(/\s+/)[0];
      if (token) result.currentAction = token;
    }
  } catch {
    // 没 todo 文件说明 rebase 即将结束
  }
  return result;
}

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
