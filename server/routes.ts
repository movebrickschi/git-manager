import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { gitService } from "./git-service.js";

const router = Router();

const IS_PROD = process.env.NODE_ENV === "production";

function classifyError(e: any): { code: string; status: number } {
  const msg = String(e?.message ?? e ?? "").toLowerCase();
  if (msg.includes("path traversal") || msg.includes("invalid filepath")) {
    return { code: "PATH_DENIED", status: 400 };
  }
  if (msg.includes("not a git repository") || msg.includes("enoent")) {
    return { code: "REPO_NOT_FOUND", status: 404 };
  }
  if (msg.includes("conflict")) {
    return { code: "GIT_CONFLICT", status: 409 };
  }
  if (msg.includes("non-fast-forward")) {
    return { code: "NON_FAST_FORWARD", status: 409 };
  }
  if (msg.includes("authentication") || msg.includes("permission denied")) {
    return { code: "AUTH_FAILED", status: 401 };
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return { code: "GIT_TIMEOUT", status: 504 };
  }
  return { code: "GIT_ERR", status: 500 };
}

function wrap(fn: (req: Request) => Promise<any>) {
  return async (req: Request, res: Response) => {
    const traceId = randomUUID();
    res.setHeader("X-Trace-Id", traceId);
    try {
      const result = await fn(req);
      res.json({ success: true, data: result });
    } catch (e: any) {
      const { code, status } = classifyError(e);
      console.error(`[${traceId}] ${req.method} ${req.path} ${code}:`, e?.stack ?? e);
      res.status(status).json({
        success: false,
        code,
        traceId,
        error: IS_PROD ? code : (e?.message ?? String(e)),
      });
    }
  };
}

router.post(
  "/repo/open",
  wrap((req) => gitService.openRepo(req.body.path))
);

router.post(
  "/log",
  wrap((req) => gitService.getLog(req.body.repoPath, req.body.filter))
);

router.post(
  "/commit/detail",
  wrap((req) => gitService.getCommitDetail(req.body.repoPath, req.body.commitId))
);

router.post(
  "/commit/files",
  wrap((req) => gitService.getCommitFiles(req.body.repoPath, req.body.commitId))
);

router.post(
  "/commit/diff",
  wrap((req) => gitService.getCommitDiff(req.body.repoPath, req.body.commitId, req.body.filePath))
);

router.post(
  "/file/diff",
  wrap((req) => gitService.getFileDiff(req.body.repoPath, req.body.filePath, req.body.staged))
);

router.post(
  "/commits/compare",
  wrap((req) => gitService.compareCommits(req.body.repoPath, req.body.fromId, req.body.toId))
);

router.post(
  "/branches",
  wrap((req) => gitService.getBranches(req.body.repoPath))
);

router.post(
  "/branch/create",
  wrap((req) => gitService.createBranch(req.body.repoPath, req.body.name, req.body.startPoint))
);

router.post(
  "/branch/checkout",
  wrap((req) => gitService.checkoutBranch(req.body.repoPath, req.body.name))
);

router.post(
  "/branch/delete",
  wrap((req) => gitService.deleteBranch(req.body.repoPath, req.body.name, req.body.force))
);

router.post(
  "/branch/rename",
  wrap((req) => gitService.renameBranch(req.body.repoPath, req.body.oldName, req.body.newName))
);

router.post(
  "/branch/merge",
  wrap((req) => gitService.mergeBranch(req.body.repoPath, req.body.name))
);

router.post(
  "/branch/rebase",
  wrap((req) => gitService.rebaseBranch(req.body.repoPath, req.body.upstream))
);

router.post(
  "/cherry-pick",
  wrap((req) => gitService.cherryPick(req.body.repoPath, req.body.commitId))
);

router.post(
  "/commit/revert",
  wrap((req) => gitService.revertCommit(req.body.repoPath, req.body.commitId))
);

router.post(
  "/commit/reset",
  wrap((req) => gitService.resetToCommit(req.body.repoPath, req.body.commitId, req.body.mode))
);

router.post(
  "/status",
  wrap((req) => gitService.getStatus(req.body.repoPath))
);

router.post(
  "/stage/file",
  wrap((req) => gitService.stageFile(req.body.repoPath, req.body.filePath))
);

