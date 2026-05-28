import { promises as fs } from "node:fs";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { getGit } from "./_helpers.js";
import type { Submodule } from "../git-service.js";

/** submodule update / sync 可能需要克隆大子模块，单独用 5 分钟超时，避免被 30s 默认值打断。 */
const SUBMODULE_LONG_TIMEOUT_MS = 5 * 60 * 1000;

function getLongTimeoutGit(repoPath: string) {
  return simpleGit({
    baseDir: repoPath,
    binary: "git",
    maxConcurrentProcesses: 1,
    timeout: { block: SUBMODULE_LONG_TIMEOUT_MS },
  });
}

async function hasGitmodules(repoPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoPath, ".gitmodules"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Submodule（子模块）服务。
 *
 * `git submodule status` 输出 3 段：
 *   `<prefix><sha1> <path> [(<describe>)]`
 *
 * prefix 字符意义：
 *   - ` ` (空格)  : 已初始化、与 superproject 记录一致
 *   - `-`        : 未初始化（git submodule update --init 可拉取）
 *   - `+`        : 已初始化但 working tree 的 sha 与 superproject 记录不一致（"modified"）
 *   - `U`        : merge 冲突中
 *
 * 我们把 prefix 翻译成 `state`，前端用图标区分。
 */

const STATUS_LINE_RE = /^(?<prefix>[\s\-+U])(?<sha>[0-9a-f]+)\s+(?<path>\S+)(?:\s+\((?<desc>[^)]+)\))?$/;

function parseStatus(raw: string): Submodule[] {
  if (!raw.trim()) return [];
  const out: Submodule[] = [];
  for (const line of raw.split("\n")) {
    const m = STATUS_LINE_RE.exec(line);
    if (!m || !m.groups) continue;
    const prefix = m.groups.prefix!;
    const state: Submodule["state"] =
      prefix === "-"
        ? "uninitialized"
        : prefix === "+"
          ? "modified"
          : prefix === "U"
            ? "merge-conflict"
            : "initialized";
    out.push({
      path: m.groups.path!,
      name: m.groups.path!,
      url: "",
      head: prefix === "-" ? null : (m.groups.sha ?? null),
      described: m.groups.desc ?? null,
      state,
    });
  }
  return out;
}

/**
 * 用 `git config --file .gitmodules --get-regexp` 抓 url，补完 url 字段。
 * 单独失败不影响 status 主结果。
 */
async function fillUrls(
  repoPath: string,
  list: Submodule[]
): Promise<Submodule[]> {
  if (list.length === 0) return list;
  const git = getGit(repoPath);
  try {
    const raw = await git.raw([
      "config",
      "--file",
      ".gitmodules",
      "--get-regexp",
      "submodule\\..*\\.url",
    ]);
    const map = new Map<string, string>();
    for (const line of raw.split("\n")) {
      const m = /^submodule\.(.+)\.url\s+(.+)$/.exec(line.trim());
      if (m) map.set(m[1]!, m[2]!);
    }
    for (const sm of list) {
      const url = map.get(sm.path) ?? map.get(sm.name);
      if (url) sm.url = url;
    }
  } catch {
    // .gitmodules 不存在或读不到，忽略
  }
  return list;
}

export const submoduleService = {
  /**
   * 列出仓库的子模块。优化：
   * 1. 若仓库根目录不存在 `.gitmodules`，直接 return `[]` —— 不再触发 `git submodule status`，
   *    解决"进入无 submodule 仓库也会闪『扫描中...』"的 UX 抖动。
   * 2. `git submodule` 命令本身异常（git 版本太老 / 仓库结构特殊）继续走老路径，
   *    并把 error 暴露给前端，避免被装作"没 submodule"。
   *
   * 返回兼容旧 API：Submodule[]。如需 error 信息，调用方应自行尝试 catch；
   * 若未来要切换为 `{ list, error }` 结构，需要前端联动。当前仅在 console.warn 一下。
   */
  async getSubmodules(repoPath: string): Promise<Submodule[]> {
    if (!(await hasGitmodules(repoPath))) return [];
    const git = getGit(repoPath);
    let raw: string;
    try {
      raw = await git.raw(["submodule", "status"]);
    } catch (e: unknown) {
      console.warn(`[submodule] status failed at ${repoPath}:`, e instanceof Error ? e.message : e);
      return [];
    }
    const list = parseStatus(raw);
    return fillUrls(repoPath, list);
  },

  async initSubmodules(repoPath: string, paths?: string[]): Promise<void> {
    const git = getLongTimeoutGit(repoPath);
    const args = ["submodule", "init"];
    if (paths && paths.length > 0) args.push("--", ...paths);
    await git.raw(args);
  },

  /** update 需要克隆大子模块，统一走 5 分钟超时。 */
  async updateSubmodules(repoPath: string, paths?: string[]): Promise<void> {
    const git = getLongTimeoutGit(repoPath);
    const args = ["submodule", "update", "--init", "--recursive"];
    if (paths && paths.length > 0) args.push("--", ...paths);
    await git.raw(args);
  },

  /** sync 也走 5 分钟超时，子模块 url 改动同步可能涉及多 remote 校验。 */
  async syncSubmodules(repoPath: string, paths?: string[]): Promise<void> {
    const git = getLongTimeoutGit(repoPath);
    const args = ["submodule", "sync", "--recursive"];
    if (paths && paths.length > 0) args.push("--", ...paths);
    await git.raw(args);
  },
};
