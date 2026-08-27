/**
 * Daily Report · 分组与 Markdown / 纯文本渲染纯函数。
 *
 * - 三层分组：repo → module（feat / fix / perf …）→ date（YYYY-MM-DD）
 * - 渲染 Markdown 与纯文本两种格式，可直接复制 / 粘贴到企微 / 钉钉 / 邮件
 *
 * 三端共用，禁止 import 任何 node-only / browser-only API。
 */
import type {
  ReportEntry,
  ReportGroup,
  ReportKind,
  ReportOutputFormat,
} from "./types.js";

const MODULE_DISPLAY: Record<string, string> = {
  feat: "✨ 新功能",
  fix: "🐛 缺陷修复",
  perf: "⚡ 性能优化",
  refactor: "♻️ 重构",
  test: "✅ 测试",
  docs: "📝 文档",
  style: "💄 样式",
  build: "📦 构建",
  ci: "👷 CI",
  chore: "🔧 杂项",
  revert: "⏪ 回退",
  other: "📌 其它",
};

/** 把 ISO 时间转成 `YYYY-MM-DD`（按本地时区）。 */
function dateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown-date";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function groupBy<T, K extends string>(items: readonly T[], keyOf: (x: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}

const MODULE_ORDER = Object.keys(MODULE_DISPLAY);

function moduleIndex(m: string): number {
  const idx = MODULE_ORDER.indexOf(m);
  return idx === -1 ? MODULE_ORDER.length : idx;
}

function sortModuleKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ia = moduleIndex(a);
    const ib = moduleIndex(b);
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

function sortEntriesDesc(entries: readonly ReportEntry[]): ReportEntry[] {
  return [...entries].sort((x, y) => Date.parse(y.dateISO) - Date.parse(x.dateISO));
}

function dateLeaf(key: string, entries: readonly ReportEntry[]): ReportGroup {
  return {
    level: "date",
    key,
    entries: sortEntriesDesc(entries),
    children: [],
    count: entries.length,
  };
}

function moduleNode(
  key: string,
  entries: readonly ReportEntry[],
  nestDates: boolean
): ReportGroup {
  const children = nestDates ? dateNodes(entries) : [];
  return {
    level: "module",
    key,
    entries: nestDates ? [] : sortEntriesDesc(entries),
    children,
    count: entries.length,
  };
}

function dateNodes(entries: readonly ReportEntry[]): ReportGroup[] {
  const byDate = groupBy(entries, (e) => dateKey(e.dateISO));
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  return dates.map((d) => dateLeaf(d, byDate.get(d) ?? []));
}

function moduleNodes(entries: readonly ReportEntry[], nestDates: boolean): ReportGroup[] {
  const byModule = groupBy(entries, (e) => e.module || "other");
  return sortModuleKeys([...byModule.keys()]).map((mod) =>
    moduleNode(mod, byModule.get(mod) ?? [], nestDates)
  );
}

/**
 * 把扁平 entry 数组分成三层树。
 *
 * 排序约定：
 * - 仓库按 repoName 字典序
 * - module 按 MODULE_DISPLAY 预设顺序优先，未列出的按字典序排在末尾
 * - 日期按 ISO 倒序（最新在前）
 *
 * 日报：repo → module → date
 * 周报：repo → date → module
 */
export function buildReportTree(
  entries: readonly ReportEntry[],
  kind: ReportKind = "daily"
): ReportGroup[] {
  const byRepo = groupBy(entries, (e) => e.repoName as string);
  const repoNames = [...byRepo.keys()].sort((a, b) => a.localeCompare(b));

  return repoNames.map<ReportGroup>((repoName) => {
    const repoEntries = byRepo.get(repoName) ?? [];
    const children =
      kind === "weekly"
        ? dateNodesForWeekly(repoEntries)
        : moduleNodes(repoEntries, true);

    return {
      level: "repo",
      key: repoName,
      entries: [],
      children,
      count: repoEntries.length,
    };
  });
}

function dateNodesForWeekly(entries: readonly ReportEntry[]): ReportGroup[] {
  const byDate = groupBy(entries, (e) => dateKey(e.dateISO));
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  return dates.map((d) => {
    const dateEntries = byDate.get(d) ?? [];
    return {
      level: "date" as const,
      key: d,
      entries: [],
      children: moduleNodes(dateEntries, false),
      count: dateEntries.length,
    };
  });
}

function moduleLabel(mod: string): string {
  return MODULE_DISPLAY[mod] ?? `📌 ${mod}`;
}

