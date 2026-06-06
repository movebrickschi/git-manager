/**
 * Unified post-write Git refresh coordinator.
 *
 * Most stale-UI issues come from write operations (commit / push / rebase /
 * conflict resolve / stash / reset / cherry-pick / submodule ...) forgetting to
 * call one of the three refreshers on completion, leaving that view out of date:
 *   - commitStore.loadStatus()   working/staged file status, change-count badges
 *   - branchStore.loadBranches() branch info, ahead/behind push arrows
 *   - logStore.loadCommits(true) commit history graph
 *
 * Every write op calls refreshGit() on completion, narrowing via scope when needed,
 * so call sites stop hand-assembling refresh logic (which is how things got missed).
 *
 * Note: this module is imported back by commitStore / rebaseStore, forming an ESM
 * circular import. useXxxStore() is only called inside the function body (at runtime,
 * not load time), which is the safe ESM live-binding pattern.
 */
import { useCommitStore } from "@/stores/commitStore";
import { useBranchStore } from "@/stores/branchStore";
import { useLogStore } from "@/stores/logStore";

export interface GitRefreshScope {
  /** Working/staged file status (commitStore.loadStatus) */
  status?: boolean;
  /** Branch list + ahead/behind arrows (branchStore.loadBranches) */
  branches?: boolean;
  /** Commit history graph (logStore.loadCommits(true)) */
  log?: boolean;
  /** Submodule list (branchStore.loadSubmodules), off by default */
  submodules?: boolean;
}

const DEFAULT_SCOPE: Required<GitRefreshScope> = {
  status: true,
  branches: true,
  log: true,
  submodules: false,
};

/**
 * Refresh the selected Git views in parallel. A single failure does not block the
 * others (Promise.allSettled), so one rejecting refresher cannot starve the rest.
 *
 * @param scope pass to refresh a subset; defaults to status + branches + log.
 */
export async function refreshGit(scope: GitRefreshScope = {}): Promise<void> {
  const s = { ...DEFAULT_SCOPE, ...scope };
  const tasks: Promise<unknown>[] = [];
  if (s.status) tasks.push(useCommitStore().loadStatus());
  if (s.branches) tasks.push(useBranchStore().loadBranches());
  if (s.log) tasks.push(useLogStore().loadCommits(true));
  if (s.submodules) tasks.push(useBranchStore().loadSubmodules());
  await Promise.allSettled(tasks);
}