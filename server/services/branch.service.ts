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

  /**
   * 强制切换分支（`git checkout -f <name>`）。
   * 工作区 dirty 时调用方应已明确警告用户：本地未提交修改会丢失。
   */
  async forceCheckoutBranch(repoPath: string, name: string): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["checkout", "-f", name]);
  },

  /**
   * 预检测切到 `branch` 后会冲突的本地 dirty 文件。
   *
   * 算法：拿到 `git diff HEAD..<branch> --name-only` 列出两端不同的文件路径，
   * 与传入 `dirtyFiles` 取交集即"会被覆盖/冲突"的文件，其余为"Smart Checkout
   * 可安全保留"的文件。
   *
   * 注意：
   * - 未传 `dirtyFiles`（或空数组）时返回 `{ wouldConflict: [], safe: [] }`，
   *   表示工作区干净、无需检测。
   * - rename 检测关闭（--no-renames）以避免噪音误判；对绝大多数 conflict 场景已够用。
   * - 出错时回退到"假设全部冲突"，避免对用户误导为"安全"。
   */
  async previewCheckoutConflicts(
    repoPath: string,
    branch: string,
    dirtyFiles: string[]
  ): Promise<{ wouldConflict: string[]; safe: string[] }> {
    if (!Array.isArray(dirtyFiles) || dirtyFiles.length === 0) {
      return { wouldConflict: [], safe: [] };
    }
    const git = getGit(repoPath);
    try {
      const raw = await git.raw([
        "diff",
        "--name-only",
        "--no-renames",
        `HEAD..${branch}`,
      ]);
      const changed = new Set(
        raw
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      );
      const wouldConflict: string[] = [];
      const safe: string[] = [];
      for (const f of dirtyFiles) {
        if (changed.has(f)) wouldConflict.push(f);
        else safe.push(f);
      }
      return { wouldConflict, safe };
    } catch {
      return { wouldConflict: [...dirtyFiles], safe: [] };
    }
  },

  /**
   * Smart checkout（仿 IntelliJ IDEA）：
   *   1. `git stash push --include-untracked -m <auto-tag>` 暂存全部 dirty
   *   2. `git checkout <name>` 切到目标分支
   *   3. `git stash pop` 把暂存还原到新分支工作区
   * 任一步失败均回滚（pop 冲突时 stash 仍在栈顶，由调用方/用户后续处理）。
   *
   * 返回 MergeResult：
   * - ok=true · message="..."：三步全部成功
   * - ok=false · conflicts=[paths]：stash pop 时遇到冲突（已切到新分支）
   * - ok=false · message=err：stash 或 checkout 阶段失败，仍在原分支
   */
  async smartCheckoutBranch(repoPath: string, name: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    const tag = `gitmanager-auto-stash-before-checkout-${name}-${Date.now()}`;
    try {
      await git.raw(["stash", "push", "--include-untracked", "-m", tag]);
    } catch (e: unknown) {
      return {
        success: false,
        conflicts: [],
        message: `stash 失败：${errStr(e) || "未知错误"}`,
      };
    }
    try {
      await git.checkout(name);
    } catch (e: unknown) {
      await git.raw(["stash", "pop"]).catch(() => {});
      return {
        success: false,
        conflicts: [],
        message: `checkout 失败（已恢复 stash）：${errStr(e) || "未知错误"}`,
      };
    }
    try {
      await git.raw(["stash", "pop"]);
      return { success: true, conflicts: [], message: `已切换到 '${name}' 并恢复本地修改` };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: `已切到 '${name}'，但 stash pop 冲突，stash 保留在栈顶：${errStr(e) || "请手动处理"}`,
      };
    }
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
   * Squash 最近 `count` 个 commit（含 HEAD）为一个新 commit。
   *
   * 实现：`git reset --soft HEAD~count` 把 HEAD 移到 base，所有改动保留在 index，
   * 再 `git commit -m <message>` 创建合并后的新 commit。该实现只在"从 HEAD 起的
   * 连续 count 个 commit"语义下工作；前端必须自行校验这一前提。
   *
   * 失败场景：
   * - 仓库历史不足 count 个 commit（HEAD~count 不存在）→ git reset 报错
   * - 有未 staged 的本地改动也会"被并入"新 commit（这是 --soft 的行为，符合用户意图）
   */
  async squashCommits(repoPath: string, count: number, message: string): Promise<string> {
    if (!Number.isInteger(count) || count < 2) {
      throw new Error("squashCommits: count 必须 >= 2");
    }
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new Error("squashCommits: message 不能为空");
    }
    const git = getGit(repoPath);
    await git.raw(["reset", "--soft", `HEAD~${count}`]);
    await git.commit(message);
    const head = (await git.revparse(["HEAD"])).trim();
    return head;
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
