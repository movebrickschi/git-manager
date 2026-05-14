import type { CommitInfo, MergeResult, RemoteInfo } from "../git-service.js";
import {
  errStr,
  getConflictFiles,
  getGit,
  parseRefs,
  withRetry,
  LOG_FORMAT,
} from "./_helpers.js";

export const remoteService = {
  async push(repoPath: string, remote?: string, branch?: string): Promise<void> {
    const git = getGit(repoPath);
    const args: string[] = ["push"];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    await withRetry(() => git.raw(args), { label: `push ${remote ?? ""} ${branch ?? ""}` });
  },

  /**
   * Smart Pull —— 仿 IntelliJ IDEA「Update Project (Stash)」默认行为。
   *
   * 流程：
   *   1. 检测工作区是否 dirty（含未暂存修改 / 未跟踪文件）
   *   2. 若 dirty：`git stash push --include-untracked -m '...'`
   *   3. `git pull [--rebase] [remote]`
   *   4. 若步骤 2 stash 过：`git stash pop`
   *
   * 异常处理（按 git 状态机的真实分支返回不同 MergeResult）：
   *   - stash 阶段失败 → 早返回，仓库状态保持原样
   *   - pull 阶段失败 + 产生 conflict（remote vs HEAD 的真实 merge 冲突）
   *       → 不 pop stash，返回 conflicts 让前端弹 ThreeWayMerge；
   *         用户解决 merge conflict 并 commit 后，自行 `stash pop` 恢复改动
   *   - pull 阶段失败 + 无 conflict（网络 / auth / non-fast-forward 等）
   *       → 回滚 stash pop 把仓库状态还原；返回原始错误
   *   - pull 成功 + stash pop 失败且产生 conflict
   *       → 返回 conflicts 让前端弹 ThreeWayMerge；stash 仍保留在 list 上
   *   - pull 成功 + stash pop 其它失败
   *       → 返回错误提示 stash 仍可恢复
   */
  async pull(repoPath: string, remote?: string, rebase?: boolean): Promise<MergeResult> {
    const git = getGit(repoPath);

    let isDirty: boolean;
    try {
      const status = await git.status();
      isDirty = status.files.length > 0;
    } catch (e: unknown) {
      return {
        success: false,
        conflicts: [],
        message: errStr(e) || "Failed to read working tree status",
      };
    }

    let autoStashed = false;
    if (isDirty) {
      try {
        const stashMsg = `git-manager: auto-stash before pull @ ${new Date().toISOString()}`;
        await git.raw(["stash", "push", "--include-untracked", "-m", stashMsg]);
        autoStashed = true;
      } catch (e: unknown) {
        return {
          success: false,
          conflicts: [],
          message: `Auto stash failed: ${errStr(e)}`,
        };
      }
    }

    let pullErr: unknown = null;
    try {
      const args: string[] = ["pull"];
      if (rebase) args.push("--rebase");
      if (remote) args.push(remote);
      await git.raw(args);
    } catch (e: unknown) {
      pullErr = e;
    }

    if (pullErr) {
      const conflicts = await getConflictFiles(repoPath);
      if (conflicts.length > 0) {
        return {
          success: false,
          conflicts,
          message: errStr(pullErr) || "Pull produced merge conflicts",
        };
      }
      if (autoStashed) {
        try {
          await git.raw(["stash", "pop"]);
        } catch {
          // pop 失败也无所谓，stash 还在 list 中，下方提示用户
        }
      }
      return {
        success: false,
        conflicts: [],
        message: errStr(pullErr) || "Pull failed",
      };
    }

    if (autoStashed) {
      try {
        await git.raw(["stash", "pop"]);
        return {
          success: true,
          conflicts: [],
          message: "Pull completed (local changes auto-stashed and restored)",
        };
      } catch (e: unknown) {
        const conflicts = await getConflictFiles(repoPath);
        if (conflicts.length > 0) {
          return {
            success: false,
            conflicts,
            message:
              "Pull completed, but restoring stashed local changes caused conflicts. " +
              "Resolve them and then drop stash@{0} manually.",
          };
        }
        return {
          success: false,
          conflicts: [],
          message:
            `Pull completed, but stash pop failed: ${errStr(e)}. ` +
            "Your local changes are still saved in stash@{0}.",
        };
      }
    }

    return { success: true, conflicts: [], message: "Pull completed" };
  },

  async fetch(repoPath: string, remote?: string): Promise<void> {
    const git = getGit(repoPath);
    await withRetry(() => (remote ? git.fetch(remote) : git.fetch()), {
      label: `fetch ${remote ?? "(default)"}`,
    });
  },

  async fetchAll(repoPath: string): Promise<void> {
    const git = getGit(repoPath);
    await withRetry(() => git.fetch(["--all"]), { label: "fetch --all" });
  },

  async fetchBranch(repoPath: string, remote: string, branchName: string): Promise<void> {
    const git = getGit(repoPath);
    await withRetry(() => git.raw(["fetch", remote, `${branchName}:${branchName}`]), {
      label: `fetch ${remote} ${branchName}`,
    });
  },

  async getRemotes(repoPath: string): Promise<RemoteInfo[]> {
    const git = getGit(repoPath);
    const remotes = await git.getRemotes(true);
    return remotes.map((r) => ({
      name: r.name,
      url: r.refs.push ?? r.refs.fetch ?? "",
      fetchUrl: r.refs.fetch ?? "",
    }));
  },

  async getUnpushedCommits(
    repoPath: string,
    remote?: string,
    branch?: string
  ): Promise<CommitInfo[]> {
    const git = getGit(repoPath);

    let rangeArg: string;
    try {
      if (remote && branch) {
        rangeArg = `${remote}/${branch}..HEAD`;
      } else {
        await git.raw(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
        rangeArg = "@{u}..HEAD";
      }
    } catch {
      return [];
    }

    let raw: string;
    try {
      raw = await git.raw(["log", rangeArg, `--format=${LOG_FORMAT}%x01`]);
    } catch {
      return [];
    }

    const branchSummary = await git.branch();
    const headBranch = branchSummary.current;
    const commits: CommitInfo[] = [];
    const entries = raw
      .split("\x01")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const entry of entries) {
      const fields = entry.split("\x00");
      if (fields.length < 11) continue;
      const [
        id,
        shortId,
        summary,
        author,
        authorEmail,
        atStr,
        committer,
        committerEmail,
        ctStr,
        parentStr,
        refStr,
      ] = fields;
      if (!id || id.length < 7) continue;
      const parents = parentStr ? parentStr.split(" ").filter(Boolean) : [];
      commits.push({
        id,
        shortId: shortId ?? "",
        message: summary ?? "",
        summary: summary ?? "",
        author: author ?? "",
        authorEmail: authorEmail ?? "",
        authorTime: parseInt(atStr ?? "0") * 1000,
        committer: committer ?? "",
        committerEmail: committerEmail ?? "",
        commitTime: parseInt(ctStr ?? "0") * 1000,
        parents,
        refs: parseRefs(refStr ?? "", headBranch),
        isMerge: parents.length > 1,
      });
    }
    return commits;
  },
};
