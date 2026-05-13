import { simpleGit, type SimpleGit } from "simple-git";
import type {
  FileStatus,
  DiffResultModel,
  DiffHunk,
  RefInfo,
} from "../git-service.js";

export const GIT_TIMEOUT_MS = 30_000;

const NON_RETRYABLE_PATTERNS = [
  /authentication/i,
  /permission denied/i,
  /non-fast-forward/i,
  /conflict/i,
  /path traversal/i,
  /not a git repository/i,
];

const RETRYABLE_PATTERNS = [
  /network/i,
  /timeout|timed out/i,
  /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i,
  /temporarily/i,
  /could not resolve/i,
  /unable to access/i,
  /server side error|service unavailable/i,
];

export function shouldRetry(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (NON_RETRYABLE_PATTERNS.some((p) => p.test(msg))) return false;
  return RETRYABLE_PATTERNS.some((p) => p.test(msg));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; baseMs?: number; label?: string } = {}
): Promise<T> {
  const tries = opts.tries ?? 3;
  const base = opts.baseMs ?? 500;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === tries - 1 || !shouldRetry(e)) throw e;
      const delay = base * 2 ** i + Math.random() * base;
      console.warn(
        `[withRetry] ${opts.label ?? "op"} attempt ${i + 1}/${tries} failed: ${errStr(e)} ; retry in ${Math.round(delay)}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export function errStr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}

export function getGit(repoPath: string): SimpleGit {
  return simpleGit({
    baseDir: repoPath,
    binary: "git",
    maxConcurrentProcesses: 6,
    timeout: { block: GIT_TIMEOUT_MS },
  });
}

export function parseStatusCode(
  x: string,
  y: string
): { status: FileStatus["status"]; staged: boolean }[] {
  const results: { status: FileStatus["status"]; staged: boolean }[] = [];

  if (x === "?" && y === "?") {
    results.push({ status: "untracked", staged: false });
    return results;
  }

  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
    results.push({ status: "conflicted", staged: false });
    return results;
  }

  if (y === "!") {
    results.push({ status: "modified", staged: false });
    return results;
  }

  const mapCode = (c: string): FileStatus["status"] | null => {
    switch (c) {
      case "A":
        return "added";
      case "M":
        return "modified";
      case "D":
        return "deleted";
      case "R":
        return "renamed";
      case "C":
        return "copied";
      case "!":
        return "modified";
      default:
        return null;
    }
  };

  if (x && x !== " " && x !== "?") {
    const s = mapCode(x);
    results.push({ status: s ?? "modified", staged: true });
  }

  if (y && y !== " " && y !== "?" && y !== "!") {
    const s = mapCode(y);
    results.push({ status: s ?? "modified", staged: false });
  }

  return results;
}

export function parseDiffOutput(raw: string, filePath?: string): DiffResultModel {
  const result: DiffResultModel = {
    oldPath: null,
    newPath: null,
    hunks: [],
    binary: false,
    oldContent: null,
    newContent: null,
  };

  if (raw.includes("Binary files")) {
    result.binary = true;
    return result;
  }

  const lines = raw.split("\n");
  let currentHunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      const p = line.substring(4);
      result.oldPath = p === "/dev/null" ? null : p.replace(/^[ab]\//, "");
    } else if (line.startsWith("+++ ")) {
      const p = line.substring(4);
      result.newPath = p === "/dev/null" ? null : p.replace(/^[ab]\//, "");
    } else if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1]!),
          oldLines: parseInt(match[2] ?? "1"),
          newStart: parseInt(match[3]!),
          newLines: parseInt(match[4] ?? "1"),
          header: match[5]?.trim() ?? "",
          lines: [],
        };
        oldLineNo = currentHunk.oldStart;
        newLineNo = currentHunk.newStart;
        result.hunks.push(currentHunk);
      }
    } else if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({
          lineType: "addition",
          content: line.substring(1),
          oldLineNo: null,
          newLineNo: newLineNo++,
        });
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          lineType: "deletion",
          content: line.substring(1),
          oldLineNo: oldLineNo++,
          newLineNo: null,
        });
      } else if (line.startsWith(" ") || line === "") {
        currentHunk.lines.push({
          lineType: "context",
          content: line.startsWith(" ") ? line.substring(1) : line,
          oldLineNo: oldLineNo++,
          newLineNo: newLineNo++,
        });
      }
    }
  }

  if (!result.oldPath && !result.newPath && filePath) {
    result.newPath = filePath;
  }

  return result;
}

export function parseRefs(refStr: string, headBranch: string): RefInfo[] {
  if (!refStr) return [];
  return refStr
    .replace(/[()]/g, "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      if (r.startsWith("HEAD -> ")) {
        return {
          name: r.replace("HEAD -> ", ""),
          refType: "head" as const,
          isHead: true,
        };
      }
      if (r.startsWith("tag: ")) {
        return {
          name: r.replace("tag: ", ""),
          refType: "tag" as const,
          isHead: false,
        };
      }
      if (r.includes("/")) {
        return { name: r, refType: "remote" as const, isHead: false };
      }
      return {
        name: r,
        refType: "local" as const,
        isHead: r === headBranch,
      };
    });
}

/** 解析 `git branch -vv` 中 label 里 `[upstream: ahead n, behind m] subject` 片段 */
export function parseBranchVerboseLabel(label: string): {
  upstream: string | null;
  aheadBehind: [number, number] | null;
  subject: string;
} {
  const trimmed = label.trim();
  const bracket = /^\[([^\]]*)\]\s*(.*)$/s.exec(trimmed);
  if (!bracket) {
    return { upstream: null, aheadBehind: null, subject: trimmed };
  }
  const inside = bracket[1]!;
  const subject = bracket[2]!.trim();
  const colon = inside.indexOf(":");
  const upstreamPart = (colon >= 0 ? inside.slice(0, colon) : inside).trim();
  let upstream: string | null = null;
  if (upstreamPart && upstreamPart !== "gone") {
    upstream = upstreamPart;
  }
  const aheadM = /ahead (\d+)/.exec(inside);
  const behindM = /behind (\d+)/.exec(inside);
  const ahead = aheadM ? parseInt(aheadM[1]!, 10) : 0;
  const behind = behindM ? parseInt(behindM[1]!, 10) : 0;
  const aheadBehind: [number, number] | null = ahead || behind ? [ahead, behind] : null;
  return { upstream, aheadBehind, subject: subject || trimmed };
}

export const FILE_STATUS_MAP: Record<string, FileStatus["status"]> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
};

/** 解析 `git diff --name-status` / `diff-tree --name-status` 输出为 FileStatus[] */
export function parseNameStatus(raw: string): FileStatus[] {
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const code = parts[0]?.[0] ?? "M";
      const fp = parts.length >= 3 ? parts[2]! : parts[1]!;
      const oldP = parts.length >= 3 ? parts[1]! : null;
      return {
        path: fp ?? "",
        oldPath: oldP,
        status: FILE_STATUS_MAP[code] ?? "modified",
        staged: false,
      };
    })
    .filter((f) => f.path);
}

/** 跨 service 的小工具：取出当前冲突文件列表 */
export async function getConflictFiles(repoPath: string): Promise<string[]> {
  const git = getGit(repoPath);
  const status = await git.status();
  return status.conflicted;
}

export const LOG_FORMAT = [
  "%H",
  "%h",
  "%s",
  "%an",
  "%ae",
  "%at",
  "%cn",
  "%ce",
  "%ct",
  "%P",
  "%D",
].join("%x00");
