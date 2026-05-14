/**
 * 牌 B 兑底：对超大 diff 做逐文件截断，保证不会让 AI 因上下文超长拒绝/超时。
 *
 * 1. 总长 ≤ maxChars 直接返回原 diff，degraded=false
 * 2. 第一级降级：按 `diff --git` 拆为文件块，每块保留前 100 行（含 hunk header）
 * 3. 第二级降级：若 stage 1 仍超限，退化为 `path: +adds -dels` 摘要
 *
 * 纯函数，零 IO，可被任何端 import。
 */

export interface TruncationResult {
  truncated: string;
  fileSummary: string;
  degraded: boolean;
}

const FILE_HEADER_RE = /^diff --git /;
const HUNK_HEADER_RE = /^@@/;
const KEEP_LINES_PER_FILE = 100;

interface FileBlock {
  path: string;
  lines: string[];
  adds: number;
  dels: number;
}

function splitByFile(diff: string): FileBlock[] {
  if (!diff.trim()) return [];
  const lines = diff.split(/\r?\n/);
  const out: FileBlock[] = [];
  let cur: FileBlock | null = null;
  for (const line of lines) {
    if (FILE_HEADER_RE.test(line)) {
      if (cur) out.push(cur);
      const m = /^diff --git a\/(.+?) b\/(.+?)$/.exec(line);
      const path = m?.[2] ?? m?.[1] ?? "?";
      cur = { path, lines: [line], adds: 0, dels: 0 };
      continue;
    }
    if (!cur) continue;
    cur.lines.push(line);
    if (HUNK_HEADER_RE.test(line)) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) cur.adds++;
    else if (line.startsWith("-") && !line.startsWith("---")) cur.dels++;
  }
  if (cur) out.push(cur);
  return out;
}

function buildFileSummary(files: FileBlock[]): string {
  if (files.length === 0) return "无文件改动";
  const head = `${files.length} 个文件改动`;
  const SHOW = 30;
  const list = files
    .slice(0, SHOW)
    .map((f) => `${f.path} (+${f.adds} -${f.dels})`)
    .join("; ");
  const more = files.length > SHOW ? ` …（仅展示前 ${SHOW} 个）` : "";
  return `${head}：${list}${more}`;
}

export function truncateDiff(diff: string, maxChars: number): TruncationResult {
  if (!diff || diff.length <= maxChars) {
    const files = splitByFile(diff);
    return { truncated: diff, fileSummary: buildFileSummary(files), degraded: false };
  }
  const files = splitByFile(diff);
  const fileSummary = buildFileSummary(files);

  const stage1Parts: string[] = [];
  for (const f of files) {
    const kept = f.lines.slice(0, KEEP_LINES_PER_FILE);
    if (kept.length < f.lines.length) {
      kept.push(`... (truncated, original ${f.lines.length} lines, +${f.adds} -${f.dels})`);
    }
    stage1Parts.push(kept.join("\n"));
  }
  const stage1 = stage1Parts.join("\n");
  if (stage1.length <= maxChars) {
    return { truncated: stage1, fileSummary, degraded: true };
  }

  const stage2 = files.map((f) => `${f.path}: +${f.adds} -${f.dels}`).join("\n");
  return { truncated: stage2, fileSummary, degraded: true };
}
