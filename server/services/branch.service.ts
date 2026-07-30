import { execFile as execFileCb } from "node:child_process";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { BranchInfo, BranchesResult, MergeResult } from "../git-service.js";
import {
  errStr,
  getConflictFiles,
  getGit,
  isAncestorRef,
} from "./_helpers.js";

const execFile = promisify(execFileCb);

type Git = ReturnType<typeof getGit>;

/**
 * 计算「目标分支会写入、但当前工作区物理存在且未被 git 跟踪」的文件集合。
 *
 * 这类文件（典型：被 .gitignore 忽略、却在目标分支被提交的自动生成 .d.ts）会让
 * `git checkout` 报 "untracked working tree files would be overwritten by checkout"。
 * `changed` 为目标分支相对 HEAD 的变更文件集（git diff HEAD..branch）。
 */
async function computeUntrackedOverwrite(
  git: Git,
  repoPath: string,
  changed: Set<string>
): Promise<string[]> {
  const list = [...changed];
  if (list.length === 0) return [];
  let trackedSet: Set<string>;
  try {
    // 刻意不带 pathspec：`changed` 是 `git diff HEAD..branch` 的全量文件名集合，
    // 过去把它整个摊进 argv（`ls-files -z -- p1 … pN`），几千个路径就会超出 Windows
    // CreateProcess 的 ~32767 字符上限，spawn 直接失败 → 落到下面的 catch 返回 []
    // → 误判「没有会被覆盖的未跟踪文件」→ 随后 git checkout 才报
    // "would be overwritten by checkout"。这与项目此前修过的批量 stage argv 溢出同源
    // （见 docs/plans/2026-06-30-fix-stage-many-files-argv-limit.md）。
    // 不带 pathspec 列出全部已跟踪文件、在内存里做交集，结果完全等价且恒定 1 个进程。
    const lsRaw = await git.raw(["ls-files", "-z"]);
    trackedSet = new Set(
      lsRaw
        .split("\0")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  } catch {
    // ls-files 失败时保守返回空，避免把已跟踪文件误当未跟踪而移走。
    return [];
  }
  // 逐个 existsSync 会在主线程上同步 stat 成千上万次（慢盘 / 网络盘尤其明显），
  // 期间 Electron main 与 Express worker 完全卡死。改为并发的 fsp.access：
  // 语义与 existsSync 完全一致（后者内部就是 accessSync(F_OK)），但不阻塞 event loop。
  const candidates = list.filter((f) => !trackedSet.has(f));
  const existing = await Promise.all(
    candidates.map(async (f) => {
      try {
        await fsp.access(path.join(repoPath, f));
        return f;
      } catch {
        return null;
      }
    })
  );
  return existing.filter((f): f is string => f !== null);
}

/** 取目标分支相对 HEAD 的变更文件，算出会被覆盖的未跟踪文件。 */
async function detectUntrackedOverwrite(
  git: Git,
  repoPath: string,
  branch: string
): Promise<string[]> {
  let changed: Set<string>;
  try {
    const raw = await git.raw(["diff", "--name-only", "--no-renames", `HEAD..${branch}`]);
    changed = new Set(
      raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  } catch {
    return [];
  }
  return computeUntrackedOverwrite(git, repoPath, changed);
}

/** 当前 stash 栈条目数；用于判断 `stash push` 是否真的存了东西（跨语言环境稳健）。 */
async function countStash(git: Git): Promise<number> {
  try {
    const raw = await git.raw(["stash", "list"]);
    return raw.split("\n").filter((s) => s.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * 把会被 checkout 覆盖的未跟踪文件移动到 `.git/gitmanager-backup/<ts>` 暂存，
 * 既让 checkout 顺利进行，又不静默丢失用户文件。返回备份目录（空列表返回 null）。
 */
async function backupAndRemove(repoPath: string, files: string[]): Promise<string | null> {
  if (files.length === 0) return null;
  const backupDir = path.join(repoPath, ".git", "gitmanager-backup", `checkout-${Date.now()}`);
  for (const f of files) {
    const dst = path.join(backupDir, f);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.rename(path.join(repoPath, f), dst);
  }
  return backupDir;
}

/** 还原现场：把备份文件移回工作区原位（用于 checkout 失败回滚）。 */
async function restoreBackup(repoPath: string, backupDir: string, files: string[]): Promise<void> {
  for (const f of files) {
    const dst = path.join(repoPath, f);
    try {
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.rename(path.join(backupDir, f), dst);
    } catch {
      // best-effort
    }
  }
  await fsp.rm(backupDir, { recursive: true, force: true }).catch(() => {});
}

/**
 * 一条 for-each-ref 就能取全的字段。全部是结构化占位符，不受 locale 影响
 * （唯一会被 git 翻译的是 upstream:track，故调用处强制 LC_ALL=C）。
 */
const REF_FIELDS = [
  "%(refname)",
  "%(objectname:short)",
  "%(HEAD)",
  "%(upstream:short)",
  "%(upstream:track)",
  "%(symref)",
  "%(contents:subject)",
].join("%00");

/**
 * 解析 `%(upstream:track)`：`[ahead 1, behind 2]` / `[ahead 1]` / `[behind 2]` /
 * `[gone]` / 空串。返回 null 表示「与 upstream 完全同步」或无 upstream —— 与原
 * getLocalBranchTracking 的 `ahead || behind ? [ahead, behind] : null` 语义一致。
 */
function parseUpstreamTrack(track: string): [number, number] | null {
  const ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0) || 0;
  const behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0) || 0;
  return ahead || behind ? [ahead, behind] : null;
}

export const branchService = {
  /**
   * 分支 / 远程分支 / 标签一次取全。
   *
   * 原实现是一个典型的 N+1：先 `git branch -a -vv`，再对**每个本地分支**串行跑两条
   * `git raw`（`rev-parse --abbrev-ref b@{upstream}` + `rev-list --left-right --count`），
   * 最后再加 `git tags` 与 `rev-parse --short HEAD`，共 `1 + 2N + 2` 个 git 进程。
   * 由于同仓库所有 git 命令共享一条 maxConcurrentProcesses:1 的串行队列，30 个本地
   * 分支就是 63 个进程排队；而 loadBranches 被 13 处调用（含每次写操作后的
   * refreshGit），于是它成了「点完按钮界面半天不动」的主要来源。
   *
   * 现在改用单条 `git for-each-ref`，一次拿到 refname / 短 sha / HEAD 标记 /
   * upstream / ahead-behind / symref / subject，把 refs/heads、refs/remotes、
   * refs/tags 一并取出 —— 常见情况下总共只剩 **1 个** git 进程
   * （仅 detached HEAD 时才追加一条 `rev-parse --short HEAD`，因为那时
   * refs/heads 里没有任何 %(HEAD)=* 的条目，前端要靠 headSha 显示 `(HEAD: <sha>)`）。
   *
   * 两个刻意保留的行为细节：
   *   - `refs/remotes/origin/HEAD` 是 symref，`git branch -a` 会把它显示成
   *     `remotes/origin/HEAD -> origin/master`。它不是真实分支，故按 %(symref)
   *     非空跳过，避免远程分支列表里多出一个不可切换的伪条目。
   *   - 走 execFile 直连而非 simple-git：① 需要给这一条命令单独设 LC_ALL=C，不能
   *     污染共享实例的 env；② for-each-ref 只读 refs、不取任何锁，无需占用串行队列。
   */
  async getBranches(repoPath: string): Promise<BranchesResult> {
    const { stdout } = await execFile(
      "git",
      ["-C", repoPath, "for-each-ref", `--format=${REF_FIELDS}`, "refs/heads", "refs/remotes", "refs/tags"],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        // upstream:track 是 git 唯一会本地化的字段（中文 git 会输出「领先 2, 落后 1」），
        // 强制 C locale 保证 /ahead (\d+)/ 恒定可解析。refname / subject 是原始字节，
        // 不受 locale 影响，中文分支名与中文提交摘要照常。
        env: { ...process.env, LC_ALL: "C" },
      }
    );

    const local: BranchInfo[] = [];
    const remote: BranchInfo[] = [];
    const tags: string[] = [];
    let hasHeadBranch = false;

    for (const line of stdout.split("\n")) {
      if (!line) continue;
      const [refname = "", shortSha = "", headMark = "", upstream = "", track = "", symref = "", subject = ""] =
        line.split("\0");

      if (refname.startsWith("refs/tags/")) {
        tags.push(refname.slice("refs/tags/".length));
        continue;
      }

      const isRemote = refname.startsWith("refs/remotes/");
      if (isRemote && symref) continue; // origin/HEAD 之类的 symref 不是真实分支

      const name = isRemote
        ? refname.slice("refs/remotes/".length)
        : refname.slice("refs/heads/".length);
      if (!name) continue;

      const isHead = headMark === "*";
      if (isHead) hasHeadBranch = true;

      const info: BranchInfo = {
        name,
        isHead,
        // 远程分支没有 upstream 概念，与原实现保持一致地置 null
        upstream: isRemote ? null : upstream || null,
        aheadBehind: isRemote ? null : parseUpstreamTrack(track),
        lastCommitId: shortSha,
        lastCommitSummary: subject,
        lastCommitTime: 0,
      };
      if (isRemote) remote.push(info);
      else local.push(info);
    }

    // 仅 detached / rebase / unborn（refs/heads 里没有 %(HEAD)=* 条目）时才需要它，
    // 正常检出分支的情况下省掉这一个 git 进程。
    let headSha: string | null = null;
    if (!hasHeadBranch) {
      try {
        headSha = (await getGit(repoPath).revparse(["--short", "HEAD"])).trim() || null;
      } catch {
        // unborn 仓库（无任何 commit）连 HEAD 都没有
      }
    }

    return { local, remote, tags, headSha };
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
   * 预检测切到 `branch` 后会冲突的本地文件。返回三类：
   * - `wouldConflict`：dirty 且目标分支也改过 → Smart pop 可能冲突、Force 会丢失
   * - `safe`：dirty 但目标分支没动 → Smart pop 基本能无痛保留
   * - `untrackedConflict`：工作区物理存在、当前未被跟踪/被忽略、但目标分支已跟踪的同名
   *   文件 → `git checkout` 会报 "would be overwritten by checkout"。它不依赖传入的
   *   `dirtyFiles`（被忽略文件根本不在 `git status` 里），故 dirtyFiles 为空时仍会检测。
   *
   * 算法：`git diff HEAD..<branch> --name-only` 列出两端不同的路径；与 dirtyFiles 取交集
   * 得 wouldConflict/safe；与"工作区存在且未跟踪"的文件取交集得 untrackedConflict。
   * rename 检测关闭（--no-renames）以避免噪音误判；diff 出错时回退为"全部冲突"。
   */
  async previewCheckoutConflicts(
    repoPath: string,
    branch: string,
    dirtyFiles: string[]
  ): Promise<{ wouldConflict: string[]; safe: string[]; untrackedConflict: string[] }> {
    const git = getGit(repoPath);
    const dirty = Array.isArray(dirtyFiles) ? dirtyFiles : [];
    let changed: Set<string>;
    try {
      const raw = await git.raw(["diff", "--name-only", "--no-renames", `HEAD..${branch}`]);
      changed = new Set(
        raw
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      );
    } catch {
      // diff 失败：无法判定，dirty 全部当冲突，未跟踪检测跳过。
      return { wouldConflict: [...dirty], safe: [], untrackedConflict: [] };
    }
    const untrackedConflict = await computeUntrackedOverwrite(git, repoPath, changed);
    const wouldConflict: string[] = [];
    const safe: string[] = [];
    for (const f of dirty) {
      if (changed.has(f)) wouldConflict.push(f);
      else safe.push(f);
    }
    return { wouldConflict, safe, untrackedConflict };
  },

  /**
   * Smart checkout（仿 IntelliJ IDEA）：
   *   0. 把"目标分支已跟踪、本地未跟踪/被忽略"的同名文件备份移到 .git（否则 checkout 撞车）
   *   1. `git stash push --include-untracked -m <auto-tag>` 暂存其余 dirty
   *   2. `git checkout <name>` 切到目标分支
   *   3. `git stash pop` 把暂存还原到新分支工作区
   * 任一步失败均回滚现场（pop 冲突时 stash 仍在栈顶，由调用方/用户后续处理）。
   *
   * 返回 MergeResult：
   * - ok=true · message="..."：成功（message 含备份位置，若有）
   * - ok=false · conflicts=[paths]：stash pop 时遇到冲突（已切到新分支）
   * - ok=false · message=err：stash 或 checkout 阶段失败，已还原现场仍在原分支
   */
  async smartCheckoutBranch(repoPath: string, name: string): Promise<MergeResult> {
    const git = getGit(repoPath);

    // 步骤 0：把"目标分支已跟踪、本地却未跟踪/被忽略"的同名文件移到 .git 备份。
    // `git stash -u` 带不走 ignored 文件，留着会让 `git checkout` 因
    // "untracked working tree files would be overwritten" 直接失败。
    let untracked: string[];
    let backupDir: string | null;
    try {
      untracked = await detectUntrackedOverwrite(git, repoPath, name);
      backupDir = await backupAndRemove(repoPath, untracked);
    } catch (e: unknown) {
      return {
        success: false,
        conflicts: [],
        message: `预处理未跟踪冲突文件失败：${errStr(e) || "未知错误"}`,
      };
    }

    const tag = `gitmanager-auto-stash-before-checkout-${name}-${Date.now()}`;
    let stashed: boolean;
    try {
      const before = await countStash(git);
      await git.raw(["stash", "push", "--include-untracked", "-m", tag]);
      stashed = (await countStash(git)) > before;
    } catch (e: unknown) {
      if (backupDir) await restoreBackup(repoPath, backupDir, untracked);
      return {
        success: false,
        conflicts: [],
        message: `stash 失败：${errStr(e) || "未知错误"}`,
      };
    }

    try {
      await git.checkout(name);
    } catch (e: unknown) {
      if (stashed) {
        await git.raw(["stash", "pop", "--index"]).catch(() => {
          git.raw(["stash", "pop"]).catch(() => {});
        });
      }
      if (backupDir) await restoreBackup(repoPath, backupDir, untracked);
      return {
        success: false,
        conflicts: [],
        message: `checkout 失败（已恢复现场）：${errStr(e) || "未知错误"}`,
      };
    }

    const backupNote =
      backupDir && untracked.length > 0
        ? `；${untracked.length} 个被忽略/未跟踪文件已被目标分支版本覆盖，原文件备份于 ${path.relative(repoPath, backupDir)}`
        : "";

    if (!stashed) {
      return { success: true, conflicts: [], message: `已切换到 '${name}'${backupNote}` };
    }
    try {
      await git.raw(["stash", "pop", "--index"]);
      return {
        success: true,
        conflicts: [],
        message: `已切换到 '${name}' 并恢复本地修改${backupNote}`,
      };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: `已切到 '${name}'，但 stash pop 冲突，stash 保留在栈顶${backupNote}：${errStr(e) || "请手动处理"}`,
        // 改动已带冲突标记落在工作区，stash 冗余；前端三栏解决后应 stash drop（与 pull 一致）
        autoStash: { kind: "stash-pop" },
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
    if (await isAncestorRef(repoPath, name, "HEAD")) {
      return { success: true, conflicts: [], message: "已合并" };
    }
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
        message: errStr(e) || "合并失败并产生冲突",
      };
    }
  },

  async rebaseBranch(repoPath: string, upstream: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      await git.rebase([upstream]);
      return { success: true, conflicts: [], message: "变基完成" };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "变基失败并产生冲突",
      };
    }
  },

  /**
   * Rebase with --autosquash —— 自动合并 fixup!/squash! 提交。
   *
   * 用 GIT_SEQUENCE_EDITOR=true 实现非交互 rebase：`true` 忽略 todo 文件参数并退出 0，
   * git 沿用 --autosquash 已重排好的 todo 继续。`true` 在 POSIX 与 git-for-windows 内置
   * sh 中均可用，避免把含反斜杠的 Windows 脚本路径交给 sh 执行时被转义吞掉（command not found）。
   *
   * 调用前请确保工作区 clean，否则 git 会拒绝 rebase。
   */
  async rebaseAutosquash(repoPath: string, upstream: string): Promise<MergeResult> {
    try {
      await execFile(
        "git",
        ["-C", repoPath, "rebase", "--interactive", "--autosquash", upstream],
        {
          env: {
            ...process.env,
            GIT_SEQUENCE_EDITOR: "true",
            GIT_EDITOR: "true",
            EDITOR: "true",
          },
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        }
      );
      return { success: true, conflicts: [], message: "自动压缩变基完成" };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "自动压缩（autosquash）变基失败",
      };
    }
  },

  async cherryPick(repoPath: string, commitId: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      await git.raw(["cherry-pick", commitId]);
      return { success: true, conflicts: [], message: "拣选（Cherry-pick）完成" };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "拣选（cherry-pick）失败并产生冲突",
      };
    }
  },

  /**
   * 批量 cherry-pick 多个 commit。
   *
   * git 原生 `cherry-pick A B C` 行为：按顺序应用，遇到冲突暂停。这里 commits 应按
   * **从旧到新**顺序传入（IDEA UI 选择 commit 时按时间倒序，调用方需 reverse）。
   *
   * 与单 commit 版本一致：成功时返回 { success: true }，失败时返回当前冲突列表。
   */
  async cherryPickRange(repoPath: string, commitIds: string[]): Promise<MergeResult> {
    if (!Array.isArray(commitIds) || commitIds.length === 0) {
      return { success: true, conflicts: [], message: "no commits to cherry-pick" };
    }
    const git = getGit(repoPath);
    try {
      await git.raw(["cherry-pick", ...commitIds]);
      return {
        success: true,
        conflicts: [],
        message: `拣选（Cherry-pick）${commitIds.length} 个提交完成`,
      };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || `拣选（cherry-pick）失败于 ${commitIds[0]}`,
      };
    }
  },

  async revertCommit(repoPath: string, commitId: string): Promise<MergeResult> {
    const git = getGit(repoPath);
    try {
      await git.raw(["revert", "--no-edit", commitId]);
      return { success: true, conflicts: [], message: "回滚（Revert）完成" };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "回滚（revert）失败并产生冲突",
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
