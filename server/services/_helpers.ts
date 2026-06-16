import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { simpleGit, type SimpleGit } from "simple-git";

const execFile = promisify(execFileCb);
import type {
  FileStatus,
  DiffResultModel,
  DiffHunk,
  RefInfo,
} from "../git-service.js";

/**
 * 关闭 git 的「终端交互式凭据询问」。
 *
 * 桌面 GUI 与 Express 后端都没有可用的控制终端（TTY）。当某次 fetch / pull / push
 * 缺少凭据、且没有可用的 credential.helper 时，git 默认会回退到在终端里 prompt
 * `Username/Password`，子进程因读不到输入而长时间阻塞——直到 simple-git 的 block
 * 超时（REMOTE_GIT_TIMEOUT_MS = 120s）才把它杀掉。这正是「推送中…」假死的根因。
 *
 * 更严重的连锁反应：同一仓库的所有 git 命令共享一条串行队列（见 getOrCreateGit），
 * 这条卡死的联网命令会一直占着唯一的队列槽，导致随后的本地恢复命令
 * （rebase --continue / --abort、merge --abort 等）排在队尾迟迟无法执行——
 * 用户在 Rebase 状态栏点 Continue / Abort「毫无反应」。
 *
 * 设为 "0" 后：缺凭据会**立刻失败**并抛出可读的鉴权错误，串行队列随即释放，
 * 恢复命令能正常执行。这不会削弱任何**可用**的鉴权路径——GUI 下本就无法用终端
 * prompt 完成鉴权（那条路径只会卡死），正常鉴权依赖 credential.helper（如
 * Git Credential Manager）或 SSH 密钥，二者均不受此开关影响。
 *
 * 仅在未显式设置时写入，尊重高级用户的环境覆盖。
 */
if (!process.env.GIT_TERMINAL_PROMPT) {
  process.env.GIT_TERMINAL_PROMPT = "0";
}

/**
 * 历史上的「本地命令」block 超时基数（毫秒）。
 *
 * 自从同一仓库的本地 + 联网命令合并为一个共享串行实例后，缓存实例统一使用
 * REMOTE_GIT_TIMEOUT_MS（见 getOrCreateGit），此常量不再用于 getGit 实例本身，
 * 仅保留作为：① repo.service clone 的超时基数（GIT_TIMEOUT_MS * 4）；
 * ② git-timeout.test 的对比基准。
 */
export const GIT_TIMEOUT_MS = 30_000;

/**
 * 缓存 SimpleGit 实例统一使用的 block 超时（毫秒）。
 *
 * simple-git 的 timeout.block 语义是「子进程连续 N 毫秒没有任何 stdout/stderr
 * 输出就 kill 掉并抛 `block timeout reached`」。本地命令正常秒级返回，120s 对其
 * 无副作用；而 fetch / pull / push 在认证等待、SSH/TLS 握手、慢网或代理、远端
 * counting objects 等阶段长时间无输出是正常现象，30s 会把进程误杀，故统一放宽到
 * 120s（与 repo.service 的 clone 一致），既给足联网时间，又保留「彻底卡死」时的
 * 兜底 kill，避免无限挂起。
 */
export const REMOTE_GIT_TIMEOUT_MS = 120_000;

/**
 * 单个 untracked 文件 diff 的合成阈值（字节）。
 * 超过该阈值视为大文件，不读全文，只回 1 行占位说明，避免把内存打爆。
 */
export const UNTRACKED_DIFF_MAX_BYTES = 1024 * 1024;

/**
 * 二进制嗅探：原先只扫前 8 KB，会把"前 8 KB 合法 ASCII + 后段含 NUL"的文件
 * 误判为文本（典型：损坏的 .po / .csv / .pdf 误存为 .txt）。改为全量扫一遍，
 * 1 MB 文件成本只在 ms 级，与 git 自身 "Binary files ... differ" 的判定行为一致。
 */
const BINARY_SNIFF_BYTES = Number.POSITIVE_INFINITY;

/**
 * 尝试把任意 Buffer 智能解码为文本。
 *
 * 重要性：Windows PowerShell 默认的 `>` / `Out-File` 写出来的 .txt 文件是
 * UTF-16 LE 编码，每个 ASCII 字符后跟一个 0x00 字节。如果只看 NUL 字节就
 * 判定二进制，所有 PowerShell 重定向产生的日志都会被前端拒绝显示，体感是
 * "明明是 .txt 文件却说是 Binary"。
 *
 * 识别顺序（命中即返回，不再判定 binary）：
 *   1. UTF-16 LE BOM (FF FE)
 *   2. UTF-16 BE BOM (FE FF)
 *   3. UTF-8 BOM   (EF BB BF)
 *   4. 启发式 UTF-16 LE 无 BOM（PowerShell 默认 "Unicode" 编码即此）
 *   5. 启发式 UTF-16 BE 无 BOM
 *   6. NUL 检测 → 视为真二进制（图片 / 可执行文件等）
 *   7. 否则按 UTF-8 解码
 *
 * 返回 `text === null` 表示真二进制，调用方应走 "Binary files differ" 路径。
 */
