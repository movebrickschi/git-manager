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

/**
 * 把扁平 entry 数组分成三层树。
 *
 * 排序约定：
 * - 仓库按 repoName 字典序
 * - module 按 MODULE_DISPLAY 预设顺序优先，未列出的按字典序排在末尾
 * - 日期按 ISO 倒序（最新在前）
 */
export function buildReportTree(entries: readonly ReportEntry[]): ReportGroup[] {
  const byRepo = groupBy(entries, (e) => e.repoName as string);
  const repoNames = [...byRepo.keys()].sort((a, b) => a.localeCompare(b));

  const moduleOrder = Object.keys(MODULE_DISPLAY);
  const moduleIndex = (m: string): number => {
    const idx = moduleOrder.indexOf(m);
    return idx === -1 ? moduleOrder.length : idx;
  };

  return repoNames.map<ReportGroup>((repoName) => {
    const repoEntries = byRepo.get(repoName) ?? [];
    const byModule = groupBy(repoEntries, (e) => e.module || "other");
    const modules = [...byModule.keys()].sort((a, b) => {
      const ia = moduleIndex(a);
      const ib = moduleIndex(b);
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    });

    const moduleChildren: ReportGroup[] = modules.map((mod) => {
      const modEntries = byModule.get(mod) ?? [];
      const byDate = groupBy(modEntries, (e) => dateKey(e.dateISO));
      const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
      const dateChildren: ReportGroup[] = dates.map((d) => {
        const dateEntries = byDate.get(d) ?? [];
        return {
          level: "date",
          key: d,
          entries: [...dateEntries].sort(
            (x, y) => Date.parse(y.dateISO) - Date.parse(x.dateISO)
          ),
          children: [],
          count: dateEntries.length,
        };
      });

      return {
        level: "module",
        key: mod,
        entries: [],
        children: dateChildren,
        count: modEntries.length,
      };
    });

    return {
      level: "repo",
      key: repoName,
      entries: [],
      children: moduleChildren,
      count: repoEntries.length,
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

/**
 * 从 commit message 中提取"明细行"——subject 之后的 body 部分，
 * 去掉前后空行、tab、reset，单行去重保序。
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
    // 已有 markdown bullet 前缀的统一剥掉，由调用方再补
    const stripped = line.replace(/^[-*•·]\s+/, "").trim();
    if (!stripped) continue;
    if (seen.has(stripped)) continue;
    seen.add(stripped);
    out.push(stripped);
  }
  return out;
}

/** 渲染单条 commit：subject 作为 commit 标题块，body 行展开为 bullet。 */
function renderEntryBlockMd(entry: ReportEntry): string[] {
  const scope = entry.scope ? ` \`${entry.scope}\`` : "";
  const lines: string[] = [];
  lines.push(`#### ${entry.subject}${scope}`);
  const details = extractDetailLines(entry.message);
  for (const d of details) lines.push(`- ${d}`);
  lines.push("");
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

/**
 * 渲染 Markdown 报告。
 *
 * 结构：
 * ```
 * # 工作日报（{title}）
 *
 * 共 {N} 条提交 · {M} 个项目
 *
 * ## 📦 {repoName}（{count} 条）
 *
 * ### ✨ 新功能（feat · {count} 条）
 *
 * #### {YYYY-MM-DD}
 *   - `shortSha` feat(scope): subject _by Author_
 * ```
 */
export function renderMarkdown(
  groups: readonly ReportGroup[],
  meta: { title?: string; rangeISO: { fromISO: string; toISO: string }; totalCommits: number }
): string {
  const lines: string[] = [];
  const title = meta.title ?? `工作日报（${rangeTitleZh(meta.rangeISO)}）`;
  lines.push(`# 📅 ${title}`);
  lines.push("");
  lines.push(`> 共 **${meta.totalCommits}** 条提交 · **${groups.length}** 个项目`);
  lines.push("");

  for (const repo of groups) {
    lines.push(`## 📦 ${repo.key}（${repo.count} 条）`);
    lines.push("");
    for (const mod of repo.children) {
      lines.push(`### ${moduleLabel(mod.key)}（${mod.count} 条）`);
      lines.push("");
      for (const date of mod.children) {
        lines.push(`**${date.key}**`);
        lines.push("");
        for (const entry of date.entries) {
          lines.push(...renderEntryBlockMd(entry));
        }
      }
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** 渲染纯文本报告。 */
export function renderPlain(
  groups: readonly ReportGroup[],
  meta: { title?: string; rangeISO: { fromISO: string; toISO: string }; totalCommits: number }
): string {
  const lines: string[] = [];
  const title = meta.title ?? `工作日报（${rangeTitleZh(meta.rangeISO)}）`;
  lines.push(title);
  lines.push(`共 ${meta.totalCommits} 条提交 / ${groups.length} 个项目`);
  lines.push("");

  for (const repo of groups) {
    lines.push(`【${repo.key}】（${repo.count} 条）`);
    for (const mod of repo.children) {
      lines.push(`  ${moduleLabel(mod.key)}（${mod.count} 条）`);
      for (const date of mod.children) {
        lines.push(`    ${date.key}`);
        for (const entry of date.entries) {
          lines.push(...renderEntryBlockPlain(entry));
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** 综合入口：分组 + 渲染。 */
export function buildAndRender(
  entries: readonly ReportEntry[],
  meta: { title?: string; rangeISO: { fromISO: string; toISO: string }; format?: ReportOutputFormat }
): { groups: ReportGroup[]; markdown: string; plain: string; totalCommits: number } {
  const groups = buildReportTree(entries);
  const totalCommits = entries.length;
  const markdown = renderMarkdown(groups, { ...meta, totalCommits });
  const plain = renderPlain(groups, { ...meta, totalCommits });
  return { groups, markdown, plain, totalCommits };
}
