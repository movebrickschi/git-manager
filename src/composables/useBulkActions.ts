import { computed, type ComputedRef, type Ref } from "vue";
import { useCommitStore } from "@/stores/commitStore";
import type { DiffResult, FileStatus } from "@/utils/commands";
import { errMsg } from "@/utils/error";
import type { ConfirmDialogOptions } from "@/composables/useConfirmDialog";

export type SectionKey = "staged" | "unstaged" | "untracked";

export interface SelectedBySection {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface BulkActionsOptions {
  selectedFilesBySection: ComputedRef<SelectedBySection>;
  selectedFile: Ref<FileStatus | null>;
  diffResult: Ref<DiffResult | null>;
  clearSelection: () => void;
  removeKeys: (keys: readonly string[]) => void;
  makeKey: (section: SectionKey, path: string) => string;
  onMessage: (msg: string) => void;
  openConfirm: (opts: ConfirmDialogOptions) => void;
}

/**
 * 批量操作：暂存 / 取消暂存 / 回滚 / 复制路径 / 删除。
 * - 计算路径分组（stageable/unstageable/discardable/copyable/deletable）
 * - 包装 commitStore 调用 + 结果消息 + 选中清理逻辑
 * - 危险操作（discard/delete）通过 openConfirm 走二次确认
 */
export function useBulkActions(opts: BulkActionsOptions) {
  const commitStore = useCommitStore();
  const { selectedFilesBySection, selectedFile, diffResult } = opts;

  const stageablePaths = computed(() => [
    ...selectedFilesBySection.value.unstaged,
    ...selectedFilesBySection.value.untracked,
  ]);

  const unstageablePaths = computed(() => selectedFilesBySection.value.staged);

  const discardablePaths = computed(() => [
    ...selectedFilesBySection.value.staged,
    ...selectedFilesBySection.value.unstaged,
  ]);

  const copyablePaths = computed(() => [
    ...selectedFilesBySection.value.staged,
    ...selectedFilesBySection.value.unstaged,
    ...selectedFilesBySection.value.untracked,
  ]);

  const deletablePaths = computed(() => copyablePaths.value);

  function clearPreviewIfMatch(paths: readonly string[]): void {
    if (selectedFile.value && paths.includes(selectedFile.value.path)) {
      selectedFile.value = null;
      diffResult.value = null;
    }
  }

  async function bulkStage(): Promise<void> {
    const paths = stageablePaths.value;
    if (paths.length === 0) return;
    try {
      await commitStore.stageFiles(paths);
      opts.onMessage(`已暂存 ${paths.length} 个文件`);
      opts.clearSelection();
    } catch (e: unknown) {
      opts.onMessage(`暂存失败: ${errMsg(e)}`);
    }
  }

  async function bulkUnstage(): Promise<void> {
    const paths = unstageablePaths.value;
    if (paths.length === 0) return;
    try {
      await commitStore.unstageFiles(paths);
      opts.onMessage(`已取消暂存 ${paths.length} 个文件`);
      opts.clearSelection();
    } catch (e: unknown) {
      opts.onMessage(`取消暂存失败: ${errMsg(e)}`);
    }
  }

  function bulkDiscard(): void {
    const paths = discardablePaths.value;
    if (paths.length === 0) return;
    opts.openConfirm({
      title: "回滚选中更改",
      text: `确定要丢弃 ${paths.length} 个文件的本地修改吗？此操作不可撤销。`,
      action: async () => {
        const result = await commitStore.discardFiles(paths);
        clearPreviewIfMatch(result.ok);
        if (result.failed.length === 0) {
          opts.onMessage(`已回滚 ${result.ok.length} 个文件`);
          opts.clearSelection();
          return;
        }
        if (result.ok.length === 0) {
          opts.onMessage(`回滚全部失败：${result.failed[0]?.error ?? "未知错误"}`);
          return;
        }
        opts.onMessage(`已回滚 ${result.ok.length} / ${paths.length}，失败 ${result.failed.length}`);
        const toRemove: string[] = [];
        for (const p of result.ok) {
          toRemove.push(opts.makeKey("staged", p), opts.makeKey("unstaged", p));
        }
        opts.removeKeys(toRemove);
      },
    });
  }

  async function bulkCopyPath(): Promise<void> {
    const paths = copyablePaths.value;
    if (paths.length === 0) return;
    try {
      await navigator.clipboard.writeText(paths.join("\n"));
      opts.onMessage(`已复制 ${paths.length} 个路径`);
    } catch (e: unknown) {
      opts.onMessage(`复制失败: ${errMsg(e) || "剪贴板不可用"}`);
    }
  }

  function bulkDelete(): void {
    const paths = deletablePaths.value;
    if (paths.length === 0) return;
    const preview = paths.slice(0, 5).join("\n");
    const more = paths.length > 5 ? `\n…等共 ${paths.length} 个文件` : "";
    opts.openConfirm({
      title: "删除选中文件",
      text: `确定要从磁盘删除以下 ${paths.length} 个文件吗？此操作不可撤销。\n\n${preview}${more}`,
      action: async () => {
        const result = await commitStore.deleteFiles(paths);
        clearPreviewIfMatch(result.ok);
        if (result.failed.length === 0) {
          opts.onMessage(`已删除 ${result.ok.length} 个文件`);
          opts.clearSelection();
          return;
        }
        if (result.ok.length === 0) {
          opts.onMessage(`删除全部失败：${result.failed[0]?.error ?? "未知错误"}`);
          return;
        }
        opts.onMessage(`已删除 ${result.ok.length} / ${paths.length}，失败 ${result.failed.length}`);
        const toRemove: string[] = [];
        for (const p of result.ok) {
          toRemove.push(
            opts.makeKey("staged", p),
            opts.makeKey("unstaged", p),
            opts.makeKey("untracked", p)
          );
        }
        opts.removeKeys(toRemove);
      },
    });
  }

  return {
    stageablePaths,
    unstageablePaths,
    discardablePaths,
    copyablePaths,
    deletablePaths,
    bulkStage,
    bulkUnstage,
    bulkDiscard,
    bulkCopyPath,
    bulkDelete,
  };
}