export function decodeBufferToText(buf: Buffer): { text: string | null; encoding: string } {
  if (buf.length === 0) return { text: "", encoding: "empty" };

  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.subarray(2).toString("utf16le"), encoding: "utf-16le-bom" };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: swapBytesAndDecodeUtf16(buf, 2), encoding: "utf-16be-bom" };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString("utf8"), encoding: "utf-8-bom" };
  }

  const sniff = Math.min(buf.length, 256);
  if (sniff >= 4) {
    let zerosAtOdd = 0;
    let zerosAtEven = 0;
    let nonZero = 0;
    for (let i = 0; i < sniff; i++) {
      if (buf[i] === 0) {
        if (i & 1) zerosAtOdd++;
        else zerosAtEven++;
      } else {
        nonZero++;
      }
    }
    const quarter = Math.floor(sniff / 4);
    if (zerosAtOdd >= quarter && zerosAtEven === 0 && nonZero > 0) {
      return { text: buf.toString("utf16le"), encoding: "utf-16le-guess" };
    }
    if (zerosAtEven >= quarter && zerosAtOdd === 0 && nonZero > 0) {
      return { text: swapBytesAndDecodeUtf16(buf, 0), encoding: "utf-16be-guess" };
    }
  }

  const sniffEnd = Number.isFinite(BINARY_SNIFF_BYTES)
    ? Math.min(buf.length, BINARY_SNIFF_BYTES)
    : buf.length;
  for (let i = 0; i < sniffEnd; i++) {
    if (buf[i] === 0) return { text: null, encoding: "binary" };
  }

  return { text: buf.toString("utf8"), encoding: "utf-8" };
}

function swapBytesAndDecodeUtf16(buf: Buffer, start: number): string {
  const len = buf.length - start;
  const evenLen = len - (len % 2);
  if (evenLen <= 0) return "";
  const swapped = Buffer.alloc(evenLen);
  for (let i = 0; i < evenLen; i += 2) {
    swapped[i] = buf[start + i + 1] ?? 0;
    swapped[i + 1] = buf[start + i] ?? 0;
  }
  return swapped.toString("utf16le");
}

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
  // index.lock / ref lock 冲突：消除应用自身并发（共享串行实例）后，残留的多是
  // 「外部 git 进程的短暂持锁」或「上一条命令释放锁的临界窗口」，短退避重试通常能
  // 等到锁释放。注意：不自动删锁 —— 与 IDEA 一致，自动删会破坏外部正在进行的 git。
  /cannot lock ref|unable to create.*\.lock|index\.lock|another git process/i,
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

/**
 * 按 repoPath 缓存的 SimpleGit 实例池。
 *
 * 为什么必须缓存复用（而不是每次 new 一个）：simple-git 的命令排队是「按单个实例」
 * 进行的，串行队列只在同一实例内生效。过去 getGit / getRemoteGit 每次都新建实例，
 * 导致同一仓库的本地命令（status 轮询 / watcher 触发的 status）与联网命令（pull /
 * fetch）分属不同实例、各自独立队列，彼此没有任何互斥 —— 后台刷新与手动 Pull 会
 * 真正并发执行 git 子进程，争抢 `.git/index.lock` 与各 ref 的 `.lock`，表现为
 * 「git 索引被锁定」。
 *
 * 现在同一仓库的所有命令（本地 + 联网）共用同一个实例，配合 maxConcurrentProcesses:1
 * 形成一条 FIFO 串行队列，等价于 IntelliJ IDEA 对同仓库 git 操作串行化的并发保护。
 * 不同仓库仍是各自独立实例，互不阻塞。
 */
const gitInstances = new Map<string, SimpleGit>();

function instanceKey(repoPath: string): string {
  return path.resolve(repoPath);
}

function getOrCreateGit(repoPath: string): SimpleGit {
  const key = instanceKey(repoPath);
  let git = gitInstances.get(key);
  if (!git) {
    git = simpleGit({
      baseDir: repoPath,
      binary: "git",
      // 同一仓库严格串行：消除应用自身并发争抢 index.lock / ref lock 的根因。
      maxConcurrentProcesses: 1,
      // 统一用联网级 block 超时：block 语义是「连续无输出才 kill」，本地命令正常
      // 秒级返回不受影响；而联网命令（fetch/pull/push）在认证 / 握手 / 慢网期间
      // 长时间无输出时不会被 30s 误杀（见 REMOTE_GIT_TIMEOUT_MS 说明）。
      timeout: { block: REMOTE_GIT_TIMEOUT_MS },
    });
    gitInstances.set(key, git);
  }
  return git;
}

