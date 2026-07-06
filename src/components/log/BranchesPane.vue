<script setup lang="ts">
import { ref, computed, onMounted, watch, defineAsyncComponent } from "vue";
import { useBranchStore } from "@/stores/branchStore";
import { useLogStore } from "@/stores/logStore";
import { useRepoStore } from "@/stores/repoStore";
import SearchBar from "@/components/common/SearchBar.vue";
import ToolbarButton from "@/components/common/ToolbarButton.vue";
import ContextMenu from "@/components/common/ContextMenu.vue";
import type { MenuItem } from "@/components/common/ContextMenu.vue";
import type { BranchInfo, Submodule } from "@/utils/commands";
import { commands } from "@/utils/commands";
import { refreshGit } from "@/composables/useGitRefresh";
import { translateGitError } from "@/utils/git-error";
import { SHORTCUTS, useKeyboardShortcuts } from "@/utils/keyboard";
import { useUiStore } from "@/stores/uiStore";
const ThreeWayMerge = defineAsyncComponent(() => import("@/components/merge/ThreeWayMerge.vue"));
import PushDialog from "@/components/common/PushDialog.vue";
import CreateTagDialog from "@/components/common/CreateTagDialog.vue";
import ReflogDialog from "@/components/common/ReflogDialog.vue";
import ConfirmDialog from "@/components/changes/ConfirmDialog.vue";
import BranchPopup from "@/components/branch/BranchPopup.vue";

function friendlyErr(input: unknown): string {
  if (input == null) return translateGitError("");
  if (typeof input === "string") return translateGitError(input);
  if (input instanceof Error) return translateGitError(input.message);
  return translateGitError(String(input));
}

const branchStore = useBranchStore();
const logStore = useLogStore();
const repoStore = useRepoStore();
const ui = useUiStore();

const props = defineProps<{
  activeTab: "log" | "commit" | "stash" | "report";
}>();

const emit = defineEmits<{
  "update:activeTab": [tab: "log" | "commit" | "stash" | "report"];
}>();

const searchQuery = ref("");
const showRemote = ref(true);
const showTags = ref(true);
const contextMenuRef = ref<InstanceType<typeof ContextMenu>>();
const contextBranch = ref<BranchInfo | null>(null);
const contextBranchKind = ref<"local" | "remote">("local");

/** 侧边栏当前选中的分支（用于 Push / Fetch 等） */
const selectedSidebarBranch = ref<{
  kind: "local" | "remote";
  name: string;
} | null>(null);

const actionLoading = ref(false);
const actionError = ref("");
/** 正在执行拉取/更新的分支名集合 —— 用于在分支条目图标位显示 loading spinner。 */
const busyBranches = ref<Set<string>>(new Set());

// 推送确认弹框
const showPushDialog = ref(false);
const pushDialogRemote = ref<string | undefined>(undefined);
const pushDialogBranch = ref<string | undefined>(undefined);
const pushBusyBranch = ref<string | undefined>(undefined);

// 冲突解决弹窗
const showConflictDialog = ref(false);
const conflictDialogFiles = ref<string[]>([]);
const conflictDialogFirstFile = ref("");
// 记录触发本次三栏的 pull 是否自动 stash 过，决定冲突解决后 drop 还是 pop
const conflictAutoStash = ref<{ kind: "merge" | "stash-pop" } | null>(null);
// Force Pull 二次确认
const showForceConfirm = ref(false);
const forceConfirmBranch = ref("");
// Reset to Remote 二次确认：会丢弃未推送提交，比 force pull 更危险
const showResetRemoteConfirm = ref(false);
const resetRemoteConfirmBranch = ref<BranchInfo | null>(null);

// Tag 相关
const showCreateTagDialog = ref(false);
const tagContextMenuRef = ref<InstanceType<typeof ContextMenu>>();
const contextTagName = ref<string | null>(null);

// Reflog 弹窗
const showReflogDialog = ref(false);

// 新建分支弹窗
const showNewBranchDialog = ref(false);
const newBranchFromRef = ref("");

// 重命名分支弹窗
const showRenameDialog = ref(false);
const renameOldName = ref("");
const renameNewName = ref("");

// Submodules
const showSubmodules = ref(true);
const submoduleContextMenuRef = ref<InstanceType<typeof ContextMenu>>();
const contextSubmodule = ref<Submodule | null>(null);

function showSubmoduleContextMenu(event: MouseEvent, sm: Submodule): void {
  contextSubmodule.value = sm;
  submoduleContextMenuRef.value?.show(event);
}

const submoduleContextMenuItems = computed<MenuItem[]>(() => {
  const sm = contextSubmodule.value;
  if (!sm) return [];
  const items: MenuItem[] = [];
  if (sm.state === "uninitialized") {
    items.push({ label: `初始化 '${sm.path}'`, action: () => handleInitSubmodule(sm.path) });
  }
  items.push({
    label: `更新 '${sm.path}'（git submodule update --init）`,
    action: () => handleUpdateSubmodule(sm.path),
  });
  items.push({
    label: `同步 '${sm.path}'（重读 .gitmodules URL）`,
    action: () => handleSyncSubmodule(sm.path),
  });
  items.push({ separator: true, label: "" });
  items.push({
    label: "复制路径",
    action: () => void navigator.clipboard?.writeText(sm.path),
  });
  if (sm.url) {
    items.push({
      label: "复制远程 URL",
      action: () => void navigator.clipboard?.writeText(sm.url),
    });
  }
  return items;
});

async function handleInitSubmodule(path?: string): Promise<void> {
  clearActionError();
  actionLoading.value = true;
  try {
    await branchStore.initSubmodule(path);
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
  }
}

async function handleUpdateSubmodule(path?: string): Promise<void> {
  clearActionError();
  actionLoading.value = true;
  try {
    await branchStore.updateSubmodule(path);
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
  }
}

async function handleSyncSubmodule(path?: string): Promise<void> {
  clearActionError();
  actionLoading.value = true;
  try {
    await branchStore.syncSubmodule(path);
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
  }
}

function submoduleStateIcon(state: Submodule["state"]): { color: string; title: string } {
  switch (state) {
    case "uninitialized":
      return { color: "#9aa0a6", title: "未初始化（右键初始化拉取）" };
    case "modified":
      return { color: "#f0a500", title: "已修改（与主仓库记录的提交不一致）" };
    case "merge-conflict":
      return { color: "#e06c75", title: "合并冲突" };
    default:
      return { color: "#4ec9b0", title: "已初始化" };
  }
}

function openConflictDialog(files: string[], autoStash?: { kind: "merge" | "stash-pop" } | null) {
  if (files.length === 0) return;
  conflictDialogFiles.value = files;
  conflictDialogFirstFile.value = files[0]!;
  conflictAutoStash.value = autoStash ?? null;
  showConflictDialog.value = true;
}

