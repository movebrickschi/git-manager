import * as fs from "fs";
import * as path from "path";
import type { ConflictFile, MergeResult } from "../git-service.js";
import { safeJoin } from "../utils/path-safe.js";
import { errStr, getConflictFiles, getGit } from "./_helpers.js";

type MergeOp = "merge" | "rebase" | "cherry-pick" | "revert";

export const conflictService = {
  async getConflictFiles(repoPath: string): Promise<string[]> {
    return getConflictFiles(repoPath);
  },

  async getConflictContent(repoPath: string, filePath: string): Promise<ConflictFile> {
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
  },

  async resolveConflict(repoPath: string, filePath: string, content: string): Promise<void> {
    const fullPath = safeJoin(repoPath, filePath);
    fs.writeFileSync(fullPath, content, "utf-8");
    const git = getGit(repoPath);
    await git.add(filePath);
  },

  /**
   * 检测仓库当前是否处于 merge / rebase / cherry-pick / revert 半成态。
   * 通过 .git 目录下的标记文件判断（git 标准实现）。
   */
  async getMergeState(
    repoPath: string
  ): Promise<{ state: "none" | MergeOp; hasConflicts: boolean }> {
    const gitDir = path.join(repoPath, ".git");
    const checkFile = (rel: string) => {
      try {
        return fs.existsSync(path.join(gitDir, rel));
      } catch {
        return false;
      }
    };
    let state: "none" | MergeOp = "none";
    if (checkFile("MERGE_HEAD")) state = "merge";
    else if (checkFile("rebase-merge") || checkFile("rebase-apply")) state = "rebase";
    else if (checkFile("CHERRY_PICK_HEAD")) state = "cherry-pick";
    else if (checkFile("REVERT_HEAD")) state = "revert";

    const conflicts = await getConflictFiles(repoPath);
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
