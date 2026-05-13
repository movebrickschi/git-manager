<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, defineAsyncComponent } from "vue";
import { Splitpanes, Pane } from "splitpanes";
import { useCommitStore } from "@/stores/commitStore";
import { useRepoStore } from "@/stores/repoStore";
import { useFilterStore } from "@/stores/filterStore";
import { commands } from "@/utils/commands";
import type { FileStatus, DiffResult } from "@/utils/commands";
import DiffViewer from "@/components/diff/DiffViewer.vue";
import ContextMenu from "@/components/common/ContextMenu.vue";
import type { MenuItem } from "@/components/common/ContextMenu.vue";
import PushDialog from "@/components/common/PushDialog.vue";
import { errMsg } from "@/utils/error";

const ThreeWayMerge = defineAsyncComponent(() => import("@/components/merge/ThreeWayMerge.vue"));

const commitStore = useCommitStore();
const repoStore = useRepoStore();
const filterStore = useFilterStore();

const selectedFile = ref<FileStatus | null>(null);
const selectedSection = ref<"staged" | "unstaged" | "untracked">("unstaged");
const diffResult = ref<DiffResult | null>(null);
const loading = ref(false);
const errorMessage = ref<string | null>(null);

type MergeOp = "merge" | "rebase" | "cherry-pick" | "revert";
const mergeState = ref<{ state: "none" | MergeOp; hasConflicts: boolean } | null>(null);
const mergeBusy = ref(false);

async function refreshMergeState() {
  if (!repoStore.activeRepo) {
    mergeState.value = null;
    return;
  }
  try {
    mergeState.value = await commands.getMergeState(repoStore.activeRepo.path);
  } catch (e: unknown) {
    console.error("getMergeState failed:", errMsg(e));
    mergeState.value = null;
  }
}

async function onContinueMerge() {
  if (!repoStore.activeRepo || !mergeState.value || mergeState.value.state === "none") return;
  mergeBusy.value = true;
  try {
    const result = await commands.continueOperation(
      repoStore.activeRepo.path,
      mergeState.value.state
    );
    if (!result.success) {
      showToast(`继续失败：${result.message}`);
    } else {
      showToast(`${mergeState.value.state} 已继续完成`);
    }
    await refreshMergeState();
    await commitStore.loadStatus();
  } catch (e: unknown) {
    showToast(`继续失败：${errMsg(e)}`);
  } finally {
    mergeBusy.value = false;
  }
}

async function onAbortMerge() {
  if (!repoStore.activeRepo || !mergeState.value || mergeState.value.state === "none") return;
  mergeBusy.value = true;
  try {
    await commands.abortOperation(repoStore.activeRepo.path, mergeState.value.state);
    showToast(`${mergeState.value.state} 已中止`);
    await refreshMergeState();
    await commitStore.loadStatus();
  } catch (e: unknown) {
    showToast(`中止失败：${errMsg(e)}`);
  } finally {
    mergeBusy.value = false;
  }
}
const contextMenuRef = ref<InstanceType<typeof ContextMenu>>();
const contextFile = ref<FileStatus | null>(null);
const contextSection = ref<"staged" | "unstaged" | "untracked">("unstaged");

// 差异弹窗
const showDiffDialog = ref(false);
const diffDialogResult = ref<DiffResult | null>(null);
const diffDialogFilePath = ref("");
const diffDialogLoading = ref(false);

// 推送确认弹框
const showPushDialog = ref(false);

async function handleCommitAndPush() {
  try {
    await commitStore.commit();
    showPushDialog.value = true;
  } catch (e: unknown) {
    console.error("Commit failed:", e);
  }
}

function onPushConfirmed() {
  showPushDialog.value = false;
}

function onPushCancelled() {
  showPushDialog.value = false;
}

// 快速提交弹窗
const showCommitDialog = ref(false);
const quickCommitMessage = ref("");
const quickCommitLoading = ref(false);

// 冲突解决弹窗
const showMergeDialog = ref(false);
const mergeFilePath = ref("");
const mergeConflictFiles = ref<string[]>([]);

// 二次确认弹窗
const showConfirmDialog = ref(false);
const confirmText = ref("");
const confirmTitle = ref("");
const pendingConfirmAction = ref<(() => Promise<void>) | null>(null);

// 通用操作反馈
const toastMessage = ref("");
const toastVisible = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string) {
  toastMessage.value = msg;
  toastVisible.value = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 2500);
}

interface SectionInfo {
  key: "staged" | "unstaged" | "untracked";
  title: string;
  files: FileStatus[];
  hiddenCount: number;
}

function repoPathOrEmpty(): string {
  return repoStore.activeRepo?.path ?? "";
}

function filterFiles(files: FileStatus[]): { visible: FileStatus[]; hidden: number } {
  const repoPath = repoPathOrEmpty();
  if (!repoPath || filterStore.showFiltered || !filterStore.hasRules(repoPath)) {
    return { visible: files, hidden: 0 };
  }
  const visible: FileStatus[] = [];
  let hidden = 0;
  for (const f of files) {
    if (filterStore.isFiltered(repoPath, f.path)) {
      hidden += 1;
    } else {
      visible.push(f);
    }
  }
  return { visible, hidden };
}

const sections = computed<SectionInfo[]>(() => {
  const raw = [
    { key: "staged" as const, title: "已暂存", files: commitStore.stagedFiles },
    { key: "unstaged" as const, title: "未暂存", files: commitStore.unstagedFiles },
    { key: "untracked" as const, title: "未跟踪", files: commitStore.untrackedFiles },
  ];
  return raw.map((s) => {
    const { visible, hidden } = filterFiles(s.files);
    return { key: s.key, title: s.title, files: visible, hiddenCount: hidden };
  });
});

const totalCount = computed(() => sections.value.reduce((sum, s) => sum + s.files.length, 0));

