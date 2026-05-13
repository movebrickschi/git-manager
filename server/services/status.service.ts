import * as fs from "fs";
import type { FileStatus, StatusResult } from "../git-service.js";
import { safeJoin } from "../utils/path-safe.js";
import { getGit, parseStatusCode } from "./_helpers.js";

export const statusService = {
  async getStatus(repoPath: string): Promise<StatusResult> {
    const git = getGit(repoPath);
    const status = await git.status();

    const staged: FileStatus[] = [];
    const unstaged: FileStatus[] = [];
    const untracked: FileStatus[] = [];

    for (const f of status.files) {
      const x = f.index;
      const y = f.working_dir;
      const filePath = f.path;

      if (x === "?" && y === "?") {
        untracked.push({
          path: filePath,
          oldPath: null,
          status: "untracked",
          staged: false,
        });
        continue;
      }

      const entries = parseStatusCode(x, y);
      for (const e of entries) {
        const item: FileStatus = {
          path: filePath,
          oldPath: f.from && f.from !== f.path ? f.from : null,
          status: e.status,
          staged: e.staged,
        };
        if (e.staged) staged.push(item);
        else unstaged.push(item);
      }
    }

    return { staged, unstaged, untracked };
  },

  async stageFile(repoPath: string, filePath: string): Promise<void> {
    const git = getGit(repoPath);
    await git.add(filePath);
  },

  async unstageFile(repoPath: string, filePath: string): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["reset", "HEAD", "--", filePath]);
  },

  async stageAll(repoPath: string): Promise<void> {
    const git = getGit(repoPath);
    await git.add("-A");
  },

  async unstageAll(repoPath: string): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["reset", "HEAD"]);
  },

  async commit(repoPath: string, message: string, amend: boolean): Promise<string> {
    const git = getGit(repoPath);
    const args = amend ? ["commit", "--amend", "-m", message] : ["commit", "-m", message];
    const result = await git.raw(args);
    const match = result.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
    return match?.[1] ?? "";
  },

  async discardFileChanges(repoPath: string, filePath: string): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["reset", "HEAD", "--", filePath]).catch(() => {});
    await git.raw(["checkout", "--", filePath]).catch(async () => {
      await git.raw(["restore", "--", filePath]);
    });
  },

  async getWorkingFileContent(repoPath: string, filePath: string): Promise<string> {
    const fullPath = safeJoin(repoPath, filePath);
    return fs.readFileSync(fullPath, "utf-8");
  },

  async deleteFile(repoPath: string, filePath: string): Promise<void> {
    const fullPath = safeJoin(repoPath, filePath);
    fs.unlinkSync(fullPath);
  },
};