async function onConflictResolved() {
  showConflictDialog.value = false;
  const autoStash = conflictAutoStash.value;
  conflictAutoStash.value = null;
  const path = repoStore.activeRepo?.path;
  if (autoStash && path) {
    if (autoStash.kind === "stash-pop") {
      // 改动已落工作区（带过冲突标记），stash 是冗余的 → 自动 drop，避免 stash 堆积
      try {
        await commands.stashDrop(path, 0);
      } catch (e: unknown) {
        ui.showToast(`自动清理搁置失败，请手动删除 stash@{0}：${friendlyErr(e)}`);
      }
    } else {
      // merge 冲突：stash 里是你未提交的本地改动（未 pop）。自动 pop 的安全时机依赖合并是否已提交，
      // 风险较高，这里只提醒，避免误操作丢改动。
      ui.showToast("本地改动已暂存在 stash@{0}，合并完成后请到「搁置」列表手动恢复");
    }
  }
  void refreshAfterGitOp();
}

function requestForcePull(branch: BranchInfo) {
  forceConfirmBranch.value = branch.name;
  showForceConfirm.value = true;
}

function handleForcePullCancel() {
  showForceConfirm.value = false;
}

async function handleForcePullConfirm() {
  showForceConfirm.value = false;
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  const forceBranch = forceConfirmBranch.value;
  setBranchBusy(forceBranch, true);
  ui.startProgress("强制拉取中…");
  try {
    const remote = await resolveDefaultRemote();
    const result = await commands.forcePull(path, remote, false);
    await refreshAfterGitOp();
    if (result.conflicts && result.conflicts.length > 0) {
      openConflictDialog(result.conflicts, result.autoStash);
    } else if (!result.success) {
      actionError.value = friendlyErr(result.message);
    } else {
      ui.showToast("强制拉取完成（本地未提交改动已被覆盖）");
    }
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(forceBranch, false);
    ui.stopProgress();
  }
}

function requestResetToRemote(branch: BranchInfo) {
  resetRemoteConfirmBranch.value = branch;
  showResetRemoteConfirm.value = true;
}

function handleResetToRemoteCancel() {
  showResetRemoteConfirm.value = false;
  resetRemoteConfirmBranch.value = null;
}

async function resolveResetRemoteTarget(branch: BranchInfo): Promise<{ remote: string; branchName: string }> {
  if (branch.upstream) {
    const parsed = parseRemoteRef(branch.upstream);
    if (parsed) return { remote: parsed.remote, branchName: parsed.branch };
  }
  return { remote: await resolveDefaultRemote(), branchName: branch.name };
}

async function handleResetToRemoteConfirm() {
  showResetRemoteConfirm.value = false;
  const path = repoStore.activeRepo?.path;
  const branch = resetRemoteConfirmBranch.value;
  if (!path || !branch) return;
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(branch.name, true);
  ui.startProgress(`重置 ${branch.name} 到远端中…`);
  try {
    const target = await resolveResetRemoteTarget(branch);
    const result = await commands.resetToRemote(path, target.remote, target.branchName);
    await refreshAfterGitOp();
    if (!result.success) {
      actionError.value = friendlyErr(result.message);
    } else {
      ui.showToast(`已将 ${branch.name} 重置到 ${target.remote}/${target.branchName}`);
    }
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(branch.name, false);
    resetRemoteConfirmBranch.value = null;
    ui.stopProgress();
  }
}

useKeyboardShortcuts([
  {
    ...SHORTCUTS.PULL,
    action: () => {
      if (!repoStore.activeRepo || actionLoading.value) return;
      void handlePull();
    },
  },
]);

onMounted(() => {
  // branches already loaded by parent
  void branchStore.loadSubmodules();
});

watch(
  () => repoStore.activeRepo?.path,
  (newPath, oldPath) => {
    if (newPath === oldPath) return;
    actionError.value = "";
    selectedSidebarBranch.value = null;
    searchQuery.value = "";
  }
);

const headBranch = computed(() => branchStore.localBranches.find((b) => b.isHead) ?? null);

function parseRemoteRef(fullName: string): { remote: string; branch: string } | null {
  const i = fullName.indexOf("/");
  if (i <= 0) return null;
  return { remote: fullName.slice(0, i), branch: fullName.slice(i + 1) };
}

async function checkoutRemoteAsLocal(fullName: string) {
  const parsed = parseRemoteRef(fullName);
  if (!parsed) return;
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(fullName, true);
  try {
    await branchStore.createBranch(parsed.branch, fullName);
    await branchStore.checkoutBranch(parsed.branch);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(fullName, false);
  }
}

async function resolveDefaultRemote(): Promise<string> {
  const path = repoStore.activeRepo?.path;
  if (!path) return "origin";
  try {
    const remotes = await commands.getRemotes(path);
    if (remotes.some((r) => r.name === "origin")) return "origin";
    return remotes[0]?.name ?? "origin";
  } catch {
    return "origin";
  }
}

async function refreshAfterGitOp() {
  // 统一刷新：分支(ahead/behind 箭头) + 提交图 + 工作区文件状态。
  // 旧实现漏了 loadStatus，导致 push/pull/merge 等操作后本地变更角标滞后。
  // submodules 不在此同步刷新（拉取代价较大），仅在 mount 加载。
  await refreshGit();
}

function clearActionError() {
  actionError.value = "";
}

/** 切换某分支的"拉取中"状态。替换 Set 引用以确保模板响应式刷新。 */
function setBranchBusy(name: string | undefined, busy: boolean) {
  if (!name) return;
  const next = new Set(busyBranches.value);
  if (busy) next.add(name);
  else next.delete(name);
  busyBranches.value = next;
}

function isBranchBusy(name: string): boolean {
  return busyBranches.value.has(name);
}

async function handleFetch() {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  const fetchTarget = selectedSidebarBranch.value?.name;
  setBranchBusy(fetchTarget, true);
  ui.startProgress("抓取中…");
  try {
    if (selectedSidebarBranch.value?.kind === "remote") {
      const parsed = parseRemoteRef(selectedSidebarBranch.value.name);
      if (parsed) {
        await commands.fetch(path, parsed.remote);
      } else {
        await commands.fetchAll(path);
      }
    } else {
      await commands.fetchAll(path);
    }
    await refreshAfterGitOp();
    ui.showToast("抓取完成");
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(fetchTarget, false);
    ui.stopProgress();
  }
}

/** Pull：始终针对当前 HEAD 所在分支（与 IDEA 一致） */
async function handlePull() {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  const headName = headBranch.value?.name;
  setBranchBusy(headName, true);
  ui.startProgress("拉取中…");
  try {
    const head = headBranch.value;
    let remote: string | undefined;
    if (head?.upstream) {
      const parsed = parseRemoteRef(head.upstream);
      if (parsed) remote = parsed.remote;
    }
    if (!remote) remote = await resolveDefaultRemote();
    const result = await branchStore.smartPullCurrentBranch({
      branchName: head?.name,
      remote,
      rebase: false,
    });
    await refreshAfterGitOp();
    if (!result) return;
    if (result.conflicts && result.conflicts.length > 0) {
      openConflictDialog(result.conflicts, result.autoStash);
    } else if (!result.success) {
      actionError.value = friendlyErr(result.message);
    } else if (result.message !== "已是最新") {
      ui.showToast("拉取完成，所有文件都处于最新状态");
    }
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(headName, false);
    ui.stopProgress();
  }
}

