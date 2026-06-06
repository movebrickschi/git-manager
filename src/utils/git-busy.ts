import { computed, ref } from "vue";

/**
 * 全局「Git 写操作进行中」信号。
 *
 * 目的（修复 B，配合后端共享串行实例的修复 A）：在 pull / push / fetch / merge /
 * rebase / stash / commit 等写操作进行期间，暂停三个后台自动刷新器
 * （useStatusPolling 的 10s 轮询、useAutoFetch 的定时 fetch、useRepoWatcher 的
 * 文件系统事件回调），避免它们与写操作并发触发 git 子进程。
 *
 * 后端共享串行队列（getOrCreateGit）已从根本上消除「并发争抢 .git/index.lock」，
 * 本模块是第二道防线：① 避免后台读命令排在 pull（最长 120s）后面苦等导致 UI 卡顿；
 * ② 减少写操作期间无意义的中间态刷新（写操作完成后各 store 会主动 refreshGit 补刷）。
 * 这正是 IntelliJ IDEA「VCS 写操作期间冻结后台 status 计算」的等价行为。
 *
 * 用计数器而非布尔：支持并发 / 嵌套写操作（如 commitAndPush 串两条写命令），
 * 只有当全部写操作结束、计数归零后才解除冻结。
 */
const writeDepth = ref(0);

/** 是否有 Git 写操作正在进行（后台刷新器据此跳过本次 tick）。 */
export const isGitWriting = computed(() => writeDepth.value > 0);

export function beginGitWrite(): void {
  writeDepth.value += 1;
}

export function endGitWrite(): void {
  if (writeDepth.value > 0) writeDepth.value -= 1;
}

/** 包裹一个写操作：进入时占用写信号，结束（无论成功失败）后释放。 */
export async function runGitWrite<T>(fn: () => Promise<T>): Promise<T> {
  beginGitWrite();
  try {
    return await fn();
  } finally {
    endGitWrite();
  }
}
