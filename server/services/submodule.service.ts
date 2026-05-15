import { getGit } from "./_helpers.js";
import type { Submodule } from "../git-service.js";

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
  async getSubmodules(repoPath: string): Promise<Submodule[]> {
    const git = getGit(repoPath);
    let raw: string;
    try {
      raw = await git.raw(["submodule", "status"]);
    } catch {
      return [];
    }
    const list = parseStatus(raw);
    return fillUrls(repoPath, list);
  },

  async initSubmodules(repoPath: string, paths?: string[]): Promise<void> {
    const git = getGit(repoPath);
    const args = ["submodule", "init"];
    if (paths && paths.length > 0) args.push("--", ...paths);
    await git.raw(args);
  },

  async updateSubmodules(repoPath: string, paths?: string[]): Promise<void> {
    const git = getGit(repoPath);
    const args = ["submodule", "update", "--init", "--recursive"];
    if (paths && paths.length > 0) args.push("--", ...paths);
    await git.raw(args);
  },

  async syncSubmodules(repoPath: string, paths?: string[]): Promise<void> {
    const git = getGit(repoPath);
    const args = ["submodule", "sync", "--recursive"];
    if (paths && paths.length > 0) args.push("--", ...paths);
    await git.raw(args);
  },
};