async function handlePush() {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  const remote = await resolveDefaultRemote();
  if (selectedSidebarBranch.value?.kind === "local") {
    pushDialogRemote.value = remote;
    pushDialogBranch.value = selectedSidebarBranch.value.name;
  } else {
    pushDialogRemote.value = remote;
    pushDialogBranch.value = undefined;
  }
  showPushDialog.value = true;
}

async function onPushConfirmed() {
  showPushDialog.value = false;
  await refreshAfterGitOp();
}

function onPushCancelled() {
  showPushDialog.value = false;
}

/** PushDialog 推送中状态联动：在推送目标分支（或当前 HEAD）条目显示 spinner。 */
function onPushBusy(busy: boolean) {
  if (busy) {
    pushBusyBranch.value =
      pushDialogBranch.value ?? branchStore.localBranches.find((b) => b.isHead)?.name;
    setBranchBusy(pushBusyBranch.value, true);
  } else {
    setBranchBusy(pushBusyBranch.value, false);
    pushBusyBranch.value = undefined;
  }
}

async function fetchForRemoteBranch(fullName: string) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  const parsed = parseRemoteRef(fullName);
  if (!parsed) return;
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(fullName, true);
  try {
    await commands.fetch(path, parsed.remote);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(fullName, false);
  }
}

async function pullForLocalBranch(branch: BranchInfo) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(branch.name, true);
  ui.startProgress(`拉取 ${branch.name}…`);
  try {
    if (!branch.isHead) {
      await branchStore.checkoutBranch(branch.name);
    }
    const head = branchStore.localBranches.find((b) => b.isHead);
    let remote: string | undefined;
    const upstream = head?.upstream ?? branch.upstream;
    if (upstream) {
      const parsed = parseRemoteRef(upstream);
      if (parsed) remote = parsed.remote;
    }
    if (!remote) remote = await resolveDefaultRemote();
    const result = await branchStore.smartPullCurrentBranch({
      branchName: branch.name,
      remote,
      rebase: false,
    });
    await refreshAfterGitOp();
    if (!result) return;
    if (result.conflicts && result.conflicts.length > 0) {
      openConflictDialog(result.conflicts, result.autoStash);
    } else if (!result.success) {
      actionError.value = friendlyErr(result.message);
    } else if (result.message !== "已是最新") {
      ui.showToast(`${branch.name} 已是最新状态`);
    }
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(branch.name, false);
    ui.stopProgress();
  }
}

async function pushForLocalBranch(branch: BranchInfo) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  const remote = await resolveDefaultRemote();
  pushDialogRemote.value = remote;
  pushDialogBranch.value = branch.name;
  showPushDialog.value = true;
}

async function updateBranchWithoutCheckout(branch: BranchInfo) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(branch.name, true);
  ui.startProgress(`更新 ${branch.name}…`);
  try {
    if (branch.isHead) {
      const remote = await resolveDefaultRemote();
      const result = await branchStore.smartPullCurrentBranch({
        branchName: branch.name,
        remote,
        rebase: false,
      });
      if (!result) {
        return;
      }
      if (result.conflicts && result.conflicts.length > 0) {
        openConflictDialog(result.conflicts, result.autoStash);
      } else if (!result.success) {
          actionError.value = friendlyErr(result.message);
      } else if (result.message !== "已是最新") {
        ui.showToast(`${branch.name} 已是最新状态`);
      }
    } else {
      let remote: string | undefined;
      if (branch.upstream) {
        const parsed = parseRemoteRef(branch.upstream);
        if (parsed) remote = parsed.remote;
      }
      if (!remote) remote = await resolveDefaultRemote();
      await commands.fetchBranch(path, remote, branch.name);
      ui.showToast(`${branch.name} 更新完成`);
    }
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(branch.name, false);
    ui.stopProgress();
  }
}

const filteredLocal = computed(() => {
  const q = searchQuery.value.toLowerCase();
  let branches = branchStore.localBranches;
  if (q) branches = branches.filter((b) => b.name.toLowerCase().includes(q));
  const favs = branchStore.favorites;
  return [...branches].sort((a, b) => {
    const aFav = favs.includes(a.name) ? 0 : 1;
    const bFav = favs.includes(b.name) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    if (a.isHead) return -1;
    if (b.isHead) return 1;
    return a.name.localeCompare(b.name);
  });
});

const filteredRemote = computed(() => {
  const q = searchQuery.value.toLowerCase();
  if (q) return branchStore.remoteBranches.filter((b) => b.name.toLowerCase().includes(q));
  return branchStore.remoteBranches;
});

const filteredTags = computed(() => {
  const q = searchQuery.value.toLowerCase();
  if (q) return branchStore.tags.filter((t) => t.toLowerCase().includes(q));
  return branchStore.tags;
});

// ---- Branch tree types ----
interface BranchLeafNode {
  type: "branch";
  branch: BranchInfo;
  kind: "local" | "remote";
  displayName: string;
}
interface BranchFolderNode {
  type: "folder";
  name: string;
  fullKey: string;
  children: TreeNode[];
}
type TreeNode = BranchLeafNode | BranchFolderNode;

interface FlatBranchNode {
  type: "branch";
  depth: number;
  key: string;
  branch: BranchInfo;
  kind: "local" | "remote";
  displayName: string;
}
interface FlatFolderNode {
  type: "folder";
  depth: number;
  key: string;
  folderName: string;
  folderKey: string;
  isExpanded: boolean;
}
type FlatNode = FlatBranchNode | FlatFolderNode;

// ---- Tree state & helpers ----
const collapsedFolders = ref<string[]>([]);

function isFolderExpanded(key: string): boolean {
  return !collapsedFolders.value.includes(key);
}

function toggleFolder(key: string) {
  const idx = collapsedFolders.value.indexOf(key);
  if (idx >= 0) {
    collapsedFolders.value.splice(idx, 1);
  } else {
    collapsedFolders.value.push(key);
  }
}

function insertIntoTree(
  nodes: TreeNode[],
  displayParts: string[],
  branch: BranchInfo,
  kind: "local" | "remote",
  keyPrefix: string
) {
  if (displayParts.length === 1) {
    nodes.push({ type: "branch", branch, kind, displayName: displayParts[0]! });
    return;
  }
  const head = displayParts[0]!;
  const rest = displayParts.slice(1);
  const folderKey = keyPrefix ? `${keyPrefix}/${head}` : head;
  let folder = nodes.find((n): n is BranchFolderNode => n.type === "folder" && n.name === head);
  if (!folder) {
    folder = { type: "folder", name: head, fullKey: folderKey, children: [] };
    nodes.push(folder);
  }
  insertIntoTree(folder.children, rest, branch, kind, folderKey);
}

