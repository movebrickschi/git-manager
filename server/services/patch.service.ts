import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { errStr, getGit, getConflictFiles } from "./_helpers.js";
import type { MergeResult } from "../git-service.js";

/**
 * Patch（补丁）服务。
 *
 * - `createPatch`：把指定 commit 导出成 `git format-patch -1 --stdout` 格式的 mailbox 文本，
 *   前端可直接弹出"另存为" / 复制到剪贴板。
 * - `applyPatch`：把任意 patch 文本应用到工作区。优先用 `git apply --3way` 走"工作区合并 + 不创建
 *   commit"路径，符合 IDEA `Apply Patch` 的语义（用户审阅后再 commit）；失败按 conflict 返回。
 *   不使用 `git am`，因为 `am` 会把作者信息一起写入并创建 commit，行为差异大且失败后留下
 *   `.git/rebase-apply/` 需要 abort，对桌面端用户不友好。
 */

export const patchService = {
  async createPatch(repoPath: string, commitId: string): Promise<string> {
    const git = getGit(repoPath);
    const out = await git.raw(["format-patch", "-1", "--stdout", commitId]);
    return out;
  },

  async applyPatch(repoPath: string, patchContent: string): Promise<MergeResult> {
    if (typeof patchContent !== "string" || patchContent.length === 0) {
      throw new Error("patchContent is empty");
    }
    const git = getGit(repoPath);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-patch-"));
    const tmpFile = path.join(tmpDir, "input.patch");
    await fs.writeFile(tmpFile, patchContent, "utf8");
    try {
      await git.raw(["apply", "--3way", "--whitespace=nowarn", tmpFile]);
      return { success: true, conflicts: [], message: "Patch applied" };
    } catch (e: unknown) {
      const conflicts = await getConflictFiles(repoPath);
      return {
        success: false,
        conflicts,
        message: errStr(e) || "Patch apply failed (possibly conflicting context)",
      };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  },
};