export function getGit(repoPath: string): SimpleGit {
  return getOrCreateGit(repoPath);
}

/**
 * 联网 git 操作工厂。历史上它有独立实例以放宽 block 超时；现已与 getGit 合并为
 * 同一个缓存实例 —— 这是关键：只有本地命令与联网命令共用同一条串行队列，二者之间
 * 才有互斥，否则后台 status 仍会与 pull / fetch 并发争锁。保留此命名仅为兼容
 * remote.service 既有调用点的语义可读性。
 */
export function getRemoteGit(repoPath: string): SimpleGit {
  return getOrCreateGit(repoPath);
}

/**
 * 释放缓存的 SimpleGit 实例（仓库被移除 / 关闭时可回收；测试用于隔离）。
 * 不传 repoPath 则清空全部。
 */
export function disposeGitInstances(repoPath?: string): void {
  if (repoPath) {
    gitInstances.delete(instanceKey(repoPath));
  } else {
    gitInstances.clear();
  }
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

/**
 * 严格匹配 git 二进制 diff 行：必须是独立一行 + 行首 + 完整格式。
 * git 输出形如 `Binary files a/foo.png and b/foo.png differ`，这一行不会带
 * `+`/`-`/` ` 前缀。这样可以避免误伤代码里出现 "Binary files" 字面量的情况
 * （例如本文件 buildUntrackedDiff 里就有这串字面量）。
 */
const BINARY_DIFF_LINE = /^Binary files .+ and .+ differ$/;

export function parseDiffOutput(raw: string, filePath?: string): DiffResultModel {
  const result: DiffResultModel = {
    oldPath: null,
    newPath: null,
    hunks: [],
    binary: false,
    oldContent: null,
    newContent: null,
  };

  // split 同时兼容 \r\n（Windows core.autocrlf=true 项目的 git diff 输出可能带 \r），
  // 再额外 strip 每行末尾落单的 \r（防止最后一行没 \n 时残留）。
  const lines = raw.split(/\r?\n/).map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));

  if (lines.some((line) => BINARY_DIFF_LINE.test(line))) {
    result.binary = true;
    if (filePath) result.newPath = filePath;
    return result;
  }

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

/**
 * 为 untracked 文件合成一份 unified diff（/dev/null → 新文件）。
 * 背景：`git diff -- <untracked>` 与 `git diff --cached -- <untracked>` 对未跟踪文件
 *      都返回空字符串（untracked 不在 git 的比对范围里），导致前端 DiffViewer 左右两屏空白。
 *
 * 行为兜底：
 *   - 文件不存在 / 读取失败 → 返回空 DiffResultModel（前端会保持"加载 Diff 中…"占位，但至少不会误导）
 *   - 文件大小 > UNTRACKED_DIFF_MAX_BYTES → 输出 1 行占位说明，不读全文
 *   - 前 BINARY_SNIFF_BYTES 字节含 \0 → 走 "Binary files differ" 路径，由 parseDiffOutput 标记 binary=true
 *   - 文本文件 → 把全部内容作为 + 行写入，模仿 git 的 `\ No newline at end of file` 末尾换行处理
 */
export async function buildUntrackedDiff(
  repoPath: string,
  filePath: string
): Promise<DiffResultModel> {
  const abs = path.resolve(repoPath, filePath);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(abs);
  } catch {
    return parseDiffOutput("", filePath);
  }

  if (!stat.isFile()) {
    return parseDiffOutput("", filePath);
  }

  if (stat.size === 0) {
    const synthetic = [
      `diff --git a/${filePath} b/${filePath}`,
      `new file mode 100644`,
      `--- /dev/null`,
      `+++ b/${filePath}`,
    ].join("\n");
    return parseDiffOutput(synthetic, filePath);
  }

  if (stat.size > UNTRACKED_DIFF_MAX_BYTES) {
    const sizeKB = (stat.size / 1024).toFixed(1);
    const synthetic = [
      `diff --git a/${filePath} b/${filePath}`,
      `new file mode 100644`,
      `--- /dev/null`,
      `+++ b/${filePath}`,
      `@@ -0,0 +1,1 @@`,
      `+[git-manager] file too large to preview (${sizeKB} KB > 1024 KB); open the file directly`,
    ].join("\n");
    return parseDiffOutput(synthetic, filePath);
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    return parseDiffOutput("", filePath);
  }

  const { text } = decodeBufferToText(buf);
  if (text === null) {
    const synthetic = [
      `diff --git a/${filePath} b/${filePath}`,
      `new file mode 100644`,
      `Binary files /dev/null and b/${filePath} differ`,
    ].join("\n");
    return parseDiffOutput(synthetic, filePath);
  }

  const content = text;
  const endsWithNewline = content.endsWith("\n");
  const body = endsWithNewline ? content.slice(0, -1) : content;
  const lines = body.length === 0 ? [] : body.split("\n");

  const synthetic = [
    `diff --git a/${filePath} b/${filePath}`,
    `new file mode 100644`,
    `--- /dev/null`,
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
    ...(endsWithNewline ? [] : [`\\ No newline at end of file`]),
  ].join("\n");

  return parseDiffOutput(synthetic, filePath);
}

