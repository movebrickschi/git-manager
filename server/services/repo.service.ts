import { simpleGit } from "simple-git";
import * as path from "path";
import type { RepoOpenResult } from "../git-service.js";
import { getGit, withRetry, GIT_TIMEOUT_MS } from "./_helpers.js";

export const repoService = {
  async openRepo(repoPath: string): Promise<RepoOpenResult> {
    const git = getGit(repoPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) throw new Error(`Not a git repository: ${repoPath}`);
    const rootPath = (await git.revparse(["--show-toplevel"])).trim();
    const rootGit = getGit(rootPath);
    const branchSummary = await rootGit.branch();
    return {
      path: rootPath,
      name: path.basename(rootPath),
      currentBranch: branchSummary.current,
    };
  },

  async cloneRepo(url: string, targetPath: string): Promise<void> {
    const git = simpleGit({
      binary: "git",
      maxConcurrentProcesses: 1,
      timeout: { block: GIT_TIMEOUT_MS * 4 },
    });
    await withRetry(() => git.clone(url, targetPath), {
      tries: 3,
      baseMs: 1000,
      label: `clone ${url}`,
    });
  },
};
