import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useRepoStore } from "./repoStore";
import { commands } from "@/utils/commands";
import type { BranchInfo, MergeResult, Submodule } from "@/utils/commands";

/**
 * 冲突解决信号：IDEA 风格「无冲突静默、有冲突直接开三栏」。
 * checkout / pull 等操作产生冲突时 bump seq，MainLayout 监听后打开全局三栏。
 * - files：冲突文件列表
 * - autoStash："stash-pop" 表示改动已带冲突标记落在工作区，解决后应 drop stash@{0}
 */
export interface ConflictResolveSignal {
  files: string[];
  autoStash: { kind: "merge" | "stash-pop" } | null;
  seq: number;
}

/** 跨组件切 tab 的"信号 ref"，bump 数字触发 watcher。 */
export interface TabSwitchSignal {
  tab: "log" | "commit" | "stash";
  seq: number;
}

/** 全局 toast 信号；MainLayout 监听并显示。 */
export interface GlobalToast {
  message: string;
  kind: "ok" | "err" | "info";
  seq: number;
}

export const useBranchStore = defineStore("branch", () => {
  const localBranches = ref<BranchInfo[]>([]);
  const remoteBranches = ref<BranchInfo[]>([]);
  const tags = ref<string[]>([]);
  const submodules = ref<Submodule[]>([]);
  const submodulesLoading = ref(false);
  const loading = ref(false);
  const searchQuery = ref("");
  const favorites = ref<string[]>([]);

  const conflictSignal = ref<ConflictResolveSignal>({ files: [], autoStash: null, seq: 0 });

  const tabSwitchSignal = ref<TabSwitchSignal>({ tab: "log", seq: 0 });
  const globalToast = ref<GlobalToast>({ message: "", kind: "info", seq: 0 });

  function requestTabSwitch(tab: "log" | "commit" | "stash"): void {
    tabSwitchSignal.value = { tab, seq: tabSwitchSignal.value.seq + 1 };
  }

  function showToast(message: string, kind: "ok" | "err" | "info" = "info"): void {
    globalToast.value = { message, kind, seq: globalToast.value.seq + 1 };
  }

  const repoStore = useRepoStore();

  const branchCache = new Map<string, { local: BranchInfo[]; remote: BranchInfo[]; tags: string[] }>();

  // 切仓库时清掉跨仓库会污染/误操作的状态：
  // - searchQuery：A 的分支搜索文字带到 B 是 UX bug
  // - submodules：A 的 submodule 列表残留到 B 直到 loadSubmodules 完成
  // 不动 favorites：星标分支跨仓库共享（产品决策，命名常重叠如 main/develop）
  watch(
    () => repoStore.activeRepo?.path,
    () => {
      searchQuery.value = "";
      submodules.value = [];
      submodulesLoading.value = false;
    }
  );

  async function loadBranches() {
    if (!repoStore.activeRepo) return;
    const repoPath = repoStore.activeRepo.path;

    const cached = branchCache.get(repoPath);
    if (cached) {
      localBranches.value = cached.local;
      remoteBranches.value = cached.remote;
      tags.value = cached.tags;
    }

    loading.value = true;
    try {
      const result = await commands.getBranches(repoPath);
      localBranches.value = result.local;
      remoteBranches.value = result.remote;
      tags.value = result.tags;
      branchCache.set(repoPath, { local: result.local, remote: result.remote, tags: result.tags });
    } finally {
      loading.value = false;
    }
  }

  async function createBranch(name: string, startPoint?: string) {
    if (!repoStore.activeRepo) return;
    await commands.createBranch(repoStore.activeRepo.path, name, startPoint);
    await loadBranches();
  }

  /**
   * 产生冲突时通知 MainLayout 打开全局三栏。
   * @param files 冲突文件
   * @param autoStash "stash-pop" 表示解决后需 drop stash@{0}
   */
  function requestConflictResolve(
    files: string[],
    autoStash?: { kind: "merge" | "stash-pop" } | null
  ): void {
    if (files.length === 0) return;
    conflictSignal.value = {
      files,
      autoStash: autoStash ?? null,
      seq: conflictSignal.value.seq + 1,
    };
  }

  /**
   * 静默 Pull —— 仿 IntelliJ「Update Project」但不弹预检窗：
   *   1. 预检（previewPullConflicts）：fetch + status + diff HEAD..@{u}
   *   2. 已是最新（remote 没多 commit 且工作区干净）→ 仅 toast 提示
   *   3. 其余情况（含 dirty）→ 直接 Smart Pull；后端 dirty 时自动 stash→pull→pop，
   *      冲突时返回 conflicts 由调用方弹三栏（Force Pull 改为分支右键单独入口）
   *   4. preview 接口失败 → 降级到直接 pull（保持兼容、不阻断）
   *
   * 返回值：
   *   - MergeResult：成功 / 失败 / 冲突，前端 UI 据此决定后续行为
   *   - null：repoPath 缺失
   */
  async function smartPullCurrentBranch(opts?: {
    branchName?: string;
    remote?: string;
    rebase?: boolean;
    repoPath?: string;
  }): Promise<MergeResult | null> {
    const repoPath = opts?.repoPath ?? repoStore.activeRepo?.path;
    if (!repoPath) return null;
    const headBranchName =
      opts?.branchName ?? localBranches.value.find((b) => b.isHead)?.name ?? "HEAD";

    let preview;
    try {
      preview = await commands.previewPullConflicts(repoPath, opts?.remote);
    } catch {
      return await commands.pull(repoPath, opts?.remote, opts?.rebase ?? false);
    }

    if (preview.upstream && preview.remoteCommitsAhead === 0 && preview.dirtyFiles.length === 0) {
      showToast(`${headBranchName} 已是最新状态`, "ok");
      return { success: true, conflicts: [], message: "已是最新" };
    }

    // 静默 Smart Pull：无论工作区是否 dirty 都直接 pull。
    // 后端 pull 在 dirty 时会自动 stash→pull→pop；产生冲突时返回 conflicts，由调用方弹三栏。
    // （原 dirty 三选项预检窗已不再触发；Force Pull 改为分支右键单独入口）
    return await commands.pull(repoPath, opts?.remote, opts?.rebase ?? false);
  }

  /**
   * IDEA 风格 checkout：无冲突直接静默切换，有冲突直接走全局三栏，不再弹「选一项」框。
   * 所有 checkout 入口（侧栏右键、log 右键、新建分支后切换等）都走本方法。
   *
   * 分支：
   * - 干净 / dirty 但目标分支没碰且无未跟踪覆盖 → 直接 checkout（改动自动带过去）
   * - dirty 冲突 / 未跟踪覆盖 / 预检失败 → 静默 smartCheckout（stash→切→pop / 自动备份）
   *   - pop 冲突 → bump conflictSignal 让 MainLayout 开三栏，并跳到本地变更 tab
   *   - stash/checkout/备份阶段失败 → toast 报错，仍在原分支
   */
  async function checkoutBranch(name: string) {
    if (!repoStore.activeRepo) return;
    const repoPath = repoStore.activeRepo.path;

    let dirty: string[] = [];
    try {
      const status = await commands.getStatus(repoPath);
      const all = [...status.staged, ...status.unstaged, ...status.untracked];
      // 同一文件可能同时在 staged + unstaged，去重
      dirty = Array.from(new Set(all.map((f) => f.path)));
    } catch {
      // status 取不到 → 当作无 dirty，下面会走直切
    }

    let previewOk = true;
    let wouldConflict: string[] = [];
    let untrackedConflict: string[] = [];
    try {
      const preview = await commands.previewCheckoutConflicts(repoPath, name, dirty);
      wouldConflict = preview.wouldConflict;
      untrackedConflict = preview.untrackedConflict ?? [];
    } catch {
      previewOk = false;
    }

    // 无冲突（含 dirty 但目标分支没碰、且无未跟踪覆盖）→ 直接 checkout，改动自动带过去。
    // 被 .gitignore 忽略的文件不在 dirty 里，靠 untrackedConflict 兜底，避免直切撞
    // "would be overwritten by checkout"。
    if (previewOk && wouldConflict.length === 0 && untrackedConflict.length === 0) {
      await commands.checkoutBranch(repoPath, name);
      repoStore.activeRepo.currentBranch = name;
      await loadBranches();
      showToast(dirty.length ? `已切换到 '${name}'，本地修改已保留` : `已切换到 '${name}'`, "ok");
      return;
    }

    // 冲突 / 未跟踪覆盖 / 预检失败 → 静默 smartCheckout
    const result = await commands.smartCheckoutBranch(repoPath, name);
    if (result.success) {
      repoStore.activeRepo.currentBranch = name;
      await loadBranches();
      showToast(result.message || `已切换到 '${name}' 并恢复本地修改`, "ok");
      return;
    }
    if (result.conflicts.length > 0) {
      // 已切到目标分支，改动带冲突标记落在工作区 → 跳本地变更 tab + 开全局三栏
      repoStore.activeRepo.currentBranch = name;
      await loadBranches();
      requestTabSwitch("commit");
      requestConflictResolve(result.conflicts, result.autoStash ?? { kind: "stash-pop" });
      showToast(
        `本地改动与 '${name}' 冲突，${result.conflicts.length} 个文件请在三栏中解决`,
        "err"
      );
      return;
    }
    // stash / checkout / 备份阶段失败 → 仍在原分支
    showToast(result.message || `切换到 '${name}' 失败`, "err");
  }

  /** 强制签出（丢弃本地未提交修改）。供分支右键「强制签出」入口，调用方需先二次确认。 */
  async function forceCheckout(name: string) {
    if (!repoStore.activeRepo) return;
    const repoPath = repoStore.activeRepo.path;
    await commands.forceCheckoutBranch(repoPath, name);
    repoStore.activeRepo.currentBranch = name;
    await loadBranches();
  }

  async function deleteBranch(name: string, force = false) {
    if (!repoStore.activeRepo) return;
    await commands.deleteBranch(repoStore.activeRepo.path, name, force);
    await loadBranches();
  }

  async function renameBranch(oldName: string, newName: string) {
    if (!repoStore.activeRepo) return;
    await commands.renameBranch(repoStore.activeRepo.path, oldName, newName);
    await loadBranches();
  }

  async function mergeBranch(name: string) {
    if (!repoStore.activeRepo) return;
    return await commands.mergeBranch(repoStore.activeRepo.path, name);
  }

  async function createTag(name: string, commitId?: string, message?: string) {
    if (!repoStore.activeRepo) return;
    await commands.createTag(repoStore.activeRepo.path, name, commitId, message);
    await loadBranches();
  }

  async function deleteTag(name: string) {
    if (!repoStore.activeRepo) return;
    await commands.deleteTag(repoStore.activeRepo.path, name);
    await loadBranches();
  }

  async function pushTag(remote: string, name: string) {
    if (!repoStore.activeRepo) return;
    await commands.pushTag(repoStore.activeRepo.path, remote, name);
  }

  async function deleteRemoteTag(remote: string, name: string) {
    if (!repoStore.activeRepo) return;
    await commands.deleteRemoteTag(repoStore.activeRepo.path, remote, name);
  }

  async function checkoutTag(name: string) {
    if (!repoStore.activeRepo) return;
    await commands.checkoutTag(repoStore.activeRepo.path, name);
    await loadBranches();
  }

  function toggleFavorite(name: string) {
    const idx = favorites.value.indexOf(name);
    if (idx >= 0) {
      favorites.value.splice(idx, 1);
    } else {
      favorites.value.push(name);
    }
  }

  async function loadSubmodules() {
    if (!repoStore.activeRepo) return;
    submodulesLoading.value = true;
    try {
      submodules.value = await commands.getSubmodules(repoStore.activeRepo.path);
    } finally {
      submodulesLoading.value = false;
    }
  }

  async function initSubmodule(path?: string) {
    if (!repoStore.activeRepo) return;
    await commands.initSubmodules(repoStore.activeRepo.path, path ? [path] : undefined);
    await loadSubmodules();
  }

  async function updateSubmodule(path?: string) {
    if (!repoStore.activeRepo) return;
    await commands.updateSubmodules(repoStore.activeRepo.path, path ? [path] : undefined);
    await loadSubmodules();
  }

  async function syncSubmodule(path?: string) {
    if (!repoStore.activeRepo) return;
    await commands.syncSubmodules(repoStore.activeRepo.path, path ? [path] : undefined);
    await loadSubmodules();
  }

  return {
    localBranches,
    remoteBranches,
    tags,
    submodules,
    submodulesLoading,
    loading,
    searchQuery,
    favorites,
    conflictSignal,
    tabSwitchSignal,
    globalToast,
    requestConflictResolve,
    smartPullCurrentBranch,
    requestTabSwitch,
    showToast,
    loadBranches,
    createBranch,
    checkoutBranch,
    forceCheckout,
    deleteBranch,
    renameBranch,
    mergeBranch,
    createTag,
    deleteTag,
    pushTag,
    deleteRemoteTag,
    checkoutTag,
    toggleFavorite,
    loadSubmodules,
    initSubmodule,
    updateSubmodule,
    syncSubmodule,
  };
});
