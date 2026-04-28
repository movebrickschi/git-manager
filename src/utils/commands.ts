import { createElectronAdapter, createElectronPlatform } from "./electron-adapter";
import { createWebAdapter, createWebPlatform } from "./web-adapter";
import type { Commands, Platform } from "./types";

export type {
  RepoOpenResult,
  CommitInfo,
  RefInfo,
  GraphRow,
  GraphEdge,
  LogResult,
  LogFilter,
  BranchInfo,
  BranchesResult,
  FileStatus,
  StatusResult,
  DiffResult,
  DiffHunk,
  DiffLine,
  BlameInfo,
  BlameLine,
  StashEntry,
  MergeResult,
  ConflictFile,
  RemoteInfo,
  ProgressEvent,
} from "./types";

const isElectron =
  typeof window !== "undefined" && !!window.electronAPI;

export const commands: Commands = isElectron
  ? createElectronAdapter()
  : createWebAdapter();

export const platform: Platform = isElectron
  ? createElectronPlatform()
  : createWebPlatform();
