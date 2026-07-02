import * as fs from "fs";
import type { BatchFileResult, FileStatus, StatusResult } from "../git-service.js";
import { safeJoin } from "../utils/path-safe.js";
import { getGit, parseStatusCode, runGitPathspecFromFile } from "./_helpers.js";

const fsp = fs.promises;

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

  /**
   * 一次性 stage 多个文件。经由 runGitPathspecFromFile 用 `--pathspec-from-file`
   * 传路径：一条 git 进程吃下任意数量文件，且不会因数百路径摊进 argv 而超出
   * Windows 命令行长度上限（这正是「数百文件添加到 VCS 无反应/报错」的根因）。
   * 空数组直接 no-op。
   */
  async stageFilesBatch(repoPath: string, filePaths: string[]): Promise<void> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return;
    await runGitPathspecFromFile(repoPath, ["add"], filePaths);
  },

  /**
   * 一次性 unstage 多个文件。等价于 `git reset HEAD -- p1 p2 ... pN`，但用
   * `--pathspec-from-file` 传路径以支持任意数量文件、规避 argv 长度上限。
   * unborn 仓库（无 HEAD）下 git 会报错，这里透传给调用方而非静默吞。
   */
  async unstageFilesBatch(repoPath: string, filePaths: string[]): Promise<void> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return;
    await runGitPathspecFromFile(repoPath, ["reset", "HEAD"], filePaths);
  },

  async commit(repoPath: string, message: string, amend: boolean): Promise<string> {
    const git = getGit(repoPath);
    const args = amend ? ["commit", "--amend", "-m", message] : ["commit", "-m", message];
    const result = await git.raw(args);
    const match = result.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
    return match?.[1] ?? "";
  },

  /**
   * 把当前已暂存改动提交为 fixup commit：`git commit --fixup=<commitId>`。
   * git 自动生成 message `fixup! <目标 commit 标题>`，随后可用 rebaseAutosquash 自动合并。
   * 暂存区为空时 git 报 "nothing to commit"，错误透传给调用方由前端提示。
   */
  async commitFixup(repoPath: string, commitId: string): Promise<string> {
    const git = getGit(repoPath);
    const result = await git.raw(["commit", `--fixup=${commitId}`]);
    const match = result.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
    // 空暂存区时 git 输出 "nothing to commit"，simple-git 不会 reject，
    // 匹配不到新 commit 即视为未提交，显式抛错避免前端误报成功。
    if (!match) {
      throw new Error(`NOTHING_TO_COMMIT: 没有已暂存的改动可提交为 fixup（${result.trim()}）`);
    }
    return match[1];
  },

  /**
   * 只提交指定 N 个文件（pathspec 限定），不影响其他 staged 文件。
   *
   * 实现两步（均经 runGitPathspecFromFile 用 `--pathspec-from-file` 传路径，
   * 支持任意数量文件、规避 argv 长度上限）：
   *   1. `git add` 把入参文件全部加入索引（已 staged 的无副作用）
   *   2. `git commit -m <msg>` pathspec 限定只把这些文件做成 commit
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
    await runGitPathspecFromFile(repoPath, ["add"], filePaths);
    const result = await runGitPathspecFromFile(repoPath, ["commit", "-m", message], filePaths);
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
    return fsp.readFile(fullPath, "utf-8");
  },

  async deleteFile(repoPath: string, filePath: string): Promise<void> {
    const fullPath = safeJoin(repoPath, filePath);
    await fsp.unlink(fullPath);
  },

  /**
   * 一次性回滚 N 个文件到 HEAD：快路径用 `git reset HEAD` + `git checkout`，路径经
   * `--pathspec-from-file` 传入（1~2 次 git 进程处理全部、支持任意数量文件、规避
   * argv 长度上限）；快路径整体失败时在后端逐个重试，精确定位失败文件。
   * 返回逐文件 ok/failed，避免一个坏文件拖垮整批。
   */
  async discardFilesBatch(repoPath: string, filePaths: string[]): Promise<BatchFileResult> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return { ok: [], failed: [] };
    const git = getGit(repoPath);
    try {
      await runGitPathspecFromFile(repoPath, ["reset", "HEAD"], filePaths).catch(() => {});
      await runGitPathspecFromFile(repoPath, ["checkout"], filePaths).catch(async () => {
        await runGitPathspecFromFile(repoPath, ["restore"], filePaths);
      });
      return { ok: [...filePaths], failed: [] };
    } catch {
      const ok: string[] = [];
      const failed: { path: string; error: string }[] = [];
      for (const fp of filePaths) {
        try {
          await git.raw(["reset", "HEAD", "--", fp]).catch(() => {});
          await git.raw(["checkout", "--", fp]).catch(async () => {
            await git.raw(["restore", "--", fp]);
          });
          ok.push(fp);
        } catch (e) {
          failed.push({ path: fp, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return { ok, failed };
    }
  },

  /**
   * 一次性从磁盘删除 N 个文件（并发 unlink）。文件已不存在（ENOENT）视为删除目标已达成，
   * 计入 ok；其它错误（权限 / 占用）计入 failed。返回逐文件结果。
   */
  async deleteFilesBatch(repoPath: string, filePaths: string[]): Promise<BatchFileResult> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return { ok: [], failed: [] };
    const ok: string[] = [];
    const failed: { path: string; error: string }[] = [];
    await Promise.all(
      filePaths.map(async (fp) => {
        try {
          await fsp.unlink(safeJoin(repoPath, fp));
          ok.push(fp);
        } catch (e) {
          if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
            ok.push(fp);
          } else {
            failed.push({ path: fp, error: e instanceof Error ? e.message : String(e) });
          }
        }
      })
    );
    return { ok, failed };
  },

  /**
   * 把指定文件路径追加到仓库根的 .gitignore（IDEA "Add to .gitignore" 同款）。
   * - 不存在时自动创建 .gitignore
   * - 已存在同 pattern 行时跳过追加
   * - 末尾若没换行符自动补一个，再追加
   * - filePath 用 forward slash 归一化，与 git 内部一致
   * - 不会自动 `git rm --cached`（已被跟踪的文件需要用户手工 unstage 或 rm cached）
   */
  async addToGitignore(repoPath: string, filePath: string): Promise<void> {
    if (typeof filePath !== "string" || filePath.length === 0) {
      throw new Error("INVALID_PATH: filePath 不能为空");
    }
    const norm = filePath.replace(/\\/g, "/");
    const gi = `${repoPath}/.gitignore`;
    let content = "";
    try {
      content = await fsp.readFile(gi, "utf-8");
    } catch {
      // ENOENT：.gitignore 不存在，content 保持空
    }
    const lines = content.length === 0 ? [] : content.split(/\r?\n/);
    const seen = new Set(lines.map((l) => l.trim()));
    if (seen.has(norm)) return; // 已存在
    const needsTrailingNL = content.length > 0 && !content.endsWith("\n");
    const toAppend = (needsTrailingNL ? "\n" : "") + norm + "\n";
    await fsp.appendFile(gi, toAppend, "utf-8");
  },
};
