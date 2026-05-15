import type { BranchInfo, BranchesResult, MergeResult } from "../git-service.js";
import { errStr, getConflictFiles, getGit, parseBranchVerboseLabel } from "./_helpers.js";

export const branchService = {
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
      if (isRemote) remote.push(info);
      else local.push(info);
    }

    let tags: string[] = [];
    try {
      const tagResult = await git.tags();
      tags = tagResult.all;
    } catch {
      // no tags
    }
    return { local, remote, tags };
  },

  async createBranch(repoPath: string, name: string, startPoint?: string): Promise<void> {
    const git = getGit(repoPath);
    if (startPoint) await git.branch([name, startPoint]);
    else await git.branch([name]);
  },

  async checkoutBranch(repoPath: string, name: string): Promise<void> {
    const git = getGit(repoPath);
    await git.checkout(name);
  },

  async deleteBranch(repoPath: string, name: string, force: boolean): Promise<void> {
    const git = getGit(repoPath);
    await git.branch([force ? "-D" : "-d", name]);
  },

  async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
    const git = getGit(repoPath);
    await git.branch(["-m", oldName, newName]);
  },

  async mergeBranch(repoPath: string, name: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      const result = await git.merge([name]);
      const conflicts = (result.conflicts ?? []).map((c) =>
        typeof c === "string" ? c : ((c as { file?: string }).file ?? String(c))
      );
      return { success: true, conflicts, message: result.result ?? "Merge completed" };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Merge failed with conflicts",
      };
    }
  },

  async rebaseBranch(repoPath: string, upstream: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      await git.rebase([upstream]);
      return { success: true, conflicts: [], message: "Rebase completed" };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Rebase failed with conflicts",
      };
    }
  },

  async cherryPick(repoPath: string, commitId: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      await git.raw(["cherry-pick", commitId]);
      return { success: true, conflicts: [], message: "Cherry-pick completed" };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Cherry-pick failed with conflicts",
      };
    }
  },

  async revertCommit(repoPath: string, commitId: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      await git.raw(["revert", "--no-edit", commitId]);
      return { success: true, conflicts: [], message: "Revert completed" };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Revert failed with conflicts",
      };
    }
  },

  async resetToCommit(
    repoPath: string,
    commitId: string,
    mode: "soft" | "mixed" | "hard"
  ): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["reset", `--${mode}`, commitId]);
  },

  /**
   * 创建标签。
   * - 有 `message` → annotated tag（`git tag -a <name> -m <msg> [<commit>]`）
   * - 无 `message` → lightweight tag（`git tag <name> [<commit>]`）
   * - 无 `commitId` → 默认指向 HEAD
   */
  async createTag(
    repoPath: string,
    name: string,
    commitId?: string,
    message?: string
  ): Promise<void> {
    const git = getGit(repoPath);
    const args = ["tag"];
    if (message && message.length > 0) args.push("-a", "-m", message);
    args.push(name);
    if (commitId && commitId.length > 0) args.push(commitId);
    await git.raw(args);
  },

  async deleteTag(repoPath: string, name: string): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["tag", "-d", name]);
  },

  async pushTag(repoPath: string, remote: string, name: string): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["push", remote, name]);
  },

  /** 推一个空 ref 到 :refs/tags/<name> 实现远端 tag 删除（git 标准方式） */
  async deleteRemoteTag(repoPath: string, remote: string, name: string): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["push", remote, `:refs/tags/${name}`]);
  },

  /**
   * Checkout 标签会进入 detached HEAD。
   * 调用方通常应提示用户「这是分离头状态，需 checkout 分支返回」。
   */
  async checkoutTag(repoPath: string, name: string): Promise<void> {
    const git = getGit(repoPath);
    await git.checkout(`tags/${name}`);
  },
};