const totalHiddenCount = computed(() => sections.value.reduce((sum, s) => sum + s.hiddenCount, 0));

const hasFilterRules = computed(() => filterStore.hasRules(repoPathOrEmpty()));

// ---- 多选 ----
function makeKey(section: SectionInfo["key"], path: string) {
  return `${section}:${path}`;
}

const selectedKeys = ref<Set<string>>(new Set());
const lastClickedKey = ref<string | null>(null);
const flatFileKeys = computed<string[]>(() => {
  const keys: string[] = [];
  for (const s of sections.value) {
    for (const f of s.files) keys.push(makeKey(s.key, f.path));
  }
  return keys;
});

const selectedFilesBySection = computed(() => {
  const result = { staged: [] as string[], unstaged: [] as string[], untracked: [] as string[] };
  for (const key of selectedKeys.value) {
    const idx = key.indexOf(":");
    if (idx < 0) continue;
    const sec = key.slice(0, idx) as SectionInfo["key"];
    const path = key.slice(idx + 1);
    if (sec in result) result[sec].push(path);
  }
  return result;
});

const selectedTotal = computed(() => selectedKeys.value.size);

const stageablePaths = computed(() => [
  ...selectedFilesBySection.value.unstaged,
  ...selectedFilesBySection.value.untracked,
]);

const unstageablePaths = computed(() => selectedFilesBySection.value.staged);

// 回滚仅适用 staged + unstaged，与单文件菜单一致（untracked 应使用「删除文件」）
const discardablePaths = computed(() => [
  ...selectedFilesBySection.value.staged,
  ...selectedFilesBySection.value.unstaged,
]);

// 复制路径：所有选中项（包含 untracked）
const copyablePaths = computed(() => [
  ...selectedFilesBySection.value.staged,
  ...selectedFilesBySection.value.unstaged,
  ...selectedFilesBySection.value.untracked,
]);

function isRowSelected(section: SectionInfo["key"], path: string) {
  return selectedKeys.value.has(makeKey(section, path));
}

function toggleRow(section: SectionInfo["key"], path: string) {
  const key = makeKey(section, path);
  const next = new Set(selectedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selectedKeys.value = next;
  lastClickedKey.value = key;
}

function selectRange(section: SectionInfo["key"], path: string) {
  const key = makeKey(section, path);
  const flat = flatFileKeys.value;
  const anchor =
    lastClickedKey.value && flat.includes(lastClickedKey.value) ? lastClickedKey.value : key;
  const a = flat.indexOf(anchor);
  const b = flat.indexOf(key);
  if (a < 0 || b < 0) {
    toggleRow(section, path);
    return;
  }
  const [from, to] = a <= b ? [a, b] : [b, a];
  const next = new Set(selectedKeys.value);
  for (let i = from; i <= to; i += 1) next.add(flat[i]);
  selectedKeys.value = next;
  lastClickedKey.value = key;
}

function clearSelection() {
  selectedKeys.value = new Set();
  lastClickedKey.value = null;
}

async function bulkStage() {
  const paths = stageablePaths.value;
  if (paths.length === 0) return;
  try {
    await commitStore.stageFiles(paths);
    showToast(`已暂存 ${paths.length} 个文件`);
    clearSelection();
  } catch (e: unknown) {
    showToast(`暂存失败: ${errMsg(e)}`);
  }
}

async function bulkUnstage() {
  const paths = unstageablePaths.value;
  if (paths.length === 0) return;
  try {
    await commitStore.unstageFiles(paths);
    showToast(`已取消暂存 ${paths.length} 个文件`);
    clearSelection();
  } catch (e: unknown) {
    showToast(`取消暂存失败: ${errMsg(e)}`);
  }
}

function bulkDiscard() {
  const paths = discardablePaths.value;
  if (paths.length === 0) return;
  confirmTitle.value = "回滚选中更改";
  confirmText.value = `确定要丢弃 ${paths.length} 个文件的本地修改吗？此操作不可撤销。`;
  pendingConfirmAction.value = async () => {
    const result = await commitStore.discardFiles(paths);
    // 已被回滚的文件如果是当前预览，清空预览
    if (selectedFile.value && result.ok.includes(selectedFile.value.path)) {
      selectedFile.value = null;
      diffResult.value = null;
    }
    if (result.failed.length === 0) {
      showToast(`已回滚 ${result.ok.length} 个文件`);
      clearSelection();
    } else if (result.ok.length === 0) {
      showToast(`回滚全部失败：${result.failed[0].error}`);
    } else {
      showToast(`已回滚 ${result.ok.length} / ${paths.length}，失败 ${result.failed.length}`);
      // 部分失败时只清除已成功的选中项
      const next = new Set(selectedKeys.value);
      for (const p of result.ok) {
        next.delete(makeKey("staged", p));
        next.delete(makeKey("unstaged", p));
      }
      selectedKeys.value = next;
    }
  };
  showConfirmDialog.value = true;
}

async function bulkCopyPath() {
  const paths = copyablePaths.value;
  if (paths.length === 0) return;
  const text = paths.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    showToast(`已复制 ${paths.length} 个路径`);
  } catch (e: unknown) {
    showToast(`复制失败: ${errMsg(e) || "剪贴板不可用"}`);
  }
}

// 删除：所有选中（与单文件菜单同口径，danger 二次确认 + 文件名预览）
const deletablePaths = computed(() => copyablePaths.value);