function flattenTreeNodes(nodes: TreeNode[], depth: number, keyPrefix: string): FlatNode[] {
  const result: FlatNode[] = [];
  for (const node of nodes) {
    if (node.type === "branch") {
      result.push({
        type: "branch",
        depth,
        key: `${keyPrefix}:b:${node.branch.name}`,
        branch: node.branch,
        kind: node.kind,
        displayName: node.displayName,
      } as FlatBranchNode);
    } else {
      const expanded = isFolderExpanded(node.fullKey);
      result.push({
        type: "folder",
        depth,
        key: `${keyPrefix}:f:${node.fullKey}`,
        folderName: node.name,
        folderKey: node.fullKey,
        isExpanded: expanded,
      } as FlatFolderNode);
      if (expanded) {
        result.push(...flattenTreeNodes(node.children, depth + 1, keyPrefix));
      }
    }
  }
  return result;
}

// ---- Flat tree computeds ----
const localFlatNodes = computed<FlatNode[]>(() => {
  const roots: TreeNode[] = [];
  for (const branch of filteredLocal.value) {
    insertIntoTree(roots, branch.name.split("/"), branch, "local", "local");
  }
  return flattenTreeNodes(roots, 0, "local");
});

const remoteFlatNodes = computed<FlatNode[]>(() => {
  const remoteGroups = new Map<string, BranchInfo[]>();
  const remoteOrder: string[] = [];
  for (const branch of filteredRemote.value) {
    const slashIdx = branch.name.indexOf("/");
    const remoteName = slashIdx > 0 ? branch.name.slice(0, slashIdx) : "__bare__";
    if (!remoteGroups.has(remoteName)) {
      remoteGroups.set(remoteName, []);
      remoteOrder.push(remoteName);
    }
    remoteGroups.get(remoteName)!.push(branch);
  }
  const result: FlatNode[] = [];
  for (const remoteName of remoteOrder) {
    const branches = remoteGroups.get(remoteName)!;
    if (remoteName === "__bare__") {
      for (const branch of branches) {
        result.push({
          type: "branch",
          depth: 0,
          key: `remote:b:${branch.name}`,
          branch,
          kind: "remote",
          displayName: branch.name,
        } as FlatBranchNode);
      }
      continue;
    }
    const folderKey = `remote_root/${remoteName}`;
    result.push({
      type: "folder",
      depth: 0,
      key: `remote:f:${remoteName}`,
      folderName: remoteName,
      folderKey,
      isExpanded: isFolderExpanded(folderKey),
    } as FlatFolderNode);
    if (isFolderExpanded(folderKey)) {
      const subRoots: TreeNode[] = [];
      for (const branch of branches) {
        const withoutRemote = branch.name.startsWith(`${remoteName}/`)
          ? branch.name.slice(remoteName.length + 1)
          : branch.name;
        insertIntoTree(
          subRoots,
          withoutRemote.split("/"),
          branch,
          "remote",
          `remote/${remoteName}`
        );
      }
      result.push(...flattenTreeNodes(subRoots, 1, `remote/${remoteName}`));
    }
  }
  return result;
});

function isSidebarSelected(kind: "local" | "remote", name: string) {
  const s = selectedSidebarBranch.value;
  return s?.kind === kind && s.name === name;
}

function selectLocalBranch(branch: BranchInfo) {
  selectedSidebarBranch.value = { kind: "local", name: branch.name };
  filterByBranch(branch.name);
}

function selectRemoteBranch(branch: BranchInfo) {
  selectedSidebarBranch.value = { kind: "remote", name: branch.name };
  filterByBranch(branch.name);
}

function filterByBranch(name: string | null) {
  if (name === null) {
    selectedSidebarBranch.value = null;
  }
  logStore.filter.branch = name;
  logStore.loadCommits(true);
}

function showContextMenu(event: MouseEvent, branch: BranchInfo, kind: "local" | "remote") {
  // Keep right-click behavior aligned with selection-sensitive actions.
  selectedSidebarBranch.value = { kind, name: branch.name };
  contextBranch.value = branch;
  contextBranchKind.value = kind;
  contextMenuRef.value?.show(event);
}

const contextMenuItems = computed<MenuItem[]>(() => {
  if (!contextBranch.value) return [];
  const branch = contextBranch.value;
  const kind = contextBranchKind.value;
  const head = headBranch.value;

  if (kind === "remote") {
    return [
      { label: "签出（新建本地分支）", action: () => checkoutRemoteAsLocal(branch.name) },
      { separator: true, label: "" },
      { label: `抓取（此远端）`, action: () => fetchForRemoteBranch(branch.name) },
      { separator: true, label: "" },
      {
        label: branchStore.favorites.includes(branch.name) ? "取消收藏" : "收藏",
        action: () => branchStore.toggleFavorite(branch.name),
      },
      { separator: true, label: "" },
      { label: "删除远程分支…", action: () => handleDeleteRemoteBranch(branch) },
    ];
  }

  // Local branch context menu matching image 3
  const headName = head?.name ?? "";
  const isHead = branch.isHead;

  const items: MenuItem[] = [];

  if (!isHead) {
    items.push({ label: "签出", action: () => handleCheckout(branch.name) });
    items.push({
      label: "强制签出（丢弃本地修改）",
      action: () => forceCheckout(branch.name),
    });
  }
  items.push({
    label: `从 '${branch.name}' 新建分支...`,
    action: () => handleNewBranchFrom(branch.name),
  });
  if (!isHead) {
    items.push({
      label: `签出并变基到 '${headName}'`,
      action: () => handleCheckoutAndRebase(branch.name, headName),
    });
    items.push({
      label: "签出并更新",
      action: () => pullForLocalBranch(branch),
    });
  }
  items.push({ separator: true, label: "" });

  if (!isHead && headName) {
    items.push({
      label: `与 '${headName}' 比较`,
      action: () => handleCompareBranches(branch.name, headName),
    });
  }
  items.push({
    label: "显示与工作树的差异",
    action: () => handleShowDiffWithWorkTree(branch.name),
  });
  items.push({ separator: true, label: "" });

  if (!isHead && headName) {
    items.push({
      label: `将 '${headName}' 变基到 '${branch.name}'`,
      action: () => handleRebaseHeadOnto(branch.name),
    });
    items.push({
      label: `将 '${branch.name}' 合并到 '${headName}' 中`,
      action: () => handleMergeBranchIntoHead(branch.name),
    });
    items.push({ separator: true, label: "" });
  }

  items.push({
    label: "更新",
    action: () => updateBranchWithoutCheckout(branch),
  });
  if (isHead) {
    items.push({
      label: "强制拉取（覆盖本地改动）",
      action: () => requestForcePull(branch),
    });
    items.push({
      label: "重置到远端（丢弃本地提交和改动）",
      action: () => requestResetToRemote(branch),
    });
  }
  items.push({
    label: "推送...",
    action: () => pushForLocalBranch(branch),
  });
  items.push({
    label: `跟踪分支 'origin/${branch.name}'`,
    action: () => handleSetTracking(branch.name),
    children: [
      {
        label: `origin/${branch.name}`,
        action: () => handleSetTracking(branch.name),
      },
    ],
  });
  items.push({ separator: true, label: "" });

  items.push({
    label: "重命名...",
    shortcut: "Alt+Shift+R",
    action: () => handleRenameBranch(branch.name),
  });
  items.push({
    label: "删除",
    action: () => handleDeleteBranch(branch),
    disabled: isHead,
  });

  return items;
});

