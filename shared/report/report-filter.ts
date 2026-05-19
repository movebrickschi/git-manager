/**
 * Daily Report · 过滤与去重纯函数。
 *
 * 输入：从 simple-git log 拿到的 raw 列表（已经包含 sha/message/author/email/parentCount …）。
 * 输出：按 ReportFilter 规则筛掉 merge / revert / 关键字 / 重复 message 的结果。
 *
 * 三端共用，禁止 import 任何 node-only / browser-only API。
 */
import type { ReportEntry, ReportFilter } from "./types.js";

/** 解析 commit message 的 conventional commits 前缀，得到 module / scope / subject。 */
export function parseConventional(message: string): {
  module: string;
  scope?: string;
  subject: string;
} {
  const firstLine = (message.split(/\r?\n/, 1)[0] ?? "").trim();
  // 形如 `feat(order)!: xxxxx`  或  `fix: xxx`
  const match = firstLine.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?!?:\s*(.*)$/);
  if (!match) {
    return { module: "other", subject: firstLine };
  }
  const [, type, scope, rest] = match;
  return {
    module: (type ?? "other").toLowerCase(),
    scope: scope?.trim() || undefined,
    subject: (rest ?? firstLine).trim() || firstLine,
  };
}

function inRange(entry: ReportEntry, filter: ReportFilter): boolean {
  const { range } = filter;
  if (range.preset !== "custom") return true; // 由 git log 阶段已限制
  if (!range.fromISO && !range.toISO) return true;
  const t = Date.parse(entry.dateISO);
  if (Number.isNaN(t)) return false;
  if (range.fromISO) {
    const from = Date.parse(range.fromISO);
    if (!Number.isNaN(from) && t < from) return false;
  }
  if (range.toISO) {
    const to = Date.parse(range.toISO);
    if (!Number.isNaN(to) && t > to) return false;
  }
  return true;
}

function isMerge(entry: ReportEntry): boolean {
  return entry.parentCount > 1;
}

function isRevert(entry: ReportEntry): boolean {
  return /^revert\b/i.test(entry.subject) || /^revert\b/i.test(entry.message);
}

function matchesKeyword(text: string, words: string[]): boolean {
  if (!words.length) return false;
  const lower = text.toLowerCase();
  return words.some((w) => w && lower.includes(w.toLowerCase()));
}

function authorMatches(entry: ReportEntry, authors: string[] | undefined): boolean {
  if (!authors || authors.length === 0) return true; // 调用方已用 git log --author 预筛
  if (authors.includes("*")) return true;
  const lowerSet = new Set(authors.map((a) => a.toLowerCase()));
  return lowerSet.has(entry.author.toLowerCase()) || lowerSet.has(entry.email.toLowerCase());
}

function branchMatches(entry: ReportEntry, branches: string[] | undefined): boolean {
  if (!branches || branches.length === 0) return true;
  if (branches.includes("--all")) return true;
  if (!entry.branch) return true; // git log 阶段已限制
  return branches.includes(entry.branch);
}

/**
 * 按 ReportFilter 过滤 + 去重。
 *
 * 顺序：range → merge → revert → include/exclude keyword → author → branch → message dedup。
 */
export function applyReportFilter(
  entries: readonly ReportEntry[],
  filter: ReportFilter
): ReportEntry[] {
  const seenSubjects = new Set<string>();
  const out: ReportEntry[] = [];

  for (const entry of entries) {
    if (!inRange(entry, filter)) continue;
    if (filter.excludeMerge && isMerge(entry)) continue;
    if (filter.excludeRevert && isRevert(entry)) continue;

    const includeWords = filter.includeKeywords ?? [];
    if (includeWords.length > 0 && !matchesKeyword(entry.message, includeWords)) continue;

    const excludeWords = filter.excludeKeywords ?? [];
    if (excludeWords.length > 0 && matchesKeyword(entry.message, excludeWords)) continue;

    if (!authorMatches(entry, filter.authors)) continue;
    if (!branchMatches(entry, filter.branches)) continue;

    if (filter.dedupMessage) {
      const key = `${entry.repo}::${entry.subject.toLowerCase()}`;
      if (seenSubjects.has(key)) continue;
      seenSubjects.add(key);
    }

    out.push(entry);
  }

  return out;
}

/** 将 entries 按时间倒序（最新在前）。 */
export function sortByDateDesc(entries: readonly ReportEntry[]): ReportEntry[] {
  return [...entries].sort((a, b) => {
    const ta = Date.parse(a.dateISO);
    const tb = Date.parse(b.dateISO);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
    return tb - ta;
  });
}

/**
 * 把 `ReportRangePreset` 转成具体 [fromISO, toISO]。
 *
 * 以"本机当前时刻"为基准；所有日期边界遵循"自然日 00:00:00 → 23:59:59.999"。
 *
 * @param now 注入"现在"以便测试；默认 `new Date()`。
 */
export function resolveRange(
  range: { preset: string; fromISO?: string; toISO?: string },
  now: Date = new Date()
): { fromISO: string; toISO: string } {
  if (range.preset === "custom") {
    return {
      fromISO: range.fromISO ?? startOfDay(now).toISOString(),
      toISO: range.toISO ?? endOfDay(now).toISOString(),
    };
  }

  const today = startOfDay(now);
  switch (range.preset) {
    case "today":
      return { fromISO: today.toISOString(), toISO: endOfDay(now).toISOString() };
    case "yesterday": {
      const y = addDays(today, -1);
      return { fromISO: y.toISOString(), toISO: endOfDayFromDate(y).toISOString() };
    }
    case "this-week": {
      const monday = startOfWeekMonday(today);
      return { fromISO: monday.toISOString(), toISO: endOfDay(now).toISOString() };
    }
    case "last-week": {
      const thisMon = startOfWeekMonday(today);
      const lastMon = addDays(thisMon, -7);
      const lastSun = endOfDayFromDate(addDays(thisMon, -1));
      return { fromISO: lastMon.toISOString(), toISO: lastSun.toISOString() };
    }
    case "this-month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { fromISO: first.toISOString(), toISO: endOfDay(now).toISOString() };
    }
    case "last-month": {
      const firstThis = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const firstLast = new Date(firstThis.getFullYear(), firstThis.getMonth() - 1, 1, 0, 0, 0, 0);
      const lastDayLast = new Date(firstThis.getTime() - 1);
      return { fromISO: firstLast.toISOString(), toISO: lastDayLast.toISOString() };
    }
    default:
      return { fromISO: today.toISOString(), toISO: endOfDay(now).toISOString() };
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function endOfDayFromDate(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() + n);
  return r;
}

/** ISO 工作日：周一 = 1，周日 = 7。 */
function startOfWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day; // 调到本周一
  return addDays(d, diff);
}
