import { simpleGit } from "simple-git";
import { promises as fs } from "node:fs";
import * as path from "path";
import type { RepoOpenResult } from "../git-service.js";
import { getGit, withRetry, GIT_TIMEOUT_MS } from "./_helpers.js";

/**
 * 在日志/错误消息里隐藏 URL 中的 user:pass / token，避免落盘泄露。
 * 处理两类常见格式：
 *   https://user:token@host/...      → https://***@host/...
 *   git+ssh://user@host:port/...     → 保留（ssh 通常用 key，url 里无 secret）
 *   https://oauth2:GITHUB_TOKEN@...  → https://***@...
 */
export function redactUrl(input: string): string {
  if (typeof input !== "string") return String(input);
  return input.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/gi, "$1***@");
}

export const repoService = {
  async openRepo(repoPath: string): Promise<RepoOpenResult> {
    if (typeof repoPath !== "string" || repoPath.trim().length === 0) {
      throw new Error("INVALID_PATH: 仓库路径不能为空");
    }
    const trimmed = repoPath.trim();

    // 预检：路径是否存在。simple-git 自带的报错是英文且不够友好。
    try {
      const stat = await fs.stat(trimmed);
      if (!stat.isDirectory()) {
        throw new Error(`INVALID_PATH: 不是目录：${trimmed}`);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith("INVALID_PATH")) throw e;
      const err = new Error(`REPO_NOT_FOUND: 路径不存在或不可访问：${trimmed}`);
      (err as Error & { cause?: unknown }).cause = e;
      throw err;
    }

    const git = getGit(trimmed);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) throw new Error(`Not a git repository: ${trimmed}`);
    const rootPath = (await git.revparse(["--show-toplevel"])).trim();
    const rootGit = getGit(rootPath);
    const branchSummary = await rootGit.branch();

    // detached HEAD 下 branchSummary.current 的实际值因 simple-git 版本而异：
    //  - 部分版本：返回空字符串
    //  - 部分版本：返回 7-40 位 short/full sha
    // 都是 detached，需要统一包装成 `(HEAD: sha)` 让前端不会把 sha 误显示为分支名。
    let currentBranch = branchSummary.current;
    const looksLikeBareSha = !!currentBranch && /^[a-f0-9]{7,40}$/i.test(currentBranch);
    if (!currentBranch || looksLikeBareSha) {
      try {
        const sha = (await rootGit.revparse(["--short", "HEAD"])).trim();
        if (sha) currentBranch = `(HEAD: ${sha})`;
      } catch {
        // unborn 仓库（无任何 commit）连 HEAD 都没有，保持原值（可能为空字符串）
      }
    }

    return {
      path: rootPath,
      name: path.basename(rootPath),
      currentBranch,
    };
  },

  async cloneRepo(url: string, targetPath: string): Promise<void> {
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error("INVALID_URL: clone url 不能为空");
    }
    if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
      throw new Error("INVALID_PATH: target 路径不能为空");
    }
    const target = targetPath.trim();

    // 预检 target：如果存在且是非空目录 → 给出明确错误（git 自身错误是英文）；
    // 不存在则交给 simple-git 创建。
    try {
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) {
        throw new Error(`INVALID_PATH: target 已存在但不是目录：${target}`);
      }
      const entries = await fs.readdir(target);
      if (entries.length > 0) {
        throw new Error(`PATH_NOT_EMPTY: target 目录非空（${entries.length} 个文件），refused to clone into it`);
      }
    } catch (e: unknown) {
      if (e instanceof Error && (e.message.startsWith("INVALID_PATH") || e.message.startsWith("PATH_NOT_EMPTY"))) {
        throw e;
      }
      // ENOENT 即 target 不存在，simple-git 会自行创建
    }

    const git = simpleGit({
      binary: "git",
      maxConcurrentProcesses: 1,
      timeout: { block: GIT_TIMEOUT_MS * 4 },
    });
    try {
      await withRetry(() => git.clone(url.trim(), target), {
        tries: 3,
        baseMs: 1000,
        label: `clone ${redactUrl(url)}`,
      });
    } catch (e: unknown) {
      // 把可能含 token 的 url 从异常 message 里也 redact 掉，防止经 IPC/HTTP 透传给前端
      if (e instanceof Error) {
        e.message = redactUrl(e.message);
      }
      throw e;
    }
  },
};
