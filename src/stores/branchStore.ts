import { defineStore } from "pinia";
import { ref } from "vue";
import { useRepoStore } from "./repoStore";
import { commands } from "@/utils/commands";
import type { BranchInfo, Submodule } from "@/utils/commands";

/**
 * IDEA 风格切分支 dirty 决策窗口的状态机。
 * `resolve` 为 null 表示当前没有挂起的请求；非 null 时 dialog 应该可见。
 *
 * `wouldConflict` / `safe` 是切到目标分支后的影响预检测：
 * - `wouldConflict`：dirty 且目标分支也动过 → Smart pop 时可能冲突，Force 直接丢失
 * - `safe`：dirty 但目标分支未动 → Smart pop 100% 成功保留；Force 仍丢失
 */
export interface CheckoutDialogState {
  visible: boolean;
  branchName: string;
  dirtyFiles: string[];
  wouldConflict: string[];
  safe: string[];
  pending: boolean;
  resultMessage: string;
  resultKind: "ok" | "err" | null;
  resolve: ((choice: "smart" | "force" | "cancel") => void) | null;
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

  const checkoutDialog = ref<CheckoutDialogState>({
    visible: false,
    branchName: "",
    dirtyFiles: [],
    wouldConflict: [],
    safe: [],
    pending: false,
    resultMessage: "",
    resultKind: null,
    resolve: null,
  });

  const tabSwitchSignal = ref<TabSwitchSignal>({ tab: "log", seq: 0 });
  const globalToast = ref<GlobalToast>({ message: "", kind: "info", seq: 0 });

  function requestTabSwitch(tab: "log" | "commit" | "stash"): void {
    tabSwitchSignal.value = { tab, seq: tabSwitchSignal.value.seq + 1 };
  }

  function showToast(message: string, kind: "ok" | "err" | "info" = "info"): void {
    globalToast.value = { message, kind, seq: globalToast.value.seq + 1 };
  }

  const repoStore = useRepoStore();

  async function loadBranches() {
    if (!repoStore.activeRepo) return;
    loading.value = true;
    try {
      const result = await commands.getBranches(repoStore.activeRepo.path);
      localBranches.value = result.local;
      remoteBranches.value = result.remote;
      tags.value = result.tags;
    } finally {
      loading.value = false;
    }
  }

  async function createBranch(name: string, startPoint?: string) {
    if (!repoStore.activeRepo) return;
    await commands.createBranch(repoStore.activeRepo.path, name, startPoint);
    await loadBranches();
  }

  function closeCheckoutDialog(): void {
    checkoutDialog.value = {
      visible: false,
      branchName: "",
      dirtyFiles: [],
      wouldConflict: [],
      safe: [],
      pending: false,
      resultMessage: "",
      resultKind: null,
      resolve: null,
    };
  }

  /**
   * IDEA 风格 checkout：dirty 时弹窗给三选项（Smart / Force / Cancel），
   * 干净时直接 checkout。所有 checkout 入口（侧栏右键、log 右键、新建分支后切换等）
   * 都走本方法，无需调用方各自检测 dirty。
   *
   * 异常策略：
   * - dirty 检测失败 → 退化为直接 checkout（保持兼容）
   * - 用户取消 → 静默 return（不抛错）
   * - smart pop 冲突 → 在 dialog 内显示提示，不抛；分支已切，stash 仍在栈顶
   * - force checkout 失败 / smart 中 stash/checkout 阶段失败 → 抛错，调用方现有 try/catch 接收
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
      // status 取不到 → 跳过 dirty 检测，按原行为直接 checkout
    }

    if (dirty.length === 0) {
      await commands.checkoutBranch(repoPath, name);
      repoStore.activeRepo.currentBranch = name;
      await loadBranches();
      return;
    }

    let wouldConflict: string[] = [];
    let safe: string[] = dirty;
    try {
      const preview = await commands.previewCheckoutConflicts(repoPath, name, dirty);
      wouldConflict = preview.wouldConflict;
      safe = preview.safe;
    } catch {
      // 预检测失败 → 退化为"全部 dirty 当作安全"，仍交给用户决策
    }

    const choice = await new Promise<"smart" | "force" | "cancel">((resolve) => {
      checkoutDialog.value = {
        visible: true,
        branchName: name,
        dirtyFiles: dirty,
        wouldConflict,
        safe,
        pending: false,
        resultMessage: "",
        resultKind: null,
        resolve,
      };
    });

    if (choice === "cancel") {
      closeCheckoutDialog();
      return;
    }

    checkoutDialog.value.pending = true;
    checkoutDialog.value.resolve = null;

    try {
      if (choice === "smart") {
        const result = await commands.smartCheckoutBranch(repoPath, name);
        if (result.success) {
          closeCheckoutDialog();
          repoStore.activeRepo.currentBranch = name;
          await loadBranches();
          showToast(result.message || `已切换到 '${name}' 并恢复本地修改`, "ok");
          return;
        }
        // pop 冲突：分支已切，关闭 dialog → 跳到"本地变更"tab → 显示 toast
        if (result.conflicts.length > 0) {
          closeCheckoutDialog();
          repoStore.activeRepo.currentBranch = name;
          await loadBranches();
          requestTabSwitch("commit");
          showToast(
            `Stash pop 冲突，${result.conflicts.length} 个文件需手动解决（已跳到本地变更）`,
            "err"
          );
          return;
        }
        // 其它失败（stash 或 checkout 阶段）：仍在原分支
        checkoutDialog.value.pending = false;
        checkoutDialog.value.resultKind = "err";
        checkoutDialog.value.resultMessage = result.message;
        return;
      }
      await commands.forceCheckoutBranch(repoPath, name);
      closeCheckoutDialog();
      repoStore.activeRepo.currentBranch = name;
      await loadBranches();
      showToast(`已强制切换到 '${name}'，本地未提交修改已丢弃`, "ok");
    } catch (e: unknown) {
      checkoutDialog.value.pending = false;
      checkoutDialog.value.resultKind = "err";
      checkoutDialog.value.resultMessage = e instanceof Error ? e.message : String(e);
    }
  }

  function resolveCheckoutChoice(choice: "smart" | "force" | "cancel"): void {
    const resolver = checkoutDialog.value.resolve;
    if (resolver) {
      resolver(choice);
    } else if (choice === "cancel") {
      // 已无 pending 请求时，cancel 兼作"关闭结果提示"按钮
      closeCheckoutDialog();
    }
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
    checkoutDialog,
    tabSwitchSignal,
    globalToast,
    resolveCheckoutChoice,
    requestTabSwitch,
    showToast,
    loadBranches,
    createBranch,
    checkoutBranch,
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
