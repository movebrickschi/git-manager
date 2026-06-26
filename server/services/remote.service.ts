import type { AheadBehind, CommitInfo, MergeResult, PullPreview, PushOptions, RemoteInfo } from "../git-service.js";
import {
  errStr,
  getConflictFiles,
  getGit,
  getRemoteGit,
  parseRefs,
  withRetry,
  LOG_FORMAT,
} from "./_helpers.js";
import { cancelNetworkGit, runNetworkGit } from "./git-net.js";
import { buildAuthEnv } from "./credential.service.js";

export const remoteService = {
  async push(
    repoPath: string,
    remote?: string,
    branch?: string,
    options?: PushOptions
  ): Promise<void> {
    const args: string[] = ["push"];
    // forceWithLease 优先于 force（与 shared/types.ts 的契约一致）
    if (options?.forceWithLease) args.push("--force-with-lease");
    else if (options?.force) args.push("--force");
    if (options?.setUpstream) args.push("--set-upstream");
    if (options?.pushTags) args.push("--tags");
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    const extraEnv = await buildAuthEnv(repoPath);
    await withRetry(() => runNetworkGit(repoPath, args, { extraEnv }), {
      label: `push ${remote ?? ""} ${branch ?? ""}`,
    });
  },

  /**
   * 删除远程分支：`git push <remote> --delete <name>`。
   * 联网 + 破坏性（远端立即丢失该分支），调用方 UI 必须先二次确认。
   * git 会同步删除本地对应的 remote-tracking ref，前端 loadBranches 后即消失。
   */
  async deleteRemoteBranch(repoPath: string, remote: string, name: string): Promise<void> {
    const extraEnv = await buildAuthEnv(repoPath);
    await withRetry(
      () => runNetworkGit(repoPath, ["push", remote, "--delete", name], { extraEnv }),
      { label: `push ${remote} --delete ${name}` }
    );
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
    const git = getRemoteGit(repoPath);

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
      const extraEnv = await buildAuthEnv(repoPath);
      await runNetworkGit(repoPath, args, { extraEnv });
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
          // 若之前 auto-stash 过：stash 仍保留（未 pop），里面是本地改动，解决 merge 后需 pop 恢复
          autoStash: autoStashed ? { kind: "merge" } : null,
        };
      }
      if (autoStashed) {
        try {
          await git.raw(["stash", "pop", "--index"]);
        } catch {
          try { await git.raw(["stash", "pop"]); } catch { /* stash still in list */ }
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
        await git.raw(["stash", "pop", "--index"]);
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
            // 改动已落到工作区（带冲突标记），解决后 stash 是冗余的，应 drop
            autoStash: { kind: "stash-pop" },
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

  /**
   * Pull 预检测 —— 仿 IntelliJ IDEA「Update Project」弹窗前的状态摸底。
   *
   * 流程：
   *   1. `git fetch [remote]` 把 remote tracking branch 拉到最新（关键，没 fetch
   *      过的话 @{u} 是旧的，预测会失真）
   *   2. `git status` 拿当前工作区 dirty 文件列表（含 staged / unstaged / untracked）
   *   3. `git rev-parse --symbolic-full-name @{u}` 拿 upstream ref（如 origin/main）
   *   4. `git rev-list --count HEAD..@{u}` 拿 remote 比 local 多几个 commit
   *   5. `git diff HEAD..@{u} --name-only --no-renames` 拿 remote 改过的文件
   *   6. dirty ∩ remoteChanged = wouldConflict（Smart Pull 时 stash pop 大概率失败）
   *
   * 返回值用于驱动静默 Smart Pull 决策：
   *   - dirtyFiles.length === 0：可以直接 pull
   *   - remoteCommitsAhead === 0：本地是最新的，不需要 pull
   *   - wouldConflict.length > 0：警告 Smart Pull 风险，Force Pull 会丢数据
   *
   * 异常容错：
   *   - fetch 失败（网络 / auth）→ fetched=false，但仍返回基于旧 tracking branch
   *     的预测（用户应该被提示 fetch 失败）
   *   - 没 upstream（新分支没 push 过）→ upstream=null, remoteCommitsAhead=0, 不强迫弹窗
   *   - status 失败 → 不抛错，返回空 dirtyFiles（兜底）
   */
  async previewPullConflicts(repoPath: string, remote?: string): Promise<PullPreview> {
    const git = getRemoteGit(repoPath);
    let fetched: boolean;
    try {
      const extraEnv = await buildAuthEnv(repoPath);
      await runNetworkGit(repoPath, remote ? ["fetch", remote] : ["fetch"], { extraEnv });
      fetched = true;
    } catch {
      fetched = false;
    }

    let dirtyFiles: string[];
    try {
      const status = await git.status();
      const all = new Set<string>();
      for (const f of status.files) {
        if (f.path) all.add(f.path);
      }
      dirtyFiles = Array.from(all);
    } catch {
      dirtyFiles = [];
    }

    let upstream: string | null;
    try {
      const raw = await git.raw(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
      upstream = raw.trim() || null;
    } catch {
      upstream = null;
    }

    let remoteCommitsAhead = 0;
    if (upstream) {
      try {
        const raw = await git.raw(["rev-list", "--count", `HEAD..${upstream}`]);
        remoteCommitsAhead = parseInt(raw.trim(), 10) || 0;
      } catch {
        remoteCommitsAhead = 0;
      }
    }

    if (dirtyFiles.length === 0 || !upstream) {
      return {
        dirtyFiles,
        wouldConflict: [],
        safe: dirtyFiles,
        upstream,
        remoteCommitsAhead,
        fetched,
      };
    }

    let wouldConflict: string[];
    let safe: string[];
    try {
      const raw = await git.raw([
        "diff",
        "--name-only",
        "--no-renames",
        `HEAD..${upstream}`,
      ]);
      const changed = new Set(
        raw
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      );
      wouldConflict = [];
      safe = [];
      for (const f of dirtyFiles) {
        if (changed.has(f)) wouldConflict.push(f);
        else safe.push(f);
      }
    } catch {
      wouldConflict = [...dirtyFiles];
      safe = [];
    }

    return { dirtyFiles, wouldConflict, safe, upstream, remoteCommitsAhead, fetched };
  },

  /**
   * Force Pull —— 用户在分支右键「强制拉取（覆盖本地改动）」明确选择时调用。
   *
   * 流程：
   *   1. `git reset --hard HEAD`：丢弃所有 tracked 文件的未提交修改（含 staged / unstaged）
   *   2. `git clean -fd`：删除所有 untracked 文件与空目录
   *   3. `git pull [--rebase] [remote]`
   *
   * 警告：步骤 1+2 是**不可恢复**的，调用方 UI 必须先弹二次确认。
   * 异常处理：reset / clean 失败 → 返回错误，不继续 pull；pull 失败按 MergeResult 返回。
   */
  async forcePull(repoPath: string, remote?: string, rebase?: boolean): Promise<MergeResult> {
    const git = getRemoteGit(repoPath);
    try {
      await git.raw(["reset", "--hard", "HEAD"]);
      await git.raw(["clean", "-fd"]);
    } catch (e: unknown) {
      return {
        success: false,
        conflicts: [],
        message: `丢弃本地修改失败：${errStr(e) || "未知错误"}`,
      };
    }

    try {
      const args: string[] = ["pull"];
      if (rebase) args.push("--rebase");
      if (remote) args.push(remote);
      const extraEnv = await buildAuthEnv(repoPath);
      await runNetworkGit(repoPath, args, { extraEnv });
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      if (conflicts.length > 0) {
        return {
          success: false,
          conflicts,
          message: errStr(e) || "Pull produced merge conflicts after force reset",
        };
      }
      return {
        success: false,
        conflicts: [],
        message: errStr(e) || "Force pull failed",
      };
    }
    return {
      success: true,
      conflicts: [],
      message: "已丢弃本地修改并完成 Pull",
    };
  },

  async getBehindCount(
    repoPath: string,
    remote: string,
    branch: string
  ): Promise<AheadBehind> {
    const git = getGit(repoPath);
    try {
      const raw = await git.raw([
        "rev-list",
        "--left-right",
        "--count",
        `HEAD...${remote}/${branch}`,
      ]);
      const [aheadStr, behindStr] = raw.trim().split(/\s+/);
      return {
        ahead: parseInt(aheadStr ?? "0", 10) || 0,
        behind: parseInt(behindStr ?? "0", 10) || 0,
      };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  },

  async fetch(repoPath: string, remote?: string): Promise<void> {
    const extraEnv = await buildAuthEnv(repoPath);
    await withRetry(
      () => runNetworkGit(repoPath, remote ? ["fetch", remote] : ["fetch"], { extraEnv }),
      { label: `fetch ${remote ?? "(default)"}` }
    );
  },

  async fetchAll(repoPath: string): Promise<void> {
    const extraEnv = await buildAuthEnv(repoPath);
    await withRetry(() => runNetworkGit(repoPath, ["fetch", "--all"], { extraEnv }), {
      label: "fetch --all",
    });
  },

  async fetchBranch(repoPath: string, remote: string, branchName: string): Promise<void> {
    const extraEnv = await buildAuthEnv(repoPath);
    await withRetry(
      () => runNetworkGit(repoPath, ["fetch", remote, `${branchName}:${branchName}`], { extraEnv }),
      { label: `fetch ${remote} ${branchName}` }
    );
  },

  /**
   * 终止该仓库所有在途联网 git 子进程（push / pull / fetch）。返回被终止的进程数。
   * 供「取消推送 / 拉取」按钮与 abort/continue 抢占式恢复调用。
   */
  async cancelNetworkOps(repoPath: string): Promise<number> {
    return cancelNetworkGit(repoPath);
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