const repoReady = computed(() => !!repoStore.activeRepo);
const logTabLabel = computed(() => `日志: ${repoStore.activeRepo?.name ?? "-"}`);

function handleNewBranchFrom(fromBranch: string) {
  newBranchFromRef.value = fromBranch;
  showNewBranchDialog.value = true;
}

async function onNewBranchConfirmed(name: string, fromBranch: string) {
  showNewBranchDialog.value = false;
  actionLoading.value = true;
  setBranchBusy(name, true);
  try {
    await branchStore.createBranch(name, fromBranch);
    await branchStore.checkoutBranch(name);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(name, false);
  }
}

/** 签出分支：包一层 try/catch + 错误提示 + 分支 spinner，避免裸调 store 失败时无反馈。 */
async function handleCheckout(name: string) {
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(name, true);
  try {
    await branchStore.checkoutBranch(name);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(name, false);
  }
}

/** 强制签出：丢弃当前分支所有未提交修改后切换。破坏性操作，先二次确认。 */
async function forceCheckout(name: string) {
  if (!window.confirm(`强制签出 '${name}' 会永久丢弃当前分支所有未提交修改，确定继续？`)) {
    return;
  }
  clearActionError();
  actionLoading.value = true;
  ui.startProgress(`强制签出 ${name}…`);
  setBranchBusy(name, true);
  try {
    await branchStore.forceCheckout(name);
    await refreshAfterGitOp();
    ui.showToast(`已强制签出 '${name}'，本地未提交修改已丢弃`);
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(name, false);
    ui.stopProgress();
  }
}

async function handleCheckoutAndRebase(branchToCheckout: string, rebaseOnto: string) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(branchToCheckout, true);
  try {
    await branchStore.checkoutBranch(branchToCheckout);
    await commands.rebaseBranch(path, rebaseOnto);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(branchToCheckout, false);
  }
}

async function handleRebaseHeadOnto(targetBranch: string) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(targetBranch, true);
  try {
    await commands.rebaseBranch(path, targetBranch);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(targetBranch, false);
  }
}

async function handleMergeBranchIntoHead(sourceBranch: string) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(sourceBranch, true);
  try {
    const result = await commands.mergeBranch(path, sourceBranch);
    await refreshAfterGitOp();
    if (result.conflicts && result.conflicts.length > 0) {
      openConflictDialog(result.conflicts, result.autoStash);
    }
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(sourceBranch, false);
  }
}

function handleCompareBranches(branch: string, _headBranchName: string) {
  logStore.filter.branch = branch;
  logStore.loadCommits(true);
}

function handleShowDiffWithWorkTree(branch: string) {
  logStore.filter.branch = branch;
  logStore.loadCommits(true);
}

async function handleSetTracking(branchName: string) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(branchName, true);
  try {
    const remote = await resolveDefaultRemote();
    await commands.push(path, remote, branchName);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(branchName, false);
  }
}

function handleRenameBranch(oldName: string) {
  renameOldName.value = oldName;
  renameNewName.value = oldName;
  showRenameDialog.value = true;
}

async function onRenameConfirmed() {
  const oldName = renameOldName.value;
  const newName = renameNewName.value.trim();
  showRenameDialog.value = false;
  if (!newName || newName === oldName) return;
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(oldName, true);
  try {
    await commands.renameBranch(path, oldName, newName);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(oldName, false);
  }
}

/** git branch -d 删除未合并分支会报 "not fully merged"，据此提示是否强制删除。 */
function isNotFullyMergedError(e: unknown): boolean {
  const msg =
    e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e ?? "");
  return /not fully merged/i.test(msg);
}

/**
 * 删除本地分支：二次确认 → git branch -d；未合并失败时再问是否强制 git branch -D。
 * 旧实现直接裸调 branchStore.deleteBranch，无 await/无 catch/无刷新，未合并分支删除
 * 静默失败被用户感知为"删除功能失效"。
 */
async function handleDeleteBranch(branch: BranchInfo) {
  if (branch.isHead) return;
  if (!window.confirm(`确认删除本地分支 '${branch.name}'？`)) return;
  clearActionError();
  actionLoading.value = true;
  ui.startProgress(`删除分支 ${branch.name}…`);
  setBranchBusy(branch.name, true);
  try {
    await branchStore.deleteBranch(branch.name);
    await refreshAfterGitOp();
    ui.showToast(`已删除分支 '${branch.name}'`);
  } catch (e: unknown) {
    if (isNotFullyMergedError(e)) {
      if (
        window.confirm(
          `分支 '${branch.name}' 尚未完全合并，删除将丢失其独有提交。\n确定强制删除（git branch -D）吗？`
        )
      ) {
        try {
          await branchStore.deleteBranch(branch.name, true);
          await refreshAfterGitOp();
          ui.showToast(`已强制删除分支 '${branch.name}'`);
        } catch (e2: unknown) {
          actionError.value = friendlyErr(e2);
        }
      }
    } else {
      actionError.value = friendlyErr(e);
    }
  } finally {
    actionLoading.value = false;
    setBranchBusy(branch.name, false);
    ui.stopProgress();
  }
}

/** 删除远程分支：git push <remote> --delete <branch>。联网 + 破坏性，先二次确认。 */
async function handleDeleteRemoteBranch(branch: BranchInfo) {
  const parsed = parseRemoteRef(branch.name);
  if (!parsed) {
    actionError.value = `无法解析远程分支：${branch.name}`;
    return;
  }
  if (
    !window.confirm(
      `确认删除远程分支 '${branch.name}'？\n该操作会向 '${parsed.remote}' 推送 --delete，远端将立即丢失此分支，不可撤销。`
    )
  )
    return;
  clearActionError();
  actionLoading.value = true;
  setBranchBusy(branch.name, true);
  ui.startProgress(`删除远程分支 ${branch.name}…`);
  try {
    await branchStore.deleteRemoteBranch(parsed.remote, parsed.branch);
    await refreshAfterGitOp();
    ui.showToast(`已删除远程分支 '${branch.name}'`);
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
    setBranchBusy(branch.name, false);
    ui.stopProgress();
  }
}

