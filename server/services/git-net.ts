import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { REMOTE_GIT_TIMEOUT_MS } from "./_helpers.js";

/**
 * 可取消的「联网 git」执行器。
 *
 * 背景：联网命令（push / pull / fetch / clone）历史上和本地命令共用同一个 simple-git
 * 串行实例（getOrCreateGit，maxConcurrentProcesses:1）。simple-git 不暴露底层子进程，
 * 无法在「推送中卡死」时主动 kill；而这条卡死的联网命令会一直占着唯一的串行队列槽，
 * 让随后的本地恢复命令（rebase --continue / --abort）排队、永不返回。
 *
 * 本模块把联网命令换成**自己 spawn 的可杀子进程**，并：
 *   1. 按仓库登记在途子进程 → `cancelNetworkGit(repo)` 可一键终止（含 Windows 进程树）；
 *   2. 联网命令**移出** simple-git 串行队列（另走一条 lane）—— 于是 abort/continue
 *      不再排在联网命令后面；
 *   3. abort/continue 执行前先 `cancelNetworkGit` 杀掉在途联网子进程，**全程绝不让
 *      同一仓库出现两个并发 git 进程**，从而保住 index.lock 串行安全。
 *
 * 与后台刷新的并发：push/pull/fetch 仍在前端 WRITE_COMMANDS 内点亮 isGitWriting，
 * 三个后台刷新器（status 轮询 / autofetch / watcher）在联网期间已被暂停，因此联网
 * 子进程与后台读命令不会并发争抢 .git 锁。
 */

const activeProcs = new Map<string, Set<ProcEntry>>();

interface ProcEntry {
  child: ChildProcess;
  cancel: () => void;
}

function keyOf(repoPath: string): string {
  return path.resolve(repoPath);
}

/** 被 cancelNetworkGit 主动终止时抛出的错误；shouldRetry 据 `cancelled` 标记跳过重试。 */
export class GitCancelledError extends Error {
  readonly cancelled = true;
  constructor(message = "操作已取消") {
    super(message);
    this.name = "GitCancelledError";
  }
}

interface RunOpts {
  /** 连续无任何 stdout/stderr 输出超过该毫秒数即视为卡死并 kill（默认 120s）。 */
  blockTimeoutMs?: number;
}

/**
 * 低层：spawn 一个受跟踪、可杀的子进程，按 repoPath 登记，便于 cancelNetworkGit 终止。
 *
 * 抽出 binary/args 是为了可测试性——单测用 `process.execPath`（node）跑一个 sleep
 * 脚本，即可确定性地验证「取消会杀进程并 reject」，无需依赖真实慢速网络。
 */
export function runTracked(
  repoPath: string,
  binary: string,
  args: string[],
  opts: RunOpts = {}
): Promise<string> {
  const key = keyOf(repoPath);
  const blockMs = opts.blockTimeoutMs ?? REMOTE_GIT_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(binary, args, {
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT ?? "0" },
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    let stdout = "";
    let stderr = "";
    let cancelled = false;
    let timedOut = false;
    let settled = false;
    let blockTimer: ReturnType<typeof setTimeout> | undefined;
    let hardKillTimer: ReturnType<typeof setTimeout> | undefined;

    const doKill = (): void => {
      if (child.pid == null) return;
      if (process.platform === "win32") {
        // Windows 上 child.kill 只终止 git.exe 本身，git-remote-https 等子进程会成为
        // 孤儿继续卡网络；taskkill /T 杀整棵进程树才能真正中止。
        try {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already dead */
          }
        }
      } else {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already dead */
        }
        if (!hardKillTimer) {
          hardKillTimer = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              /* already dead */
            }
          }, 2000);
          hardKillTimer.unref?.();
        }
      }
    };

    const entry: ProcEntry = {
      child,
      cancel: () => {
        cancelled = true;
        doKill();
      },
    };
    let set = activeProcs.get(key);
    if (!set) {
      set = new Set();
      activeProcs.set(key, set);
    }
    set.add(entry);

    const resetBlockTimer = (): void => {
      if (blockTimer) clearTimeout(blockTimer);
      blockTimer = setTimeout(() => {
        timedOut = true;
        doKill();
      }, blockMs);
      blockTimer.unref?.();
    };
    resetBlockTimer();

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
      resetBlockTimer();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      resetBlockTimer();
    });

    const cleanup = (): void => {
      settled = true;
      if (blockTimer) clearTimeout(blockTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      const s = activeProcs.get(key);
      if (s) {
        s.delete(entry);
        if (s.size === 0) activeProcs.delete(key);
      }
    };

    child.on("error", (err) => {
      if (settled) return;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    child.on("close", (code) => {
      if (settled) return;
      cleanup();
      if (cancelled) {
        reject(new GitCancelledError());
        return;
      }
      if (timedOut) {
        reject(new Error(`git operation timed out (no output for ${blockMs}ms)`));
        return;
      }
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `git exited with code ${code}`));
    });
  });
}

/** 跑一条联网 git 命令（`git -C <repo> <args...>`），可被 cancelNetworkGit 终止。 */
export function runNetworkGit(repoPath: string, args: string[], opts?: RunOpts): Promise<string> {
  return runTracked(repoPath, "git", ["-C", repoPath, ...args], opts);
}

/**
 * 终止指定仓库所有在途联网子进程（含进程树）。返回被终止的进程数。
 * 被终止的命令对应的 Promise 会以 GitCancelledError reject。
 */
export function cancelNetworkGit(repoPath: string): number {
  const set = activeProcs.get(keyOf(repoPath));
  if (!set || set.size === 0) return 0;
  let n = 0;
  // 复制一份再遍历：cancel() 触发的 close 回调会改动原 Set。
  for (const entry of [...set]) {
    entry.cancel();
    n++;
  }
  return n;
}

/** 该仓库当前是否有在途联网 git 子进程。 */
export function hasActiveNetworkGit(repoPath: string): boolean {
  const set = activeProcs.get(keyOf(repoPath));
  return !!set && set.size > 0;
}
