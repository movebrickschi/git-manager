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

  async pull(repoPath: string, remote?: string, rebase?: boolean): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      const args: string[] = ["pull"];
      if (rebase) args.push("--rebase");
      if (remote) args.push(remote);
      await git.raw(args);
      return { success: true, conflicts: [], message: "Pull completed" };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Pull failed",
      };
    }
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