// ---------------------------------------------------------------------------
// Tag actions
// ---------------------------------------------------------------------------

function openCreateTagDialog(): void {
  clearActionError();
  showCreateTagDialog.value = true;
}

async function onCreateTagConfirmed(payload: {
  name: string;
  message: string;
  annotated: boolean;
  pushAfter: boolean;
}): Promise<void> {
  showCreateTagDialog.value = false;
  clearActionError();
  actionLoading.value = true;
  try {
    await branchStore.createTag(
      payload.name,
      undefined,
      payload.annotated ? payload.message : ""
    );
    if (payload.pushAfter) {
      const remote = await resolveDefaultRemote();
      await branchStore.pushTag(remote, payload.name);
    }
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
  }
}

function showTagContextMenu(event: MouseEvent, tag: string): void {
  contextTagName.value = tag;
  tagContextMenuRef.value?.show(event);
}

const tagContextMenuItems = computed<MenuItem[]>(() => {
  const tag = contextTagName.value;
  if (!tag) return [];
  return [
    {
      label: `签出 '${tag}'（进入分离 HEAD）`,
      action: () => handleCheckoutTag(tag),
    },
    {
      label: `推送 '${tag}' 到默认远端`,
      action: () => handlePushTag(tag),
    },
    { separator: true, label: "" },
    {
      label: `删除本地标签 '${tag}'`,
      action: () => handleDeleteLocalTag(tag),
    },
    {
      label: `删除远端标签 '${tag}'…`,
      action: () => handleDeleteRemoteTag(tag),
    },
    { separator: true, label: "" },
    {
      label: "复制标签名",
      action: () => {
        void navigator.clipboard?.writeText(tag);
      },
    },
  ];
});

async function handleCheckoutTag(tag: string): Promise<void> {
  if (
    !window.confirm(
      `签出标签 '${tag}' 会进入分离 HEAD 状态。\n继续吗？\n（之后可签出某个分支返回正常分支）`
    )
  )
    return;
  clearActionError();
  actionLoading.value = true;
  try {
    await branchStore.checkoutTag(tag);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
  }
}

async function handlePushTag(tag: string): Promise<void> {
  clearActionError();
  actionLoading.value = true;
  try {
    const remote = await resolveDefaultRemote();
    await branchStore.pushTag(remote, tag);
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
  }
}

async function handleDeleteLocalTag(tag: string): Promise<void> {
  if (!window.confirm(`确认删除本地标签 '${tag}'？此操作不可撤销。`)) return;
  clearActionError();
  actionLoading.value = true;
  try {
    await branchStore.deleteTag(tag);
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
  }
}

async function handleDeleteRemoteTag(tag: string): Promise<void> {
  if (
    !window.confirm(
      `确认从默认远端删除标签 '${tag}'？\n该操作会推送 ':refs/tags/${tag}'，**远端将立即丢失此标签**，不可撤销。`
    )
  )
    return;
  clearActionError();
  actionLoading.value = true;
  try {
    const remote = await resolveDefaultRemote();
    await branchStore.deleteRemoteTag(remote, tag);
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
  }
}
</script>

