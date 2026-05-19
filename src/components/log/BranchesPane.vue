<script setup lang="ts">
import { ref, computed, onMounted, defineAsyncComponent } from "vue";
import { useBranchStore } from "@/stores/branchStore";
import { useLogStore } from "@/stores/logStore";
import { useRepoStore } from "@/stores/repoStore";
import SearchBar from "@/components/common/SearchBar.vue";
import ToolbarButton from "@/components/common/ToolbarButton.vue";
import ContextMenu from "@/components/common/ContextMenu.vue";
import type { MenuItem } from "@/components/common/ContextMenu.vue";
import type { BranchInfo, Submodule } from "@/utils/commands";
import { commands } from "@/utils/commands";
import { translateGitError } from "@/utils/git-error";
import { SHORTCUTS, useKeyboardShortcuts } from "@/utils/keyboard";
const ThreeWayMerge = defineAsyncComponent(() => import("@/components/merge/ThreeWayMerge.vue"));
import PushDialog from "@/components/common/PushDialog.vue";
import CreateTagDialog from "@/components/common/CreateTagDialog.vue";
import ReflogDialog from "@/components/common/ReflogDialog.vue";

function friendlyErr(input: unknown): string {
  if (input == null) return translateGitError("");
  if (typeof input === "string") return translateGitError(input);
  if (input instanceof Error) return translateGitError(input.message);
  return translateGitError(String(input));
}

const branchStore = useBranchStore();
const logStore = useLogStore();
const repoStore = useRepoStore();

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

// 推送确认弹框
const showPushDialog = ref(false);
const pushDialogRemote = ref<string | undefined>(undefined);
const pushDialogBranch = ref<string | undefined>(undefined);

// 冲突解决弹窗
const showConflictDialog = ref(false);
const conflictDialogFiles = ref<string[]>([]);
const conflictDialogFirstFile = ref("");

// Tag 相关
const showCreateTagDialog = ref(false);
const tagContextMenuRef = ref<InstanceType<typeof ContextMenu>>();
const contextTagName = ref<string | null>(null);

// Reflog 弹窗
const showReflogDialog = ref(false);

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
    items.push({ label: `Init '${sm.path}'`, action: () => handleInitSubmodule(sm.path) });
  }
  items.push({
    label: `Update '${sm.path}'（git submodule update --init）`,
    action: () => handleUpdateSubmodule(sm.path),
  });
  items.push({
    label: `Sync '${sm.path}'（重读 .gitmodules URL）`,
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
      return { color: "#9aa0a6", title: "未初始化（右键 Init 拉取）" };
    case "modified":
      return { color: "#f0a500", title: "已修改（与主仓库记录的 commit 不一致）" };
    case "merge-conflict":
      return { color: "#e06c75", title: "合并冲突" };
    default:
      return { color: "#4ec9b0", title: "已初始化" };
  }
}

function openConflictDialog(files: string[]) {
  if (files.length === 0) return;
  conflictDialogFiles.value = files;
  conflictDialogFirstFile.value = files[0]!;
  showConflictDialog.value = true;
}

function onConflictResolved() {
  showConflictDialog.value = false;
  void refreshAfterGitOp();
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
  try {
    await branchStore.createBranch(parsed.branch, fullName);
    await branchStore.checkoutBranch(parsed.branch);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : String(e);
  } finally {
    actionLoading.value = false;
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
  await branchStore.loadBranches();
  await logStore.loadCommits(true);
  // submodules 不需要每次都跟 git op 同步刷新（拉取代价较大），仅在 mount 加载
}

function clearActionError() {
  actionError.value = "";
}

async function handleFetch() {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
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
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
  }
}

/** Pull：始终针对当前 HEAD 所在分支（与 IDEA 一致） */
async function handlePull() {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  try {
    const head = headBranch.value;
    let remote: string | undefined;
    if (head?.upstream) {
      const parsed = parseRemoteRef(head.upstream);
      if (parsed) remote = parsed.remote;
    }
    if (!remote) remote = await resolveDefaultRemote();
    const result = await commands.pull(path, remote, false);
    await refreshAfterGitOp();
    if (result.conflicts && result.conflicts.length > 0) {
      openConflictDialog(result.conflicts);
    } else if (!result.success) {
      actionError.value = friendlyErr(result.message);
    }
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
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

async function fetchForRemoteBranch(fullName: string) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  const parsed = parseRemoteRef(fullName);
  if (!parsed) return;
  clearActionError();
  actionLoading.value = true;
  try {
    await commands.fetch(path, parsed.remote);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
  }
}

async function pullForLocalBranch(branch: BranchInfo) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
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
    const result = await commands.pull(path, remote, false);
    await refreshAfterGitOp();
    if (result.conflicts && result.conflicts.length > 0) {
      openConflictDialog(result.conflicts);
    } else if (!result.success) {
      actionError.value = friendlyErr(result.message);
    }
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
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
  try {
    if (branch.isHead) {
      const remote = await resolveDefaultRemote();
      const result = await commands.pull(path, remote, false);
      if (result.conflicts && result.conflicts.length > 0) {
        openConflictDialog(result.conflicts);
      } else if (!result.success) {
        actionError.value = friendlyErr(result.message);
      }
    } else {
      let remote: string | undefined;
      if (branch.upstream) {
        const parsed = parseRemoteRef(branch.upstream);
        if (parsed) remote = parsed.remote;
      }
      if (!remote) remote = await resolveDefaultRemote();
      await commands.fetchBranch(path, remote, branch.name);
    }
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
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
      { label: `Fetch（此 remote）`, action: () => fetchForRemoteBranch(branch.name) },
      { separator: true, label: "" },
      {
        label: branchStore.favorites.includes(branch.name) ? "取消收藏" : "收藏",
        action: () => branchStore.toggleFavorite(branch.name),
      },
    ];
  }

  // Local branch context menu matching image 3
  const headName = head?.name ?? "";
  const isHead = branch.isHead;

  const items: MenuItem[] = [];

  if (!isHead) {
    items.push({ label: "签出", action: () => branchStore.checkoutBranch(branch.name) });
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
    label: "删除(D)",
    action: () => branchStore.deleteBranch(branch.name),
    disabled: isHead,
  });

  return items;
});

