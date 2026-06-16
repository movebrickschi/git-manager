import { computed, reactive } from "vue";

/**
 * 全局「联网 Git 操作进行中」信号（push / pull / fetch / forcePull 等）。
 *
 * 与 git-busy.ts 的 isGitWriting 的区别：isGitWriting 覆盖**所有**写命令（含本地
 * commit / stage），而本模块只跟踪**联网**命令——状态栏据此显示「联网中…[中止]」，
 * 让用户在 push/pull 卡住时一键调 cancelNetworkOps 杀掉后端 git 子进程，而不必苦等
 * 120s block 超时。
 *
 * 按 repoPath 计数：支持多仓库并行联网，也支持单仓库嵌套（如 commitAndPush）。
 * 中止时遍历所有在途仓库（networkBusyRepos）。
 */
const counts = reactive(new Map<string, number>());

/** 是否有任意仓库正在进行联网 Git 操作。 */
export const isNetworkBusy = computed(() => {
  for (const n of counts.values()) if (n > 0) return true;
  return false;
});

/** 当前所有有在途联网操作的仓库路径列表。 */
export const networkBusyRepos = computed(() => {
  const out: string[] = [];
  for (const [repo, n] of counts) if (n > 0) out.push(repo);
  return out;
});

export function beginNetwork(repoPath: string): void {
  if (!repoPath) return;
  counts.set(repoPath, (counts.get(repoPath) ?? 0) + 1);
}

export function endNetwork(repoPath: string): void {
  if (!repoPath) return;
  const n = counts.get(repoPath) ?? 0;
  if (n <= 1) counts.delete(repoPath);
  else counts.set(repoPath, n - 1);
}

/** 包裹一个联网操作：进入时占用信号，结束（无论成功失败）后释放。 */
export async function runNetworkBusy<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  beginNetwork(repoPath);
  try {
    return await fn();
  } finally {
    endNetwork(repoPath);
  }
}