function rangeTitleZh(rangeISO: { fromISO: string; toISO: string }): string {
  const from = dateKey(rangeISO.fromISO);
  const to = dateKey(rangeISO.toISO);
  return from === to ? from : `${from} ~ ${to}`;
}

const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function dateHeading(key: string, kind: ReportKind): string {
  if (kind !== "weekly") return key;
  const parts = key.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return key;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return key;
  return `${WEEKDAYS_ZH[date.getDay()]} ${key}`;
}

function defaultTitle(
  kind: ReportKind,
  rangeISO: { fromISO: string; toISO: string }
): string {
  const range = rangeTitleZh(rangeISO);
  return kind === "weekly" ? `工作周报（${range}）` : `工作日报（${range}）`;
}

function moduleCountSummary(entries: readonly ReportEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const k = e.module || "other";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([mod, n]) => `${mod} ${n}`)
    .join(" / ");
}

/**
 * 在日报明细中需要被过滤掉的 Git commit trailer token（大小写不敏感）。
 *
 * 这些都是「署名 / 审签 / Gerrit 变更 ID / 邮抄」等元数据，
 * 出现在日报正文里只会污染汇报内容（典型：`Co-authored-by: Cursor <…>`）。
 *
 * 列表参考 git interpret-trailers 中的常见 trailer 习惯用法；
 * `Fixes / Closes / Resolves / Refs` 等「issue 引用」类故意保留，
 * 因为它们对工作汇报是有信息量的（看得到改了哪个工单）。
 */
const SKIPPABLE_TRAILER_TOKENS = new Set<string>([
  "co-authored-by",
  "signed-off-by",
  "reviewed-by",
  "acked-by",
  "tested-by",
  "reported-by",
  "suggested-by",
  "helped-by",
  "cc",
  "change-id",
]);

/**
 * 判断给定行是否是应当从明细中剔除的 Git trailer。
 *
 * 规则：行形如 `Token: Value`（冒号后必须有非空内容），
 * Token 仅由字母 / 数字 / 连字符组成，且其小写形式落在跳过白名单。
 */
function isSkippableTrailer(line: string): boolean {
  const m = line.match(/^([A-Za-z][A-Za-z0-9-]*)\s*:\s*\S/);
  if (!m) return false;
  return SKIPPABLE_TRAILER_TOKENS.has(m[1].toLowerCase());
}

/**
 * 从 commit message 中提取"明细行"——subject 之后的 body 部分，
 * 去掉前后空行、tab、reset，单行去重保序；并跳过 Git 标准 trailer
 * （如 Co-authored-by / Signed-off-by），避免这些元数据混入日报正文。
 */
function extractDetailLines(message: string): string[] {
  const rawLines = message.split(/\r?\n/);
  if (rawLines.length <= 1) return [];
  // 跳过第一行（subject）
  const rest = rawLines.slice(1);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rest) {
    const line = raw.replace(/^[\s\t]+|[\s\t]+$/g, "");
    if (!line) continue;
    if (isSkippableTrailer(line)) continue;
    // 已有 markdown bullet 前缀的统一剥掉，由调用方再补
    const stripped = line.replace(/^[-*•·]\s+/, "").trim();
    if (!stripped) continue;
    // bullet 前缀剥掉之后再次检查是否为 trailer（防止「- Co-authored-by: …」绕过）
    if (isSkippableTrailer(stripped)) continue;
    if (seen.has(stripped)) continue;
    seen.add(stripped);
    out.push(stripped);
  }
  return out;
}

/**
 * 渲染单条 commit：
 * - subject 作为顶级 bullet（`- subject [`scope`]`）
 * - commit body 的明细行作为缩进 2 空格的子 bullet（`  - detail`）
 *
 * 这样 Markdown 源码与 Preview 同时呈现"工作项 + 子明细"层级感，
 * 与企微 / 钉钉 / GitHub 上的常见周报格式一致。
 */
function renderEntryBlockMd(entry: ReportEntry): string[] {
  const scope = entry.scope ? ` \`${entry.scope}\`` : "";
  const lines: string[] = [];
  lines.push(`- ${entry.subject}${scope}`);
  const details = extractDetailLines(entry.message);
  for (const d of details) lines.push(`  - ${d}`);
  return lines;
}

function renderEntryBlockPlain(entry: ReportEntry): string[] {
  const scope = entry.scope ? `（${entry.scope}）` : "";
  const lines: string[] = [];
  lines.push(`  ▸ ${entry.subject}${scope}`);
  const details = extractDetailLines(entry.message);
  for (const d of details) lines.push(`      • ${d}`);
  return lines;
}