<template>
  <div class="branches-pane">
    <!-- Tab 切换按钮 -->
    <div class="tab-buttons">
      <button
        class="tab-btn"
        :class="{ active: props.activeTab === 'commit' }"
        @click="emit('update:activeTab', 'commit')"
      >
        本地更改
      </button>
      <button
        class="tab-btn"
        :class="{ active: props.activeTab === 'stash' }"
        @click="emit('update:activeTab', 'stash')"
      >
        搁置
      </button>
      <button
        class="tab-btn"
        :class="{ active: props.activeTab === 'log' }"
        @click="emit('update:activeTab', 'log')"
      >
        {{ logTabLabel }}
      </button>
      <button
        class="tab-btn"
        :class="{ active: props.activeTab === 'report' }"
        @click="emit('update:activeTab', 'report')"
        title="按时间范围聚合提交，生成日报/周报，支持 AI 润色"
      >
        日报
      </button>
    </div>

    <div class="git-actions" v-if="props.activeTab === 'log'">
      <div class="git-actions-row">
        <ToolbarButton
          title="抓取：选中远程分支时仅抓取该远端，否则抓取全部远端（fetch --all）"
          :disabled="!repoReady || actionLoading"
          @click="handleFetch"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          抓取
        </ToolbarButton>
        <ToolbarButton
          title="拉取：更新当前检出分支（HEAD）"
          :disabled="!repoReady || actionLoading"
          @click="handlePull"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="7 13 12 18 17 13" />
            <line x1="12" y1="6" x2="12" y2="18" />
          </svg>
          拉取
        </ToolbarButton>
        <ToolbarButton
          title="推送：选中本地分支时推送该分支，否则推送当前分支"
          :disabled="!repoReady || actionLoading"
          @click="handlePush"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="17 11 12 6 7 11" />
            <line x1="12" y1="18" x2="12" y2="6" />
          </svg>
          推送
        </ToolbarButton>
        <ToolbarButton
          title="迷路：查看 Git 引用日志，恢复误重置 / 误变基丢失的提交"
          :disabled="!repoReady"
          @click="showReflogDialog = true"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          迷路
        </ToolbarButton>
      </div>
      <div v-if="actionError" class="action-error">{{ actionError }}</div>
    </div>

    <div class="pane-header" v-if="props.activeTab === 'log'">
      <SearchBar v-model="searchQuery" placeholder="搜索分支..." />
    </div>

    <div class="branches-list" v-if="props.activeTab === 'log'">
      <!-- Filter indicator -->
      <div v-if="logStore.filter.branch" class="filter-indicator" @click="filterByBranch(null)">
        <span>筛选: {{ logStore.filter.branch }}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>

      <!-- Local branches -->
      <div class="branch-group">
        <div class="group-header">
          <span>本地</span>
          <span class="count">{{ filteredLocal.length }}</span>
        </div>
        <template v-for="node in localFlatNodes" :key="node.key">
          <!-- Folder node -->
          <div
            v-if="node.type === 'folder'"
            class="branch-item folder-node"
            :style="{ paddingLeft: `${8 + node.depth * 12}px` }"
            @click="toggleFolder(node.folderKey)"
          >
            <svg
              class="chevron"
              :class="{ 'chevron-open': node.isExpanded }"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              />
            </svg>
            <span class="branch-name">{{ node.folderName }}</span>
          </div>
          <!-- Branch node -->
          <div
            v-else
            class="branch-item"
            :class="{
              head: node.branch.isHead,
              selected: isSidebarSelected('local', node.branch.name),
            }"
            :style="{ paddingLeft: `${8 + node.depth * 12}px` }"
            @click="selectLocalBranch(node.branch)"
            @contextmenu.prevent="showContextMenu($event, node.branch, 'local')"
          >
            <svg
              v-if="isBranchBusy(node.branch.name)"
              class="branch-spinner"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-branch-head)"
              stroke-width="2.5"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <svg
              v-else-if="node.branch.isHead"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="var(--color-branch-head)"
              stroke="none"
            >
              <polygon
                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              />
            </svg>
            <svg
              v-else
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-branch-local)"
              stroke-width="2"
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span class="branch-name" :class="{ current: node.branch.isHead }">{{
              node.displayName
            }}</span>
            <span v-if="branchStore.favorites.includes(node.branch.name)" class="fav-star">★</span>
            <span v-if="node.branch.aheadBehind" class="ahead-behind">
              <button
                v-if="node.branch.aheadBehind[0] > 0"
                class="push-badge"
                title="点击推送此分支"
                @click.stop="pushForLocalBranch(node.branch)"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <polyline points="17 11 12 6 7 11" />
                  <line x1="12" y1="18" x2="12" y2="6" />
                </svg>
                {{ node.branch.aheadBehind[0] }}
              </button>
              <template v-if="node.branch.aheadBehind[1] > 0"
                >↓{{ node.branch.aheadBehind[1] }}</template
              >
            </span>
          </div>
        </template>
      </div>

      <!-- Remote branches -->
      <div class="branch-group">
        <div class="group-header">
          <span class="group-toggle" @click="showRemote = !showRemote">
            <svg
              class="chevron"
              :class="{ 'chevron-open': showRemote }"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span>远程</span>
            <span class="count">{{ filteredRemote.length }}</span>
          </span>
        </div>
        <template v-if="showRemote">
        <template v-for="node in remoteFlatNodes" :key="node.key">
          <!-- Folder (remote name or path prefix) -->
          <div
            v-if="node.type === 'folder'"
            class="branch-item folder-node"
            :style="{ paddingLeft: `${8 + node.depth * 12}px` }"
            @click="toggleFolder(node.folderKey)"
          >
            <svg
              class="chevron"
              :class="{ 'chevron-open': node.isExpanded }"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <!-- Remote root: globe icon; sub-folder: folder icon -->
            <svg
              v-if="node.depth === 0"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-branch-remote)"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path
                d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
              />
            </svg>
            <svg
              v-else
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              />
            </svg>
            <span class="branch-name folder-name">{{ node.folderName }}</span>
          </div>
          <!-- Branch leaf -->
          <div
            v-else
            class="branch-item"
            :class="{ selected: isSidebarSelected('remote', node.branch.name) }"
            :style="{ paddingLeft: `${8 + node.depth * 12}px` }"
            @click="selectRemoteBranch(node.branch)"
            @contextmenu.prevent="showContextMenu($event, node.branch, 'remote')"
          >
            <svg
              v-if="isBranchBusy(node.branch.name)"
              class="branch-spinner"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-branch-remote)"
              stroke-width="2.5"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <svg
              v-else-if="node.branch.isHead"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="var(--color-branch-head)"
              stroke="none"
            >
              <polygon
                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              />
            </svg>
            <svg
              v-else
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-branch-remote)"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path
                d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
              />
            </svg>
            <span class="branch-name">{{ node.displayName }}</span>
          </div>
        </template>
        </template>
      </div>

      <!-- Tags -->
      <div class="branch-group">
        <div class="group-header tags-header">
          <span class="group-toggle" @click="showTags = !showTags">
            <svg
              class="chevron"
              :class="{ 'chevron-open': showTags }"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span>标签</span>
            <span class="count">{{ filteredTags.length }}</span>
          </span>
          <button
            class="tag-create-btn"
            title="在 HEAD 创建新标签…"
            @click.stop="openCreateTagDialog"
          >
            +
          </button>
        </div>
        <template v-if="showTags">
          <div
            v-for="tag in filteredTags"
            :key="tag"
            class="branch-item"
            @contextmenu.prevent="showTagContextMenu($event, tag)"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-branch-tag)"
              stroke-width="2"
            >
              <path
                d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
              />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            <span class="branch-name">{{ tag }}</span>
          </div>
          <div v-if="filteredTags.length === 0" class="tag-empty-hint">
            暂无标签 · 点 + 创建
          </div>
        </template>
      </div>

      <!-- Submodules -->
      <div v-if="branchStore.submodules.length > 0 || branchStore.submodulesLoading" class="branch-group">
        <div class="group-header submodules-header">
          <span class="group-toggle" @click="showSubmodules = !showSubmodules">
            <svg
              class="chevron"
              :class="{ 'chevron-open': showSubmodules }"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span>子模块</span>
            <span class="count">{{ branchStore.submodules.length }}</span>
          </span>
          <button
            class="tag-create-btn"
            title="更新全部子模块（git submodule update --init --recursive）"
            :disabled="actionLoading"
            @click.stop="handleUpdateSubmodule(undefined)"
          >
            ↻
          </button>
        </div>
        <template v-if="showSubmodules">
          <div
            v-for="sm in branchStore.submodules"
            :key="sm.path"
            class="branch-item submodule-item"
            :title="sm.url || sm.path"
            @contextmenu.prevent="showSubmoduleContextMenu($event, sm)"
          >
            <span
              class="submodule-state-dot"
              :style="{ background: submoduleStateIcon(sm.state).color }"
              :title="submoduleStateIcon(sm.state).title"
            />
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span class="branch-name submodule-name">{{ sm.path }}</span>
            <span v-if="sm.described" class="submodule-described">{{ sm.described }}</span>
          </div>
          <div
            v-if="branchStore.submodules.length === 0 && branchStore.submodulesLoading"
            class="tag-empty-hint"
          >
            扫描中...
          </div>
        </template>
      </div>
    </div>

    <ContextMenu ref="contextMenuRef" :items="contextMenuItems" />
    <ContextMenu ref="tagContextMenuRef" :items="tagContextMenuItems" />
    <ContextMenu ref="submoduleContextMenuRef" :items="submoduleContextMenuItems" />

    <CreateTagDialog
      :visible="showCreateTagDialog"
      target-label="HEAD（当前所在提交）"
      @confirm="onCreateTagConfirmed"
      @cancel="showCreateTagDialog = false"
    />

    <ReflogDialog
      :visible="showReflogDialog"
      :repo-path="repoStore.activeRepo?.path ?? ''"
      @close="showReflogDialog = false"
      @changed="refreshAfterGitOp"
    />

    <!-- 从指定分支新建分支弹窗 -->
    <BranchPopup
      :visible="showNewBranchDialog"
      :from-branch="newBranchFromRef"
      @confirm="onNewBranchConfirmed"
      @close="showNewBranchDialog = false"
    />

    <!-- 重命名分支弹窗 -->
    <Teleport to="body">
      <div v-if="showRenameDialog" class="rename-overlay" @click.self="showRenameDialog = false">
        <div class="rename-dialog">
          <h4>重命名分支</h4>
          <div class="rename-field">
            <label>当前名称</label>
            <input :value="renameOldName" disabled class="rename-input disabled" />
          </div>
          <div class="rename-field">
            <label>新名称</label>
            <input
              v-model="renameNewName"
              class="rename-input"
              @keydown.enter="onRenameConfirmed"
              autofocus
            />
          </div>
          <div class="rename-actions">
            <button class="rename-btn" @click="showRenameDialog = false">取消</button>
            <button
              class="rename-btn primary"
              :disabled="!renameNewName.trim() || renameNewName.trim() === renameOldName"
              @click="onRenameConfirmed"
            >
              确认
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 推送确认弹框 -->
    <PushDialog
      :visible="showPushDialog"
      :repo-path="repoStore.activeRepo?.path ?? ''"
      :repo-name="repoStore.activeRepo?.name"
      :remote="pushDialogRemote"
      :branch="pushDialogBranch"
      @confirm="onPushConfirmed"
      @close="onPushCancelled"
      @busy="onPushBusy"
    />

    <!-- 强制拉取二次确认 -->
    <ConfirmDialog
      :visible="showForceConfirm"
      title="强制拉取"
      :text="`将丢弃 '${forceConfirmBranch}' 上所有未提交的本地改动（reset --hard + clean -fd）后再拉取远程，此操作不可恢复。确定继续？`"
      confirm-label="强制拉取"
      :danger="true"
      @confirm="handleForcePullConfirm"
      @cancel="handleForcePullCancel"
    />

    <!-- 重置到远端二次确认 -->
    <ConfirmDialog
      :visible="showResetRemoteConfirm"
      title="重置到远端"
      :text="`将把本地分支 '${resetRemoteConfirmBranch?.name ?? ''}' 强制重置到 '${resetRemoteConfirmBranch?.upstream ?? '远端同名分支'}'。这会丢弃未推送提交、暂存区、未提交修改和未跟踪文件，且不会打开冲突解决窗口。确定继续？`"
      confirm-label="重置到远端"
      :danger="true"
      @confirm="handleResetToRemoteConfirm"
      @cancel="handleResetToRemoteCancel"
    />

    <!-- 冲突解决弹窗 -->
    <Teleport to="body">
      <div v-if="showConflictDialog" class="conflict-modal-overlay">
        <div class="conflict-modal-panel">
          <div class="conflict-modal-header">
            <span>解决合并冲突</span>
            <button class="conflict-close-btn" @click="showConflictDialog = false">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="conflict-modal-body">
            <ThreeWayMerge
              :file-path="conflictDialogFirstFile"
              :conflict-files="conflictDialogFiles"
              @resolved="onConflictResolved"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.branches-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tab-buttons {
  display: flex;
  gap: 1px;
  padding: 5px 6px 4px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 3px 6px;
  background: transparent;
  color: var(--color-foreground-muted);
  border-radius: 3px;
  font-size: 11px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.tab-btn.active {
  background: var(--color-surface-active);
  color: var(--color-foreground-bright);
}

.git-actions {
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.git-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.git-actions-row :deep(.toolbar-btn) {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  padding: 4px 4px;
  justify-content: center;
}

.action-error {
  margin-top: 4px;
  font-size: 10px;
  color: var(--color-error, #e06c75);
  line-height: 1.3;
  word-break: break-word;
}

.pane-header {
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
}

.branches-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.filter-indicator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  margin: 2px 4px;
  background: var(--color-primary);
  color: white;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
}

.branch-group {
  margin-bottom: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-foreground-muted);
  letter-spacing: 0.5px;
  cursor: pointer;
}

.count {
  font-weight: 400;
}

.tags-header {
  cursor: default;
}

.group-toggle {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.tag-create-btn {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--color-foreground-muted);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.tag-create-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
  border-color: var(--color-foreground-muted);
}

.tag-empty-hint {
  padding: 6px 10px;
  font-size: 11px;
  color: var(--color-foreground-muted);
  font-style: italic;
}

.submodule-item {
  position: relative;
}

.submodule-state-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.submodule-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.submodule-described {
  font-size: 10px;
  color: var(--color-foreground-muted);
  font-feature-settings: "tnum";
}

.branch-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 12px;
}