function bulkDelete() {
  const paths = deletablePaths.value;
  if (paths.length === 0) return;
  const preview = paths.slice(0, 5).join("\n");
  const more = paths.length > 5 ? `\n…等共 ${paths.length} 个文件` : "";
  confirmTitle.value = "删除选中文件";
  confirmText.value = `确定要从磁盘删除以下 ${paths.length} 个文件吗？此操作不可撤销。\n\n${preview}${more}`;
  pendingConfirmAction.value = async () => {
    const result = await commitStore.deleteFiles(paths);
    if (selectedFile.value && result.ok.includes(selectedFile.value.path)) {
      selectedFile.value = null;
      diffResult.value = null;
    }
    if (result.failed.length === 0) {
      showToast(`已删除 ${result.ok.length} 个文件`);
      clearSelection();
    } else if (result.ok.length === 0) {
      showToast(`删除全部失败：${result.failed[0].error}`);
    } else {
      showToast(`已删除 ${result.ok.length} / ${paths.length}，失败 ${result.failed.length}`);
      // 部分失败：清除已成功的选中项，保留失败项让用户可重试
      const next = new Set(selectedKeys.value);
      for (const p of result.ok) {
        next.delete(makeKey("staged", p));
        next.delete(makeKey("unstaged", p));
        next.delete(makeKey("untracked", p));
      }
      selectedKeys.value = next;
    }
  };
  showConfirmDialog.value = true;
}

// ---- 过滤规则弹窗 ----
const showFilterDialog = ref(false);
const filterRulesDraft = ref("");

function openFilterDialog() {
  filterRulesDraft.value = filterStore.getRules(repoPathOrEmpty());
  showFilterDialog.value = true;
}

function saveFilterRules() {
  filterStore.setRules(repoPathOrEmpty(), filterRulesDraft.value);
  showFilterDialog.value = false;
  showToast("过滤规则已更新");
}

function insertFilterExample() {
  const example = [
    "# 每行一条规则，类似 .gitignore",
    ".idea/",
    "node_modules/",
    "**/*.log",
    "dist/",
  ].join("\n");
  filterRulesDraft.value = filterRulesDraft.value
    ? `${filterRulesDraft.value.replace(/\s+$/, "")}\n${example}`
    : example;
}

function getStatusLetter(status: FileStatus["status"]): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "?";
    case "conflicted":
      return "!";
    case "ignored":
      return "I";
    default:
      return "?";
  }
}