async function readGitBlob(repoPath: string, spec: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execFile("git", ["-C", repoPath, "cat-file", "-p", spec], {
      maxBuffer: UNTRACKED_DIFF_MAX_BYTES + 4096,
      encoding: "buffer",
    });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  } catch {
    return null;
  }
}

/**
 * When `git diff` marks a file binary (typical: UTF-16 LE from PowerShell) but
 * decodeBufferToText can read both sides, synthesize a normal unified diff.
 */
export async function recoverMisdetectedBinaryDiff(
  repoPath: string,
  filePath: string,
  staged: boolean
): Promise<DiffResultModel | null> {
  const abs = path.resolve(repoPath, filePath);

  // 先用 fs.stat 拿大小预判，超过阈值直接 return null，避免先 readFile 几 MB 再丢弃。
  // git blob 大小无法零成本拿，姑且按工作区文件大小做粗筛——只要工作区已经超阈值
  // 就放弃 recover，让前端直接显示 Binary（实际场景：恢复 binary 也不切实际）。
  try {
    const stat = await fs.stat(abs);
    if (stat.size > UNTRACKED_DIFF_MAX_BYTES * 2) return null;
  } catch {
    // 工作区文件不在（rare for staged but possible），继续走原路径
  }

  let oldBuf: Buffer | null;
  let newBuf: Buffer | null;

  if (staged) {
    oldBuf = await readGitBlob(repoPath, `HEAD:${filePath}`);
    newBuf = (await readGitBlob(repoPath, `:${filePath}`)) ?? (await fs.readFile(abs).catch(() => null));
    if (!newBuf) return null;
    if (!oldBuf) oldBuf = Buffer.alloc(0);
  } else {
    newBuf = await fs.readFile(abs).catch(() => null);
    if (!newBuf) return null;
    oldBuf =
      (await readGitBlob(repoPath, `:${filePath}`)) ??
      (await readGitBlob(repoPath, `HEAD:${filePath}`)) ??
      Buffer.alloc(0);
  }

  if (oldBuf.length + newBuf.length > UNTRACKED_DIFF_MAX_BYTES * 2) return null;

  const oldDec = decodeBufferToText(oldBuf);
  const newDec = decodeBufferToText(newBuf);
  if (oldDec.text === null || newDec.text === null) return null;

  return synthesizeTextUnifiedDiff(filePath, oldDec.text, newDec.text);
}

export async function synthesizeTextUnifiedDiff(
  filePath: string,
  oldText: string,
  newText: string
): Promise<DiffResultModel> {
  if (oldText === newText) {
    const header = [
      `diff --git a/${filePath} b/${filePath}`,
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
    ].join("\n");
    return parseDiffOutput(header, filePath);
  }

  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "gm-text-diff-"));
  const oldFile = path.join(tmpBase, "old");
  const newFile = path.join(tmpBase, "new");
  try {
    await fs.writeFile(oldFile, oldText, "utf8");
    await fs.writeFile(newFile, newText, "utf8");
    let raw = "";
    try {
      const { stdout } = await execFile(
        "git",
        ["diff", "--no-index", "--no-color", "-U3", oldFile, newFile],
        { maxBuffer: UNTRACKED_DIFF_MAX_BYTES + 4096, encoding: "utf8" }
      );
      raw = stdout;
    } catch (e: unknown) {
      const err = e as { stdout?: string };
      raw = err.stdout ?? "";
      if (!raw) return parseDiffOutput("", filePath);
    }
    const normalized = raw
      .replace(/^diff --git a\/old b\/new/m, `diff --git a/${filePath} b/${filePath}`)
      .replace(/^--- a\/old/m, `--- a/${filePath}`)
      .replace(/^\+\+\+ b\/new/m, `+++ b/${filePath}`);
    return parseDiffOutput(normalized, filePath);
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true });
  }
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