type RenderMeta = {
  title?: string;
  rangeISO: { fromISO: string; toISO: string };
  totalCommits: number;
  kind?: ReportKind;
  moduleSummary?: string;
};

function renderGroupMd(group: ReportGroup, kind: ReportKind, lines: string[]): void {
  if (group.level === "repo") {
    lines.push(`## 📦 ${group.key}（${group.count} 条）`);
    lines.push("");
    for (const child of group.children) renderGroupMd(child, kind, lines);
    return;
  }
  if (group.level === "module") {
    lines.push(`### ${moduleLabel(group.key)}（${group.count} 条）`);
    lines.push("");
    if (group.entries.length > 0) {
      for (const entry of group.entries) lines.push(...renderEntryBlockMd(entry));
      lines.push("");
    }
    for (const child of group.children) renderGroupMd(child, kind, lines);
    return;
  }
  lines.push(`**${dateHeading(group.key, kind)}**`);
  lines.push("");
  if (group.entries.length > 0) {
    for (const entry of group.entries) lines.push(...renderEntryBlockMd(entry));
    lines.push("");
  }
  for (const child of group.children) renderGroupMd(child, kind, lines);
}

/**
 * 渲染 Markdown 报告。
 *
 * 日报结构：repo → module → date
 * 周报结构：repo → date → module，日期带周几。
 */
export function renderMarkdown(groups: readonly ReportGroup[], meta: RenderMeta): string {
  const kind = meta.kind ?? "daily";
  const lines: string[] = [];
  const title = meta.title ?? defaultTitle(kind, meta.rangeISO);
  lines.push(`# 📅 ${title}`);
  lines.push("");
  const summaryBits = [`共 **${meta.totalCommits}** 条提交`, `**${groups.length}** 个项目`];
  if (kind === "weekly" && meta.moduleSummary) summaryBits.push(meta.moduleSummary);
  lines.push(`> ${summaryBits.join(" · ")}`);
  lines.push("");

  for (const repo of groups) renderGroupMd(repo, kind, lines);

  return lines.join("\n").trimEnd() + "\n";
}

function renderGroupPlain(group: ReportGroup, kind: ReportKind, lines: string[], depth: number): void {
  const pad = "  ".repeat(depth);
  if (group.level === "repo") {
    lines.push(`${pad}【${group.key}】（${group.count} 条）`);
    for (const child of group.children) renderGroupPlain(child, kind, lines, depth + 1);
    return;
  }
  if (group.level === "module") {
    lines.push(`${pad}${moduleLabel(group.key)}（${group.count} 条）`);
    for (const entry of group.entries) lines.push(...renderEntryBlockPlain(entry));
    for (const child of group.children) renderGroupPlain(child, kind, lines, depth + 1);
    return;
  }
  lines.push(`${pad}${dateHeading(group.key, kind)}`);
  for (const entry of group.entries) lines.push(...renderEntryBlockPlain(entry));
  for (const child of group.children) renderGroupPlain(child, kind, lines, depth + 1);
}

/** 渲染纯文本报告。 */
export function renderPlain(groups: readonly ReportGroup[], meta: RenderMeta): string {
  const kind = meta.kind ?? "daily";
  const lines: string[] = [];
  const title = meta.title ?? defaultTitle(kind, meta.rangeISO);
  lines.push(title);
  const summaryBits = [`共 ${meta.totalCommits} 条提交`, `${groups.length} 个项目`];
  if (kind === "weekly" && meta.moduleSummary) summaryBits.push(meta.moduleSummary);
  lines.push(summaryBits.join(" / "));
  lines.push("");

  for (const repo of groups) {
    renderGroupPlain(repo, kind, lines, 0);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** 综合入口：分组 + 渲染。 */
export function buildAndRender(
  entries: readonly ReportEntry[],
  meta: {
    title?: string;
    rangeISO: { fromISO: string; toISO: string };
    format?: ReportOutputFormat;
    kind?: ReportKind;
  }
): { groups: ReportGroup[]; markdown: string; plain: string; totalCommits: number } {
  const kind = meta.kind ?? "daily";
  const groups = buildReportTree(entries, kind);
  const totalCommits = entries.length;
  const moduleSummary = kind === "weekly" ? moduleCountSummary(entries) : undefined;
  const renderMeta = { ...meta, totalCommits, kind, moduleSummary };
  const markdown = renderMarkdown(groups, renderMeta);
  const plain = renderPlain(groups, renderMeta);
  return { groups, markdown, plain, totalCommits };
}