function getStatusClass(status: FileStatus["status"]): string {
  switch (status) {
    case "added":
      return "status-added";
    case "modified":
      return "status-modified";
    case "deleted":
      return "status-deleted";
    case "renamed":
      return "status-renamed";
    case "copied":
      return "status-renamed";
    case "untracked":
      return "status-untracked";
    case "conflicted":
      return "status-conflicted";
    case "ignored":
      return "status-ignored";
    default:
      return "";
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (document.visibilityState === "visible" && repoStore.activeRepo && !commitStore.loading) {
      try {
        await commitStore.loadStatus();
        await refreshMergeState();
      } catch {
        // silent poll failure
      }
    }
  }, 10000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

onMounted(async () => {
  if (repoStore.activeRepo) {
    loading.value = true;
    errorMessage.value = null;
    try {
      await commitStore.loadStatus();
      await refreshMergeState();
    } catch (error: unknown) {
      errorMessage.value = `加载状态失败: ${errMsg(error)}`;
      console.error("Failed to load status:", error);
    } finally {
      loading.value = false;
    }
  }
  startPolling();
});

onUnmounted(() => {
  stopPolling();
  if (toastTimer) clearTimeout(toastTimer);
});

watch(
  () => repoStore.activeRepo?.path,
  async () => {
    if (repoStore.activeRepo) {
      loading.value = true;
      errorMessage.value = null;
      selectedFile.value = null;
      diffResult.value = null;
      clearSelection();
      try {
        await commitStore.loadStatus();
        await refreshMergeState();
      } catch (error: unknown) {
        errorMessage.value = `加载状态失败: ${errMsg(error)}`;
        console.error("Failed to load status:", error);
      } finally {
        loading.value = false;
      }
      startPolling();
    }
  }
);

// 文件列表刷新后清理已不存在的选中项
watch(flatFileKeys, (keys) => {
  if (selectedKeys.value.size === 0) return;
  const valid = new Set(keys);
  let changed = false;
  const next = new Set<string>();
  for (const k of selectedKeys.value) {
    if (valid.has(k)) next.add(k);
    else changed = true;
  }
  if (changed) selectedKeys.value = next;
});

function onFileRowClick(event: MouseEvent, file: FileStatus, section: SectionInfo) {
  if (event.shiftKey) {
    event.preventDefault();
    selectRange(section.key, file.path);
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    toggleRow(section.key, file.path);
    return;
  }
  // 普通点击：仅预览 diff，不影响多选；只有当当前没有多选时才清空
  onSelectFile(file, section);
  lastClickedKey.value = makeKey(section.key, file.path);
}

async function onSelectFile(file: FileStatus, section: SectionInfo) {
  selectedFile.value = file;
  selectedSection.value = section.key;
  diffResult.value = null;

  if (!repoStore.activeRepo) return;
  try {
    diffResult.value = await commands.getFileDiff(
      repoStore.activeRepo.path,
      file.path,
      section.key === "staged"
    );
  } catch (e) {
    console.error("Failed to load diff:", e);
  }
}

function onContextMenu(event: MouseEvent, file: FileStatus, section: SectionInfo) {
  event.preventDefault();
  event.stopPropagation();
  contextFile.value = file;
  contextSection.value = section.key;
  contextMenuRef.value?.show(event);
}

// ---- 暂存 / 取消暂存 ----
async function handleStageFile() {
  if (!contextFile.value) return;
  await commitStore.stageFile(contextFile.value.path);
}

async function handleUnstageFile() {
  if (!contextFile.value) return;
  await commitStore.unstageFile(contextFile.value.path);
}

// ---- 显示差异（主面板） ----
function handleShowDiff() {
  if (!contextFile.value) return;
  const section = sections.value.find((s) => s.key === contextSection.value)!;
  onSelectFile(contextFile.value, section);
}

// ---- 在弹窗中显示差异 ----
async function handleShowDiffInDialog() {
  if (!contextFile.value || !repoStore.activeRepo) return;
  diffDialogFilePath.value = contextFile.value.path;
  diffDialogLoading.value = true;
  showDiffDialog.value = true;
  try {
    diffDialogResult.value = await commands.getFileDiff(
      repoStore.activeRepo.path,
      contextFile.value.path,
      contextSection.value === "staged"
    );
  } catch (e) {
    console.error("Failed to load diff for dialog:", e);
    diffDialogResult.value = null;
  } finally {
    diffDialogLoading.value = false;
  }
}

// ---- 提交文件（快速提交） ----
function handleOpenQuickCommit() {
  if (!contextFile.value) return;
  quickCommitMessage.value = "";
  showCommitDialog.value = true;
}

async function doQuickCommit() {
  if (!contextFile.value || !repoStore.activeRepo || !quickCommitMessage.value.trim()) return;
  quickCommitLoading.value = true;
  try {
    // 先暂存此文件（如果未暂存），再提交
    if (contextSection.value !== "staged") {
      await commands.stageFile(repoStore.activeRepo.path, contextFile.value.path);
    }
    await commands.commit(repoStore.activeRepo.path, quickCommitMessage.value.trim(), false);
    showCommitDialog.value = false;
    quickCommitMessage.value = "";
    await commitStore.loadStatus();
    showToast("提交成功");
  } catch (e: unknown) {
    showToast(`提交失败: ${errMsg(e)}`);
  } finally {
    quickCommitLoading.value = false;
  }
}

// ---- 回滚（丢弃工作区修改） ----
function handleDiscardChanges() {
  if (!contextFile.value) return;
  const filePath = contextFile.value.path;
  confirmTitle.value = "回滚更改";
  confirmText.value = `确定要丢弃 "${filePath}" 的本地修改吗？此操作不可撤销。`;
  pendingConfirmAction.value = async () => {
    if (!repoStore.activeRepo || !contextFile.value) return;
    try {
      await commands.discardFileChanges(repoStore.activeRepo.path, contextFile.value.path);
      await commitStore.loadStatus();
      if (selectedFile.value?.path === contextFile.value.path) {
        selectedFile.value = null;
        diffResult.value = null;
      }
      showToast("已回滚更改");
    } catch (e: unknown) {
      showToast(`回滚失败: ${errMsg(e)}`);
    }
  };
  showConfirmDialog.value = true;
}

// ---- 搁置当前文件更改 ----
async function handleStashFile() {
  if (!contextFile.value || !repoStore.activeRepo) return;
  try {
    const msg = `搁置 ${contextFile.value.path}`;
    await commands.stashFile(repoStore.activeRepo.path, contextFile.value.path, msg);
    await commitStore.loadStatus();
    if (selectedFile.value?.path === contextFile.value.path) {
      selectedFile.value = null;
      diffResult.value = null;
    }
    showToast("已搁置更改");
  } catch (e: unknown) {
    showToast(`搁置失败: ${errMsg(e)}`);
  }
}

// ---- 作为补丁复制到剪贴板 ----
async function handleCopyAsPatch() {
  if (!contextFile.value || !repoStore.activeRepo) return;
  try {
    const raw = await commands.getFileDiffRaw(
      repoStore.activeRepo.path,
      contextFile.value.path,
      contextSection.value === "staged"
    );
    if (!raw.trim()) {
      showToast("没有可用的差异内容");
      return;
    }
    await navigator.clipboard.writeText(raw);
    showToast("补丁已复制到剪贴板");
  } catch (e: unknown) {
    showToast(`复制失败: ${errMsg(e)}`);
  }
}

// ---- 从本地更改创建补丁文件 ----
async function handleCreatePatch() {
  if (!contextFile.value || !repoStore.activeRepo) return;
  try {
    const raw = await commands.getFileDiffRaw(
      repoStore.activeRepo.path,
      contextFile.value.path,
      contextSection.value === "staged"
    );
    if (!raw.trim()) {
      showToast("没有可用的差异内容");
      return;
    }
    const safeName = contextFile.value.path.replace(/[/\\]/g, "_");
    const fileName = `${safeName}.patch`;
    const blob = new Blob([raw], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`补丁文件已下载: ${fileName}`);
  } catch (e: unknown) {
    showToast(`创建补丁失败: ${errMsg(e)}`);
  }
}

// ---- 删除文件 ----
function handleDeleteFile() {
  if (!contextFile.value) return;
  const filePath = contextFile.value.path;
  confirmTitle.value = "删除文件";
  confirmText.value = `确定要从磁盘删除 "${filePath}" 吗？此操作不可撤销。`;
  pendingConfirmAction.value = async () => {
    if (!repoStore.activeRepo || !contextFile.value) return;
    try {
      await commands.deleteFile(repoStore.activeRepo.path, contextFile.value.path);
      await commitStore.loadStatus();
      if (selectedFile.value?.path === contextFile.value.path) {
        selectedFile.value = null;
        diffResult.value = null;
      }
      showToast("文件已删除");
    } catch (e: unknown) {
      showToast(`删除失败: ${errMsg(e)}`);
    }
  };
  showConfirmDialog.value = true;
}

// ---- 复制路径 ----
function handleCopyPath() {
  if (!contextFile.value) return;
  navigator.clipboard.writeText(contextFile.value.path);
  showToast("路径已复制");
}

// ---- 二次确认执行 ----
async function doConfirmAction() {
  showConfirmDialog.value = false;
  if (pendingConfirmAction.value) {
    await pendingConfirmAction.value();
    pendingConfirmAction.value = null;
  }
}

function cancelConfirm() {
  showConfirmDialog.value = false;
  pendingConfirmAction.value = null;
}

// ---- 冲突解决 ----
function openMergeDialog(filePath: string) {
  const allConflicted = [...commitStore.stagedFiles, ...commitStore.unstagedFiles]
    .filter((f) => f.status === "conflicted")
    .map((f) => f.path);

  mergeConflictFiles.value = allConflicted.length > 0 ? allConflicted : [filePath];
  mergeFilePath.value = filePath;
  showMergeDialog.value = true;
}

async function onMergeResolved() {
  showMergeDialog.value = false;
  await commitStore.loadStatus();
}

// ---- 右键菜单项 ----
const contextMenuItems = computed<MenuItem[]>(() => {
  if (!contextFile.value) return [];
  const section = contextSection.value;
  const items: MenuItem[] = [];

  // 多选 > 1 时，顶部展示 4 个最重要的批量操作（添加/取消/回滚/复制路径）
  // 仅当当前右键的文件本身也在多选集合里时显示，避免误以为对单文件生效
  const ctxKey = makeKey(section, contextFile.value.path);
  if (selectedTotal.value > 1 && selectedKeys.value.has(ctxKey)) {
    const n = selectedTotal.value;
    items.push({
      label: `对选中 ${n} 项 · 添加到 VCS (${stageablePaths.value.length})`,
      disabled: stageablePaths.value.length === 0,
      action: bulkStage,
    });
    items.push({
      label: `对选中 ${n} 项 · 取消暂存 (${unstageablePaths.value.length})`,
      disabled: unstageablePaths.value.length === 0,
      action: bulkUnstage,
    });
    items.push({
      label: `对选中 ${n} 项 · 回滚 (${discardablePaths.value.length})`,
      disabled: discardablePaths.value.length === 0,
      action: bulkDiscard,
    });
    items.push({
      label: `对选中 ${n} 项 · 复制路径 (${copyablePaths.value.length})`,
      disabled: copyablePaths.value.length === 0,
      action: bulkCopyPath,
    });
    items.push({
      label: `对选中 ${n} 项 · 删除文件… (${deletablePaths.value.length})`,
      disabled: deletablePaths.value.length === 0,
      action: bulkDelete,
    });
    items.push({ separator: true, label: "" });
  }

  // 冲突文件：优先显示「解决冲突」
  if (contextFile.value.status === "conflicted") {
    items.push({ label: "解决冲突...", action: () => openMergeDialog(contextFile.value!.path) });
    items.push({ separator: true, label: "" });
  }

  // 差异查看
  items.push({ label: "显示差异", action: handleShowDiff });
  items.push({ label: "在新窗口中显示差异", action: handleShowDiffInDialog });
  items.push({ separator: true, label: "" });

  // 暂存操作
  if (section === "unstaged" || section === "untracked") {
    items.push({ label: "添加到 VCS（暂存）", action: handleStageFile });
  }
  if (section === "staged") {
    items.push({ label: "取消暂存", action: handleUnstageFile });
  }
  items.push({ label: "提交文件…", action: handleOpenQuickCommit });
  items.push({ separator: true, label: "" });

  // 撤销/搁置
  if (section !== "untracked") {
    items.push({ label: "回滚…", action: handleDiscardChanges });
  }
  items.push({ label: "搁置当前文件更改…", action: handleStashFile });
  items.push({ separator: true, label: "" });

  // 补丁
  items.push({ label: "作为补丁复制到剪贴板", action: handleCopyAsPatch });
  items.push({ label: "从本地更改创建补丁…", action: handleCreatePatch });
  items.push({ separator: true, label: "" });

  // 文件操作
  items.push({ label: "删除文件…", action: handleDeleteFile });
  items.push({ label: "复制路径", action: handleCopyPath });

  return items;
});
</script>

<template>
  <div class="local-changes-view">
    <div
      v-if="mergeState && mergeState.state !== 'none'"
      class="merge-banner"
      :class="`merge-banner--${mergeState.state}`"
    >
      <span class="merge-banner__icon">⚠</span>
      <span class="merge-banner__text">
        当前处于 <strong>{{ mergeState.state }}</strong> 进行中
        <template v-if="mergeState.hasConflicts">，存在未解决的冲突</template>
      </span>
      <button
        class="merge-banner__btn merge-banner__btn--primary"
        :disabled="mergeState.hasConflicts || mergeBusy"
        @click="onContinueMerge"
      >
        继续
      </button>
      <button
        class="merge-banner__btn merge-banner__btn--danger"
        :disabled="mergeBusy"
        @click="onAbortMerge"
      >
        中止
      </button>
    </div>
    <Splitpanes class="default-theme" style="height: 100%">
      <!-- Left: file list -->
      <Pane :size="35" :min-size="20" :max-size="60">
        <div class="file-panel">
          <div class="panel-header">
            <span class="panel-title">本地变更</span>
            <span class="panel-count">{{ totalCount }}</span>
            <span
              v-if="totalHiddenCount > 0"
              class="panel-hidden-count"
              :title="`${totalHiddenCount} 个文件被过滤规则隐藏`"
            >
              -{{ totalHiddenCount }}
            </span>
            <div class="header-actions">
              <button
                class="action-btn"
                :class="{ 'has-rules': hasFilterRules }"
                title="过滤规则"
                @click="openFilterDialog"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
              </button>
              <button
                class="action-btn"
                :class="{ active: filterStore.showFiltered }"
                :disabled="!hasFilterRules"
                :title="filterStore.showFiltered ? '隐藏被过滤项' : '显示被过滤项'"
                @click="filterStore.toggleShowFiltered()"
              >
                <svg
                  v-if="filterStore.showFiltered"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <svg
                  v-else
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                  />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </button>
              <button class="action-btn" title="暂存所有" @click="commitStore.stageAll()">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="7 13 12 18 17 13" />
                  <line x1="12" y1="6" x2="12" y2="18" />
                </svg>
              </button>
              <button class="action-btn" title="取消暂存所有" @click="commitStore.unstageAll()">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="17 11 12 6 7 11" />
                  <line x1="12" y1="18" x2="12" y2="6" />
                </svg>
              </button>
              <button class="action-btn" title="刷新" @click="commitStore.loadStatus()">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
              </button>
            </div>
          </div>

          <div class="file-list">
            <div v-if="errorMessage" class="error-message">
              <span class="error-icon">⚠️</span> {{ errorMessage }}
            </div>
            <div v-else-if="loading" class="state-hint">加载中...</div>
            <div v-else-if="totalCount === 0" class="state-hint">工作区无变更</div>
            <template v-else>
              <div v-for="section in sections" :key="section.key">
                <div
                  v-if="section.files.length > 0 || section.hiddenCount > 0"
                  class="section-header"
                >
                  <span>{{ section.title }}</span>
                  <span class="section-count">{{ section.files.length }}</span>
                  <span
                    v-if="section.hiddenCount > 0"
                    class="section-hidden"
                    :title="`${section.hiddenCount} 个文件被过滤规则隐藏`"
                  >
                    （隐藏 {{ section.hiddenCount }}）
                  </span>
                </div>
                <div
                  v-for="file in section.files"
                  :key="section.key + ':' + file.path"
                  class="file-item"
                  :class="{
                    selected: selectedFile?.path === file.path && selectedSection === section.key,
                    checked: isRowSelected(section.key, file.path),
                  }"
                  @click="(e) => onFileRowClick(e, file, section)"
                  @contextmenu="onContextMenu($event, file, section)"
                >
                  <input
                    type="checkbox"
                    class="row-checkbox"
                    :checked="isRowSelected(section.key, file.path)"
                    @click.stop="toggleRow(section.key, file.path)"
                  />
                  <span class="status-letter" :class="getStatusClass(file.status)">
                    {{ getStatusLetter(file.status) }}
                  </span>
                  <span class="file-path">{{ file.path }}</span>
                </div>
              </div>
            </template>
          </div>

          <!-- Bulk action bar -->
          <div v-if="selectedTotal > 0" class="bulk-bar">
            <span class="bulk-label">已选 {{ selectedTotal }} 项</span>
            <div class="bulk-btns">
              <button
                class="bulk-btn"
                :disabled="stageablePaths.length === 0"
                :title="`将 ${stageablePaths.length} 个文件添加到暂存区`"
                @click="bulkStage"
              >
                添加到 VCS ({{ stageablePaths.length }})
              </button>
              <button
                class="bulk-btn"
                :disabled="unstageablePaths.length === 0"
                :title="`取消暂存 ${unstageablePaths.length} 个文件`"
                @click="bulkUnstage"
              >
                取消暂存 ({{ unstageablePaths.length }})
              </button>
              <button
                class="bulk-btn danger"
                :disabled="discardablePaths.length === 0"
                :title="`回滚 ${discardablePaths.length} 个文件的本地修改（untracked 不参与）`"
                @click="bulkDiscard"
              >
                回滚 ({{ discardablePaths.length }})
              </button>
              <button
                class="bulk-btn ghost"
                :disabled="copyablePaths.length === 0"
                :title="`复制 ${copyablePaths.length} 个文件路径到剪贴板`"
                @click="bulkCopyPath"
              >
                复制路径 ({{ copyablePaths.length }})
              </button>
              <button
                class="bulk-btn danger"
                :disabled="deletablePaths.length === 0"
                :title="`从磁盘删除 ${deletablePaths.length} 个文件（不可撤销）`"
                @click="bulkDelete"
              >
                删除 ({{ deletablePaths.length }})
              </button>
              <button class="bulk-btn ghost" title="清除选择" @click="clearSelection">清除</button>
            </div>
          </div>

          <!-- Commit area -->
          <div class="commit-area">
            <textarea
              v-model="commitStore.commitMessage"
              class="commit-textarea"
              placeholder="提交信息..."
              rows="3"
            />
            <div class="commit-actions">
              <label class="amend-label">
                <input type="checkbox" v-model="commitStore.isAmend" />
                <span>Amend</span>
              </label>
              <div class="commit-btns">
                <button
                  class="commit-btn"
                  :disabled="
                    !commitStore.commitMessage.trim() || commitStore.stagedFiles.length === 0
                  "
                  @click="commitStore.commit()"
                >
                  提交
                </button>
                <button
                  class="commit-btn push-btn"
                  :disabled="
                    !commitStore.commitMessage.trim() || commitStore.stagedFiles.length === 0
                  "
                  @click="handleCommitAndPush()"
                >
                  提交并推送
                </button>
              </div>
            </div>
          </div>
        </div>
      </Pane>

      <!-- Right: diff viewer -->
      <Pane :size="65" :min-size="40">
        <div class="diff-area">
          <template v-if="selectedFile">
            <div class="diff-header">
              <span class="diff-file-path">{{ selectedFile.path }}</span>
            </div>
            <div v-if="diffResult" class="diff-content">
              <DiffViewer :diff="diffResult" />
            </div>
            <div v-else class="diff-loading">加载 Diff 中...</div>
          </template>
          <div v-else class="diff-empty">选择一个文件查看变更</div>
        </div>
      </Pane>
    </Splitpanes>

    <ContextMenu ref="contextMenuRef" :items="contextMenuItems" />

    <!-- 差异弹窗 -->
    <Teleport to="body">
      <div v-if="showDiffDialog" class="modal-overlay" @click.self="showDiffDialog = false">
        <div class="modal-dialog diff-modal">
          <div class="modal-header">
            <span class="modal-title">{{ diffDialogFilePath }}</span>
            <button class="modal-close" @click="showDiffDialog = false">✕</button>
          </div>
          <div class="modal-body">
            <div v-if="diffDialogLoading" class="modal-loading">加载中...</div>
            <div v-else-if="diffDialogResult" class="diff-modal-content">
              <DiffViewer :diff="diffDialogResult" />
            </div>
            <div v-else class="modal-loading">无差异内容</div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 快速提交弹窗 -->
    <Teleport to="body">
      <div v-if="showCommitDialog" class="modal-overlay" @click.self="showCommitDialog = false">
        <div class="modal-dialog commit-modal">
          <div class="modal-header">
            <span class="modal-title">提交文件：{{ contextFile?.path }}</span>
            <button class="modal-close" @click="showCommitDialog = false">✕</button>
          </div>
          <div class="modal-body">
            <textarea
              v-model="quickCommitMessage"
              class="modal-textarea"
              placeholder="输入提交信息…"
              rows="4"
              autofocus
              @keydown.ctrl.enter="doQuickCommit"
            />
            <p class="modal-hint">Ctrl+Enter 快速提交</p>
          </div>
          <div class="modal-footer">
            <button class="modal-btn" @click="showCommitDialog = false">取消</button>
            <button
              class="modal-btn primary"
              :disabled="!quickCommitMessage.trim() || quickCommitLoading"
              @click="doQuickCommit"
            >
              {{ quickCommitLoading ? "提交中…" : "提交" }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 过滤规则弹窗 -->
    <Teleport to="body">
      <div v-if="showFilterDialog" class="modal-overlay" @click.self="showFilterDialog = false">
        <div class="modal-dialog filter-modal">
          <div class="modal-header">
            <span class="modal-title">过滤规则（类似 .gitignore）</span>
            <button class="modal-close" @click="showFilterDialog = false">✕</button>
          </div>
          <div class="modal-body">
            <p class="modal-hint filter-hint">
              每行一条规则，支持目录后缀 <code>/</code>、<code>**</code>、<code>*</code>、<code
                >!</code
              >
              取反与 <code>#</code> 注释。<br />
              示例：<code>.idea/</code> 隐藏 .idea 目录下所有文件；<code>**/*.log</code> 隐藏所有
              .log 文件。
            </p>
            <textarea
              v-model="filterRulesDraft"
              class="filter-textarea"
              placeholder=".idea/&#10;node_modules/&#10;**/*.log"
              spellcheck="false"
            />
          </div>
          <div class="modal-footer">
            <button class="modal-btn ghost" @click="insertFilterExample">插入示例</button>
            <div style="flex: 1"></div>
            <button class="modal-btn" @click="showFilterDialog = false">取消</button>
            <button class="modal-btn primary" @click="saveFilterRules">保存</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 二次确认弹窗 -->
    <Teleport to="body">
      <div v-if="showConfirmDialog" class="modal-overlay" @click.self="cancelConfirm">
        <div class="modal-dialog confirm-modal">
          <div class="modal-header">
            <span class="modal-title">{{ confirmTitle }}</span>
          </div>
          <div class="modal-body">
            <p class="confirm-text">{{ confirmText }}</p>
          </div>
          <div class="modal-footer">
            <button class="modal-btn" @click="cancelConfirm">取消</button>
            <button class="modal-btn danger" @click="doConfirmAction">确定</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast 通知 -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toastVisible" class="toast">{{ toastMessage }}</div>
      </Transition>
    </Teleport>

    <!-- 冲突解决弹窗 -->
    <Teleport to="body">
      <div v-if="showMergeDialog" class="modal-overlay merge-overlay">
        <div class="merge-dialog-panel">
          <div class="merge-dialog-header">
            <span>解决合并冲突：{{ mergeFilePath }}</span>
            <button class="modal-close" @click="showMergeDialog = false">✕</button>
          </div>
          <div class="merge-dialog-body">
            <ThreeWayMerge
              :file-path="mergeFilePath"
              :conflict-files="mergeConflictFiles"
              @resolved="onMergeResolved"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>

  <PushDialog
    :visible="showPushDialog"
    :repo-path="repoStore.activeRepo?.path ?? ''"
    :repo-name="repoStore.activeRepo?.name"
    @confirm="onPushConfirmed"
    @close="onPushCancelled"
  />
</template>

<style scoped>
.local-changes-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
}