const repoReady = computed(() => !!repoStore.activeRepo);
const logTabLabel = computed(() => `日志: ${repoStore.activeRepo?.name ?? "-"}`);

function handleNewBranchFrom(fromBranch: string) {
  const name = window.prompt(`基于 '${fromBranch}' 新建分支，请输入分支名：`);
  if (!name) return;
  actionLoading.value = true;
  branchStore
    .createBranch(name, fromBranch)
    .then(() => branchStore.checkoutBranch(name))
    .then(() => refreshAfterGitOp())
    .catch((e: unknown) => {
      actionError.value = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      actionLoading.value = false;
    });
}

async function handleCheckoutAndRebase(branchToCheckout: string, rebaseOnto: string) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  try {
    await branchStore.checkoutBranch(branchToCheckout);
    await commands.rebaseBranch(path, rebaseOnto);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : String(e);
  } finally {
    actionLoading.value = false;
  }
}

async function handleRebaseHeadOnto(targetBranch: string) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  try {
    await commands.rebaseBranch(path, targetBranch);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : String(e);
  } finally {
    actionLoading.value = false;
  }
}

async function handleMergeBranchIntoHead(sourceBranch: string) {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  try {
    const result = await commands.mergeBranch(path, sourceBranch);
    await refreshAfterGitOp();
    if (result.conflicts && result.conflicts.length > 0) {
      openConflictDialog(result.conflicts);
    }
  } catch (e: unknown) {
    actionError.value = friendlyErr(e);
  } finally {
    actionLoading.value = false;
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
  try {
    const remote = await resolveDefaultRemote();
    await commands.push(path, remote, branchName);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : String(e);
  } finally {
    actionLoading.value = false;
  }
}

async function handleRenameBranch(oldName: string) {
  const newName = window.prompt(`重命名分支 '${oldName}'，请输入新名称：`);
  if (!newName || newName === oldName) return;
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  clearActionError();
  actionLoading.value = true;
  try {
    await commands.renameBranch(path, oldName, newName);
    await refreshAfterGitOp();
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : String(e);
  } finally {
    actionLoading.value = false;
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
      label: `Checkout '${tag}'（进入分离 HEAD）`,
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
      `Checkout 标签 '${tag}' 会进入分离 HEAD（detached HEAD）状态。\n继续吗？\n（之后可用 checkout <branch> 返回正常分支）`
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
          title="Fetch：远程分支选中时仅 fetch 该 remote，否则 fetch --all"
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
          Fetch
        </ToolbarButton>
        <ToolbarButton
          title="Pull：更新当前检出分支（HEAD）"
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
          Pull
        </ToolbarButton>
        <ToolbarButton
          title="Push：选中本地分支时推送该分支，否则推送当前分支"
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
          Push
        </ToolbarButton>
        <ToolbarButton
          title="迷路：查看 Git Reflog，恢复误 reset / rebase 丢失的提交"
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
          <span>LOCAL</span>
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
              v-if="node.branch.isHead"
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
      <div v-if="showRemote" class="branch-group">
        <div class="group-header" @click="showRemote = !showRemote">
          <span>REMOTE</span>
          <span class="count">{{ filteredRemote.length }}</span>
        </div>
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
              v-if="node.branch.isHead"
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
      </div>

      <!-- Tags -->
      <div v-if="showTags" class="branch-group">
        <div class="group-header tags-header">
          <span class="group-toggle" @click="showTags = !showTags">
            <span>TAGS</span>
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
      </div>

      <!-- Submodules -->
      <div v-if="branchStore.submodules.length > 0 || branchStore.submodulesLoading" class="branch-group">
        <div class="group-header submodules-header">
          <span class="group-toggle" @click="showSubmodules = !showSubmodules">
            <span>SUBMODULES</span>
            <span class="count">{{ branchStore.submodules.length }}</span>
          </span>
          <button
            class="tag-create-btn"
            title="Update 全部子模块（git submodule update --init --recursive）"
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
      target-label="HEAD（当前所在 commit）"
      @confirm="onCreateTagConfirmed"
      @cancel="showCreateTagDialog = false"
    />

    <ReflogDialog
      :visible="showReflogDialog"
      :repo-path="repoStore.activeRepo?.path ?? ''"
      @close="showReflogDialog = false"
      @changed="refreshAfterGitOp"
    />

    <!-- 推送确认弹框 -->
    <PushDialog
      :visible="showPushDialog"
      :repo-path="repoStore.activeRepo?.path ?? ''"
      :repo-name="repoStore.activeRepo?.name"
      :remote="pushDialogRemote"
      :branch="pushDialogBranch"
      @confirm="onPushConfirmed"
      @close="onPushCancelled"
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
  width: 100%;
  height: 100%;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
}

.conflict-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
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
</style>