router.post(
  "/unstage/file",
  wrap((req) => gitService.unstageFile(req.body.repoPath, req.body.filePath))
);

router.post(
  "/stage/all",
  wrap((req) => gitService.stageAll(req.body.repoPath))
);

router.post(
  "/unstage/all",
  wrap((req) => gitService.unstageAll(req.body.repoPath))
);

router.post(
  "/commit",
  wrap((req) => gitService.commit(req.body.repoPath, req.body.message, req.body.amend))
);

router.post(
  "/push",
  wrap((req) => gitService.push(req.body.repoPath, req.body.remote, req.body.branch))
);

router.post(
  "/unpushed-commits",
  wrap((req) => gitService.getUnpushedCommits(req.body.repoPath, req.body.remote, req.body.branch))
);

router.post(
  "/pull",
  wrap((req) => gitService.pull(req.body.repoPath, req.body.remote, req.body.rebase))
);

router.post(
  "/fetch",
  wrap((req) => gitService.fetch(req.body.repoPath, req.body.remote))
);

router.post(
  "/fetch/all",
  wrap((req) => gitService.fetchAll(req.body.repoPath))
);

router.post(
  "/branch/fetch-update",
  wrap((req) => gitService.fetchBranch(req.body.repoPath, req.body.remote, req.body.branchName))
);

router.post(
  "/remotes",
  wrap((req) => gitService.getRemotes(req.body.repoPath))
);

router.post(
  "/stash/list",
  wrap((req) => gitService.getStashList(req.body.repoPath))
);

router.post(
  "/stash/save",
  wrap((req) =>
    gitService.stashSave(req.body.repoPath, req.body.message, req.body.includeUntracked)
  )
);

router.post(
  "/stash/apply",
  wrap((req) => gitService.stashApply(req.body.repoPath, req.body.index))
);

router.post(
  "/stash/pop",
  wrap((req) => gitService.stashPop(req.body.repoPath, req.body.index))
);

router.post(
  "/stash/drop",
  wrap((req) => gitService.stashDrop(req.body.repoPath, req.body.index))
);

router.post(
  "/stash/files",
  wrap((req) => gitService.getStashFiles(req.body.repoPath, req.body.index))
);

router.post(
  "/stash/file-diff",
  wrap((req) => gitService.getStashFileDiff(req.body.repoPath, req.body.index, req.body.filePath))
);

router.post(
  "/blame",
  wrap((req) => gitService.getBlame(req.body.repoPath, req.body.filePath, req.body.commitId))
);

router.post(
  "/conflict/files",
  wrap((req) => gitService.getConflictFiles(req.body.repoPath))
);

router.post(
  "/conflict/content",
  wrap((req) => gitService.getConflictContent(req.body.repoPath, req.body.filePath))
);

router.post(
  "/conflict/resolve",
  wrap((req) => gitService.resolveConflict(req.body.repoPath, req.body.filePath, req.body.content))
);

router.post(
  "/conflict/working-content",
  wrap((req) => gitService.getWorkingFileContent(req.body.repoPath, req.body.filePath))
);

router.post(
  "/merge-state",
  wrap((req) => gitService.getMergeState(req.body.repoPath))
);

router.post(
  "/merge-op/continue",
  wrap((req) => gitService.continueOperation(req.body.repoPath, req.body.op))
);

router.post(
  "/merge-op/abort",
  wrap((req) => gitService.abortOperation(req.body.repoPath, req.body.op))
);

router.post(
  "/clone",
  wrap((req) => gitService.cloneRepo(req.body.url, req.body.path))
);

router.post(
  "/file/content",
  wrap((req) => gitService.getFileContent(req.body.repoPath, req.body.commitId, req.body.filePath))
);

router.post(
  "/file/discard",
  wrap((req) => gitService.discardFileChanges(req.body.repoPath, req.body.filePath))
);

router.post(
  "/file/diff-raw",
  wrap((req) => gitService.getFileDiffRaw(req.body.repoPath, req.body.filePath, req.body.staged))
);

router.post(
  "/file/delete",
  wrap((req) => gitService.deleteFile(req.body.repoPath, req.body.filePath))
);

router.post(
  "/stash/file",
  wrap((req) => gitService.stashFile(req.body.repoPath, req.body.filePath, req.body.message))
);

export default router;
