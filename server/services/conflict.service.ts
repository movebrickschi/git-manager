import * as fs from "fs";
import { execFile as execFileCb } from "node:child_process";
import * as path from "path";
import { promisify } from "node:util";
import type { ConflictFile, MergeResult } from "../git-service.js";
import { safeJoin } from "../utils/path-safe.js";
import { decodeBufferToText, errStr, getConflictFiles, getGit } from "./_helpers.js";

const execFile = promisify(execFileCb);

type MergeOp = "merge" | "rebase" | "cherry-pick" | "revert";

/**
 * 通过 `git cat-file` 读出 stage N 的 blob，按 buffer 解码，
 * 复用 decodeBufferToText 让 PowerShell 写出的 UTF-16 文件也能正确显示。
 * blob 不存在（如 :2: 在 deleted-by-them 情形下没有）返回空字符串。
 */
async function readStageBlobAsText(repoPath: string, stage: 1 | 2 | 3, filePath: string): Promise<string> {
  try {
    const { stdout } = await execFile(
      "git",
      ["-C", repoPath, "cat-file", "-p", `:${stage}:${filePath}`],
      { maxBuffer: 8 * 1024 * 1024, encoding: "buffer" }
    );
    const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    const { text } = decodeBufferToText(buf);
    return text ?? "";
  } catch {
    return "";
  }
}

export const conflictService = {
  async getConflictFiles(repoPath: string): Promise<string[]> {
    return getConflictFiles(repoPath);
  },

  async getConflictContent(repoPath: string, filePath: string): Promise<ConflictFile> {
    const [ours, theirs, base] = await Promise.all([
      readStageBlobAsText(repoPath, 2, filePath),
      readStageBlobAsText(repoPath, 3, filePath),
      readStageBlobAsText(repoPath, 1, filePath),
    ]);
    return {
      path: filePath,
      oursContent: ours,
      theirsContent: theirs,
      baseContent: base,
    };
  },

  async resolveConflict(repoPath: string, filePath: string, content: string): Promise<void> {
    const fullPath = safeJoin(repoPath, filePath);
    await fs.promises.writeFile(fullPath, content, "utf-8");
    const git = getGit(repoPath);
    await git.add(filePath);
  },

  /**
   * 检测仓库当前是否处于 merge / rebase / cherry-pick / revert 半成态。
   * 通过 .git 目录下的标记文件判断（git 标准实现）。
   *
   * 用 fs.promises.access 而非 fs.existsSync —— 同步 I/O 在慢盘 / 网络盘上会
   * 卡 event loop，对 Express worker thread 与 Electron main 都不友好。
   */
  async getMergeState(
    repoPath: string
  ): Promise<{ state: "none" | MergeOp; hasConflicts: boolean }> {
    const gitDir = path.join(repoPath, ".git");
    const checkFile = async (rel: string): Promise<boolean> => {
      try {
        await fs.promises.access(path.join(gitDir, rel));
        return true;
      } catch {
        return false;
      }
    };
    const [hasMerge, hasRebaseMerge, hasRebaseApply, hasCherry, hasRevert, conflicts] =
      await Promise.all([
        checkFile("MERGE_HEAD"),
        checkFile("rebase-merge"),
        checkFile("rebase-apply"),
        checkFile("CHERRY_PICK_HEAD"),
        checkFile("REVERT_HEAD"),
        getConflictFiles(repoPath),
      ]);
    let state: "none" | MergeOp = "none";
    if (hasMerge) state = "merge";
    else if (hasRebaseMerge || hasRebaseApply) state = "rebase";
    else if (hasCherry) state = "cherry-pick";
    else if (hasRevert) state = "revert";
    return { state, hasConflicts: conflicts.length > 0 };
  },

  async continueOperation(repoPath: string, op: MergeOp): Promise<MergeResult> {
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
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || `${op} continue failed`,
      };
    }
  },

  async abortOperation(repoPath: string, op: MergeOp): Promise<void> {
    const git = getGit(repoPath);
    if (op === "merge") await git.raw(["merge", "--abort"]);
    else if (op === "rebase") await git.raw(["rebase", "--abort"]);
    else if (op === "cherry-pick") await git.raw(["cherry-pick", "--abort"]);
    else await git.raw(["revert", "--abort"]);
  },
};
