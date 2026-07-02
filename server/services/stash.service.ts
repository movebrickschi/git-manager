import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "fs";
import os from "node:os";
import * as path from "path";
import { promisify } from "node:util";
import type { DiffResultModel, FileStatus, StashEntry } from "../git-service.js";
import {
  getGit,
  parseDiffOutput,
  parseNameStatus,
  runGitArgsChunked,
  runGitPathspecFromFile,
} from "./_helpers.js";

const execFile = promisify(execFileCb);

/**
 * 跑 git plumbing 命令（带 -C repo），可选注入环境变量（如 GIT_INDEX_FILE）。
 * 用 execFile 而非共享的 simpleGit 实例，是因为重建 stash 需要把 GIT_INDEX_FILE
 * 指到临时 index，per-command 设 env，避免污染共享实例（_helpers.ts 已有同款先例）。
 */
async function gitRaw(
  repoPath: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<string> {
  const { stdout } = await execFile("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return stdout;
}

/** 解析 `git ls-tree <tree> -- <path>` 单条输出为 { mode, sha }，无此文件返回 null。 */
function parseLsTreeEntry(out: string): { mode: string; sha: string } | null {
  const line = out.trim();
  if (!line) return null;
  const m = /^(\d+)\s+\w+\s+([0-9a-f]+)\t/.exec(line);
  return m ? { mode: m[1]!, sha: m[2]! } : null;
}

/**
 * 基于 sourceTreeish 重建一个 tree，但把 filePath 还原成 base 版本（baseEntry 非 null）
 * 或从 tree 中剔除（baseEntry 为 null，即该文件是 stash 新增的）。
 * 全程在临时 GIT_INDEX_FILE 上操作，不触碰仓库主 index。
 */
async function rebuildTreeWithout(
  repoPath: string,
  sourceTreeish: string,
  filePath: string,
  baseEntry: { mode: string; sha: string } | null
): Promise<string> {
  const tmpIndex = path.join(
    os.tmpdir(),
    `gm-stash-idx-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  const env: NodeJS.ProcessEnv = { GIT_INDEX_FILE: tmpIndex };
  try {
    await gitRaw(repoPath, ["read-tree", sourceTreeish], env);
    if (baseEntry) {
      await gitRaw(
        repoPath,
        ["update-index", "--add", "--cacheinfo", `${baseEntry.mode},${baseEntry.sha},${filePath}`],
        env
      );
    } else {
      // base 无此文件 → 从 tree 移除；对不在该 tree 的路径，--force-remove 是 no-op。
      await gitRaw(repoPath, ["update-index", "--force-remove", filePath], env);
    }
    return (await gitRaw(repoPath, ["write-tree"], env)).trim();
  } finally {
    await fs.rm(tmpIndex, { force: true }).catch(() => {});
  }
}

/** 替换 stash reflog 行的 new-sha（第二段 40hex），保留行其余部分。 */
function setReflogNewSha(line: string, sha: string): string {
  const sp1 = line.indexOf(" ");
  const sp2 = line.indexOf(" ", sp1 + 1);
  if (sp1 < 0 || sp2 < 0) throw new Error("Corrupted stash reflog entry");
  return line.slice(0, sp1 + 1) + sha + line.slice(sp2);
}

/** 替换 stash reflog 行的 old-sha（首段 40hex），保留行其余部分。 */
function setReflogOldSha(line: string, sha: string): string {
  const sp1 = line.indexOf(" ");
  if (sp1 < 0) throw new Error("Corrupted stash reflog entry");
  return sha + line.slice(sp1);
}

export const stashService = {
  async getStashList(repoPath: string): Promise<StashEntry[]> {
    const git = getGit(repoPath);
    const raw = await git.raw(["stash", "list", "--format=%H%n%at%n%gs"]);
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

  async stashRename(repoPath: string, index: number, newMessage: string): Promise<void> {
    const git = getGit(repoPath);
    const gitDir = (await git.raw(["rev-parse", "--git-dir"])).trim();
    const reflogPath = path.resolve(repoPath, gitDir, "logs", "refs", "stash");

    const content = await fs.readFile(reflogPath, "utf-8");
    const lines = content.trimEnd().split("\n");
    const lineIndex = lines.length - 1 - index;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      throw new Error(`Invalid stash index ${index}`);
    }

    const tabPos = lines[lineIndex]!.indexOf("\t");
    if (tabPos === -1) throw new Error("Corrupted stash reflog entry");

    lines[lineIndex] = lines[lineIndex]!.substring(0, tabPos + 1) + newMessage;

    await fs.writeFile(reflogPath, lines.join("\n") + "\n", "utf-8");
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
   * 批量搁置 N 个指定文件，且**只产生一个 stash entry**。
   *
   * 为什么不用 `git stash push -- <pathspec>`：数百文件时，
   *   - 直接摊进 argv → spawn 超出 Windows 命令行上限；
   *   - 即便用 `--pathspec-from-file` 绕过我们这一层，`git stash` 内部仍会再 spawn
   *     `git clean`（清理已搁置的 untracked）并把 pathspec 展开成 argv，报
   *     `cannot spawn git: Filename too long`，且此时 stash commit 已建、工作区却没清，
   *     留下「有 entry 但文件还在」的半残状态。
   *
   * 故改用「先暂存、再 `git stash push --staged`」：
   *   1. `git add`（pathspec-from-file，任意数量不溢出）把选中文件全部入索引；
   *   2. `git stash push --staged` 只搁置暂存区，无需 pathspec → 不触发内部 argv 展开；
   *      一条命令产出单个 entry，工作区随之清理干净。
   * 为不影响用户**本次未选中、但已暂存**的文件：stash 前先把这些「外部暂存文件」
   * 取消暂存，stash 后再还原其暂存态（数量通常很少，分块 reset/add 兜底）。
   *
   * 注意：`git stash push --staged` 需要 git ≥ 2.35。空数组直接 noop。
   */
  async stashFiles(repoPath: string, filePaths: string[], message?: string): Promise<void> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return;
    const git = getGit(repoPath);

    const selected = new Set(filePaths);
    const stagedBefore = (await git.raw(["diff", "--cached", "--name-only"]))
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const foreign = stagedBefore.filter((p) => !selected.has(p));

    await runGitPathspecFromFile(repoPath, ["add"], filePaths);
    if (foreign.length > 0) await runGitArgsChunked(git, ["reset", "-q"], foreign);

    const subArgs = ["stash", "push", "--staged"];
    if (message) subArgs.push("-m", message);
    await git.raw(subArgs);

    if (foreign.length > 0) await runGitArgsChunked(git, ["add"], foreign);
  },

  /**
   * 从指定 stash（index）中永久移除单个文件 filePath：该文件的改动被丢弃、
   * 恢复成 base 版本（base 无此文件则从 stash 剔除），stash 内其余文件原样保留，
   * 其它 stash 不受影响。
   *
   * 原理：git stash 是不可变快照，没有原生命令删其中单个文件，故用 plumbing
   * 重建该 stash entry —— 重建 working tree 与 index tree(^2)（把目标文件还原成
   * base），base(^1) 与 untracked(^3) 保持不变，commit-tree 生成新 stash commit，
   * 再把 reflog `logs/refs/stash` 对应行的 sha 指向新 commit（与 stashRename 同款
   * 直接改 reflog 文件的手法），并维护 reflog 链与 refs/stash。
   *
   * 边界：若移除后 working tree 已等于 base 且无 untracked，则整个 stash 失去
   * 意义，直接 `git stash drop`。
   */
  async stashRemoveFile(repoPath: string, index: number, filePath: string): Promise<void> {
    const stashRef = `stash@{${index}}`;

    // 解析该 stash 的结构：自身(working) + base(^1) + index(^2) + untracked(^3, 可选)
    const baseSha = (await gitRaw(repoPath, ["rev-parse", `${stashRef}^1`])).trim();
    const workCommit = (await gitRaw(repoPath, ["rev-parse", stashRef])).trim();
    const indexCommit = (await gitRaw(repoPath, ["rev-parse", `${stashRef}^2`])).trim();
    let untrackedCommit: string | null;
    try {
      const u = (await gitRaw(repoPath, ["rev-parse", "--verify", "-q", `${stashRef}^3`])).trim();
      untrackedCommit = u || null;
    } catch {
      untrackedCommit = null;
    }

    // base 中该文件的 mode+blob：决定"还原成 base 版本"还是"从 tree 剔除"
    const baseEntry = parseLsTreeEntry(
      await gitRaw(repoPath, ["ls-tree", baseSha, "--", filePath]).catch(() => "")
    );

    const newWorkTree = await rebuildTreeWithout(repoPath, workCommit, filePath, baseEntry);
    const newIndexTree = await rebuildTreeWithout(repoPath, indexCommit, filePath, baseEntry);

    // 移除后无 tracked 改动且无 untracked → 整个 stash 失去意义，drop
    const baseTree = (await gitRaw(repoPath, ["rev-parse", `${baseSha}^{tree}`])).trim();
    if (newWorkTree === baseTree && !untrackedCommit) {
      await gitRaw(repoPath, ["stash", "drop", stashRef]);
      return;
    }

    // 保留原 author/committer 身份与时间，使列表显示的时间不变
    const ident = (
      await gitRaw(repoPath, ["log", "-1", "--format=%an%n%ae%n%aI%n%cn%n%ce%n%cI", workCommit])
    ).split(/\r?\n/);
    const [an, ae, ad, cn, ce, cd] = ident;
    const env: NodeJS.ProcessEnv = {
      GIT_AUTHOR_NAME: an,
      GIT_AUTHOR_EMAIL: ae,
      GIT_AUTHOR_DATE: ad,
      GIT_COMMITTER_NAME: cn,
      GIT_COMMITTER_EMAIL: ce,
      GIT_COMMITTER_DATE: cd,
    };
    const subject = (await gitRaw(repoPath, ["log", "-1", "--format=%s", workCommit])).replace(
      /\r?\n$/,
      ""
    );
    const indexSubject = (
      await gitRaw(repoPath, ["log", "-1", "--format=%s", indexCommit])
    ).replace(/\r?\n$/, "");

    const newIndexCommit = (
      await gitRaw(repoPath, ["commit-tree", newIndexTree, "-p", baseSha, "-m", indexSubject], env)
    ).trim();
    const commitArgs = ["commit-tree", newWorkTree, "-p", baseSha, "-p", newIndexCommit];
    if (untrackedCommit) commitArgs.push("-p", untrackedCommit);
    commitArgs.push("-m", subject);
    const newStashCommit = (await gitRaw(repoPath, commitArgs, env)).trim();

    // 把新 commit 写回 stash reflog 的对应行（stash@{i} = 倒数第 i+1 行）
    const gitDir = (await gitRaw(repoPath, ["rev-parse", "--git-dir"])).trim();
    const reflogPath = path.resolve(repoPath, gitDir, "logs", "refs", "stash");
    const content = await fs.readFile(reflogPath, "utf-8");
    const lines = content.trimEnd().split("\n");
    const lineIndex = lines.length - 1 - index;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      throw new Error(`Invalid stash index ${index}`);
    }
    lines[lineIndex] = setReflogNewSha(lines[lineIndex]!, newStashCommit);
    // reflog 链：后一行（更晚的 entry）的 old-sha 必须接上本行的新 new-sha
    if (lineIndex + 1 < lines.length) {
      lines[lineIndex + 1] = setReflogOldSha(lines[lineIndex + 1]!, newStashCommit);
    }
    await fs.writeFile(reflogPath, lines.join("\n") + "\n", "utf-8");

    // 被改的是栈顶（reflog 最后一行）→ refs/stash 同步指向新 commit（直接写 loose ref，
    // 避免 update-ref 追加新的 reflog 行破坏上面手工维护的链）
    if (lineIndex === lines.length - 1) {
      const refPath = path.resolve(repoPath, gitDir, "refs", "stash");
      await fs.writeFile(refPath, newStashCommit + "\n", "utf-8");
    }
  },
};
