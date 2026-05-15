import type { DiffResultModel, FileStatus, StashEntry } from "../git-service.js";
import { getGit, parseDiffOutput, parseNameStatus } from "./_helpers.js";

export const stashService = {
  async getStashList(repoPath: string): Promise<StashEntry[]> {
    const git = getGit(repoPath);
    const raw = await git.raw(["stash", "list", "--format=%H%n%at%n%s"]);
    if (!raw.trim()) return [];
    const lines = raw.trim().split("\n");
    const entries: StashEntry[] = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      entries.push({
        index: entries.length,
        commitId: lines[i]!,
        time: parseInt(lines[i + 1]!) * 1000,
        message: lines[i + 2]!,
      });
    }
    return entries;
  },

  async stashSave(repoPath: string, message: string, includeUntracked: boolean): Promise<void> {
    const git = getGit(repoPath);
    const args = ["stash", "push", "-m", message];
    if (includeUntracked) args.push("--include-untracked");
    await git.raw(args);
  },

  async stashApply(repoPath: string, index: number): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["stash", "apply", `stash@{${index}}`]);
  },

  async stashPop(repoPath: string, index: number): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["stash", "pop", `stash@{${index}}`]);
  },

  async stashDrop(repoPath: string, index: number): Promise<void> {
    const git = getGit(repoPath);
    await git.raw(["stash", "drop", `stash@{${index}}`]);
  },

  async getStashFiles(repoPath: string, index: number): Promise<FileStatus[]> {
    const git = getGit(repoPath);
    const raw = await git.raw(["stash", "show", "--name-status", `stash@{${index}}`]);
    if (!raw.trim()) return [];
    return parseNameStatus(raw);
  },

  async getStashFileDiff(
    repoPath: string,
    index: number,
    filePath: string
  ): Promise<DiffResultModel> {
    const git = getGit(repoPath);
    const raw = await git
      .raw(["diff", `stash@{${index}}^1`, `stash@{${index}}`, "--", filePath])
      .catch(() =>
        git.raw([
          "diff",
          "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
          `stash@{${index}}`,
          "--",
          filePath,
        ])
      );
    return parseDiffOutput(raw, filePath);
  },

  async stashFile(repoPath: string, filePath: string, message?: string): Promise<void> {
    const git = getGit(repoPath);
    const args = ["stash", "push", "--include-untracked"];
    if (message) args.push("-m", message);
    args.push("--", filePath);
    await git.raw(args);
  },

  /**
   * 批量搁置 N 个指定文件（pathspec 限定）：
   *   `git stash push --include-untracked -m <msg> -- <p1> <p2> ...`
   *
   * 与全量 `stashSave` 的差别：本方法只搁置 `filePaths` 列表里的文件，
   * 其余 dirty 文件不动；与单文件 `stashFile` 的差别：一次产生一个 stash entry，
   * 而不是 N 个，方便后续 pop / drop 整批。
   *
   * 空数组直接返回 noop。
   */
  async stashFiles(repoPath: string, filePaths: string[], message?: string): Promise<void> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return;
    const git = getGit(repoPath);
    const args = ["stash", "push", "--include-untracked"];
    if (message) args.push("-m", message);
    args.push("--", ...filePaths);
    await git.raw(args);
  },
};