.branch-item:hover {
  background: var(--color-surface-hover);
}

.branch-item.head {
  font-weight: 500;
}

.branch-item.selected {
  background: var(--color-surface-active);
}

.branch-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-name.current {
  color: var(--color-branch-head);
}

.fav-star {
  color: var(--color-warning);
  font-size: 10px;
}

.ahead-behind {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: var(--color-foreground-muted);
  flex-shrink: 0;
}

.push-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--color-warning, #e5a550);
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
  line-height: 1;
}

.push-badge:hover {
  background: color-mix(in srgb, var(--color-warning, #e5a550) 15%, transparent);
  color: var(--color-warning, #e5a550);
  filter: brightness(1.2);
}

/* ---- Conflict dialog ---- */
.conflict-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.conflict-modal-panel {
  width: 90vw;
  height: 85vh;
  min-width: 600px;
  min-height: 400px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 60px);
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  resize: both;
}

.conflict-modal-header {
  position: relative;
  display: flex;
  align-items: center;
  padding: 8px 14px;
  padding-right: 44px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}

.conflict-modal-header > span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conflict-modal-header .conflict-close-btn {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  width: 28px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
  padding: 0;
  border-radius: 3px;
  cursor: pointer;
}

.conflict-modal-header .conflict-close-btn:hover {
  background: #c04040;
  border-color: #c04040;
  color: #fff;
}

.conflict-close-btn {
  display: flex;
  align-items: center;
  background: none;
  color: var(--color-foreground-muted);
  padding: 4px;
  border-radius: 3px;
}

.conflict-close-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.conflict-modal-body {
  flex: 1;
  overflow: hidden;
  display: flex;
}

/* ---- Tree / folder styles ---- */
.folder-node {
  color: var(--color-foreground);
  user-select: none;
}

.folder-name {
  color: var(--color-foreground);
}

.chevron {
  flex-shrink: 0;
  transition: transform 0.15s ease;
  transform: rotate(0deg);
  color: var(--color-foreground-muted);
}

.chevron-open {
  transform: rotate(90deg);
}

.branch-spinner {
  flex-shrink: 0;
  transform-origin: center;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* ---- Rename dialog ---- */
.rename-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.rename-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 20px;
  min-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.rename-dialog h4 {
  font-size: 14px;
  font-weight: 500;
}

.rename-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rename-field label {
  font-size: 12px;
  color: var(--color-foreground-muted);
}

.rename-input {
  padding: 6px 8px;
  border-radius: 3px;
}

.rename-input.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.rename-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.rename-btn {
  padding: 6px 16px;
  background: var(--color-surface-hover);
  color: var(--color-foreground);
  border-radius: 4px;
  font-size: 12px;
}

.rename-btn:hover {
  background: var(--color-surface-active);
}

.rename-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rename-btn.primary {
  background: var(--color-primary);
  color: white;
}

.rename-btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}
</style>