.merge-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-warning-bg, #3b2f00);
  color: var(--color-warning-fg, #ffd54f);
  border-bottom: 1px solid var(--color-warning-border, #6b5a00);
  font-size: 13px;
}
.merge-banner--cherry-pick {
  background: var(--color-info-bg, #1e2f3b);
  color: var(--color-info-fg, #4fc3f7);
  border-bottom-color: var(--color-info-border, #00567b);
}
.merge-banner__icon {
  font-size: 16px;
  line-height: 1;
}
.merge-banner__text {
  flex: 1;
  min-width: 0;
}
.merge-banner__text strong {
  text-transform: capitalize;
}
.merge-banner__btn {
  padding: 4px 10px;
  border-radius: 3px;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
}
.merge-banner__btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}
.merge-banner__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.merge-banner__btn--primary {
  background: var(--color-primary, #2196f3);
  color: white;
  border-color: var(--color-primary, #2196f3);
}
.merge-banner__btn--danger {
  border-color: var(--color-danger, #e57373);
  color: var(--color-danger, #e57373);
}

.file-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-foreground);
}

.panel-count {
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  padding: 0 6px;
  border-radius: 8px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  color: var(--color-foreground-muted);
  padding: 3px;
  border-radius: 3px;
  cursor: pointer;
}

.action-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.file-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.error-message {
  padding: 12px;
  color: var(--color-error);
  background: var(--color-surface-error);
  border-left: 3px solid var(--color-error);
  display: flex;
  align-items: center;
  gap: 8px;
}

.error-icon {
  font-size: 16px;
}

.state-hint {
  padding: 16px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-foreground-muted);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 1;
}

.section-count {
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  padding: 0 5px;
  border-radius: 8px;
  font-weight: 400;
}

.file-item {
  display: flex;
  align-items: center;
  padding: 3px 8px;
  cursor: pointer;
  gap: 6px;
  font-size: 12px;
}

.file-item:hover {
  background: var(--color-surface-hover);
}

.file-item.selected {
  background: var(--color-surface-active);
}

.status-letter {
  font-size: 10px;
  font-weight: 700;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.status-added {
  color: var(--color-git-added);
}
.status-modified {
  color: var(--color-git-modified);
}
.status-deleted {
  color: var(--color-git-deleted);
}
.status-renamed {
  color: var(--color-git-renamed);
}
.status-untracked {
  color: var(--color-git-untracked);
}
.status-conflicted {
  color: var(--color-error);
}
.status-ignored {
  color: var(--color-foreground-muted);
}

.file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.commit-area {
  flex-shrink: 0;
  padding: 8px;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.commit-textarea {
  width: 100%;
  resize: vertical;
  padding: 6px 8px;
  font-size: 12px;
  font-family: var(--font-sans);
  border-radius: 3px;
  min-height: 56px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
}

.commit-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.commit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.amend-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  cursor: pointer;
  color: var(--color-foreground-muted);
  white-space: nowrap;
}

.amend-label input {
  margin: 0;
}

.commit-btns {
  display: flex;
  gap: 4px;
  flex: 1;
}

.commit-btn {
  flex: 1;
  padding: 5px 8px;
  background: var(--color-primary);
  color: white;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.commit-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.commit-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.push-btn {
  background: var(--color-surface-active);
  color: var(--color-foreground);
}

.push-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.diff-area {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
}

.diff-header {
  padding: 6px 10px;
  font-size: 11px;
  color: var(--color-foreground-muted);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.diff-file-path {
  font-family: var(--font-mono, monospace);
}

.diff-content {
  flex: 1;
  overflow: hidden;
}

.diff-loading,
.diff-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

:deep(.splitpanes__splitter) {
  background: var(--color-border) !important;
}

:deep(.splitpanes--vertical > .splitpanes__splitter) {
  width: 3px !important;
  min-width: 3px !important;
}

/* ---- 模态弹窗 ---- */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.diff-modal {
  width: 85vw;
  height: 80vh;
}

.commit-modal {
  width: 480px;
}

.confirm-modal {
  width: 400px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.modal-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-foreground);
  font-family: var(--font-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-close {
  background: none;
  border: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
  line-height: 1;
}

.modal-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.modal-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.diff-modal-content {
  flex: 1;
  overflow: hidden;
}

.modal-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-foreground-muted);
  font-size: 12px;
}

.modal-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  margin: 12px;
  width: calc(100% - 24px);
  font-size: 12px;
  font-family: var(--font-sans);
  border-radius: 4px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
  resize: vertical;
}

.modal-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.modal-hint {
  margin: 0 12px 8px;
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.confirm-text {
  padding: 16px;
  font-size: 13px;
  color: var(--color-foreground);
  line-height: 1.5;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 50vh;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.modal-btn {
  padding: 5px 14px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
}

.modal-btn:hover {
  background: var(--color-surface-hover);
}

.modal-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.modal-btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.modal-btn.primary:disabled {
  opacity: 0.4;
  cursor: default;
}

.modal-btn.danger {
  background: var(--color-error, #e05252);
  color: white;
  border-color: transparent;
}

.modal-btn.danger:hover {
  opacity: 0.85;
}

/* ---- Toast ---- */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
  font-size: 12px;
  padding: 7px 16px;
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 9999;
  pointer-events: none;
  white-space: nowrap;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* ---- Merge conflict dialog ---- */
.merge-overlay {
  padding: 16px;
}

.merge-dialog-panel {
  width: 100%;
  height: 100%;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
}

.merge-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}

.merge-dialog-body {
  flex: 1;
  overflow: hidden;
  display: flex;
}

/* ---- 过滤规则 / 多选 ---- */
.panel-hidden-count {
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  padding: 0 5px;
  border-radius: 8px;
  font-style: italic;
}

.action-btn.has-rules {
  color: var(--color-primary);
}

.action-btn.active {
  background: var(--color-surface-active);
  color: var(--color-primary);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.section-hidden {
  font-size: 10px;
  color: var(--color-foreground-muted);
  font-weight: 400;
  font-style: italic;
}

.row-checkbox {
  width: 12px;
  height: 12px;
  margin: 0;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--color-primary);
}

.file-item.checked {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.file-item.checked:hover {
  background: color-mix(in srgb, var(--color-primary) 18%, transparent);
}

.file-item.checked.selected {
  background: color-mix(in srgb, var(--color-primary) 22%, transparent);
}

.bulk-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--color-surface-active);
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
  font-size: 11px;
}

.bulk-label {
  color: var(--color-foreground-muted);
  white-space: nowrap;
}

.bulk-btns {
  display: flex;
  gap: 4px;
  flex: 1;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.bulk-btn {
  padding: 3px 8px;
  font-size: 11px;
  background: var(--color-primary);
  color: white;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
  border: none;
}

.bulk-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.bulk-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.bulk-btn.ghost {
  background: transparent;
  color: var(--color-foreground-muted);
  border: 1px solid var(--color-border);
}

.bulk-btn.ghost:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.bulk-btn.danger {
  background: var(--color-error, #e05252);
  color: white;
  border: none;
}

.bulk-btn.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-error, #e05252) 85%, black);
}

/* ---- 过滤规则弹窗 ---- */
.filter-modal {
  width: 560px;
  max-width: 90vw;
}

.filter-hint {
  margin: 12px 12px 8px;
}

.filter-hint code {
  background: var(--color-surface-active);
  padding: 0 4px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.filter-textarea {
  width: calc(100% - 24px);
  margin: 0 12px 12px;
  min-height: 220px;
  padding: 10px 12px;
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  border-radius: 4px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  color: var(--color-foreground);
  resize: vertical;
  box-sizing: border-box;
}

.filter-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.modal-btn.ghost {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-foreground-muted);
}

.modal-btn.ghost:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}
</style>
