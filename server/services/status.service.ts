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

  /**
   * 只提交指定 N 个文件（pathspec 限定），不影响其他 staged 文件。
   *
   * 实现两步：
   *   1. `git add -- <p1> <p2> ...`  把入参文件全部加入索引（已 staged 的无副作用）
   *   2. `git commit -m <msg> -- <p1> <p2> ...`  pathspec 限定只把这些文件做成 commit
   *
   * 注意：步骤 2 的 pathspec 仅限制本次 commit 范围，对仓库其它 staged 内容不动；
   * 已 staged 但**不在**入参列表里的文件会保留在索引中等待下一次 commit。
   *
   * 空数组直接返回空字符串。
   */
  async commitFiles(repoPath: string, filePaths: string[], message: string): Promise<string> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return "";
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new Error("commitFiles: message 不能为空");
    }
    const git = getGit(repoPath);
    await git.raw(["add", "--", ...filePaths]);
    const result = await git.raw(["commit", "-m", message, "--", ...filePaths]);
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
