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

  /** stash 可作用于 staged + unstaged + untracked 全部 dirty 文件。 */
  const stashablePaths = computed(() => copyablePaths.value);

  /** commit 选中文件：只允许 staged + unstaged（untracked 需先 add，pathspec 也行）。
   * 这里也允许 untracked：commitFiles 后端会先 `git add -- <paths>` 把它们入索引再 commit。 */
  const committablePaths = computed(() => copyablePaths.value);

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

  async function bulkStash(): Promise<void> {
    const paths = stashablePaths.value;
    if (paths.length === 0) return;
    try {
      const tag = `搁置 ${paths.length} 个文件 @ ${new Date().toLocaleString()}`;
      await commitStore.stashFiles(paths, tag);
      opts.onMessage(`已搁置 ${paths.length} 个文件`);
      clearPreviewIfMatch(paths);
      opts.clearSelection();
    } catch (e: unknown) {
      opts.onMessage(`搁置失败: ${errMsg(e)}`);
    }
  }

  /**
   * 批量提交选中文件：调用方负责提供 message（通常走 quickCommit dialog）。
   * 成功返回新 commit 短 id；失败抛错由调用方 catch。
   */
  async function bulkCommit(message: string): Promise<string> {
    const paths = committablePaths.value;
    if (paths.length === 0) return "";
    const head = await commitStore.commitFiles(paths, message);
    clearPreviewIfMatch(paths);
    opts.clearSelection();
    return head;
  }

  return {
    stageablePaths,
    unstageablePaths,
    discardablePaths,
    copyablePaths,
    deletablePaths,
    stashablePaths,
    committablePaths,
    bulkStage,
    bulkUnstage,
    bulkDiscard,
    bulkCopyPath,
    bulkDelete,
    bulkStash,
    bulkCommit,
  };
}
