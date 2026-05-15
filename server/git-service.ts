/**
 * Git Service Facade.
 *
 * P3 把原 1440 行 god class 拆为 8 个职责单一的子服务（`./services/*`）；
 * P5 把所有领域 DTO 集中到 `shared/types.ts` 作为前端 / Express / Electron 三端
 * 唯一类型源。本文件现在只承担两件事：
 *   1. 从 `shared/types.js` re-export 所有领域类型，保持旧 import 路径不破坏
 *      （消费者继续 `from "../git-service.js"` 即可）
 *   2. 把 8 个子服务的方法 spread 合并到 `gitService` 上，保持 facade API 不变
 */

import { repoService } from "./services/repo.service.js";
import { logService } from "./services/log.service.js";
import { branchService } from "./services/branch.service.js";
import { statusService } from "./services/status.service.js";
import { remoteService } from "./services/remote.service.js";
import { stashService } from "./services/stash.service.js";
import { blameService } from "./services/blame.service.js";
import { conflictService } from "./services/conflict.service.js";
import { patchService } from "./services/patch.service.js";
import { submoduleService } from "./services/submodule.service.js";
import { rebaseService } from "./services/rebase.service.js";

export type {
  BlameInfo,
  BlameLine,
  BranchInfo,
  BranchesResult,
  CommitInfo,
  ConflictFile,
  DiffHunk,
  DiffLine,
  DiffResult,
  DiffResultModel,
  FileStatus,
  GraphEdge,
  GraphRow,
  LogFilter,
  LogResult,
  MergeResult,
  PushOptions,
  ReflogEntry,
  RefInfo,
  RemoteInfo,
  RepoOpenResult,
  StashEntry,
  StatusResult,
  Submodule,
} from "../shared/types.js";

export const gitService = {
  ...repoService,
  ...logService,
  ...branchService,
  ...statusService,
  ...remoteService,
  ...stashService,
  ...blameService,
  ...conflictService,
  ...patchService,
  ...submoduleService,
  ...rebaseService,
};

export type GitService = typeof gitService;
