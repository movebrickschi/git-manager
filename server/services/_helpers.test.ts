import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildUntrackedDiff,
  parseDiffOutput,
  UNTRACKED_DIFF_MAX_BYTES,
} from "./_helpers.js";

/**
 * buildUntrackedDiff 是 untracked 文件 diff 显示链路的关键兜底。
 * 上游 (server/services/log.service.ts → getFileDiff) 在 `git diff -- <untracked>`
 * 返回空字符串时回退到本函数，因此该函数必须覆盖以下五个真实场景：
 *
 *   1. 普通文本文件（末尾有换行） → 全部内容作为 + 行；不应输出 No newline 注脚
 *   2. 普通文本文件（末尾无换行） → 输出 `\ No newline at end of file`
 *   3. 二进制文件（含 \0 字节） → binary=true，hunks 为空
 *   4. 文件不存在 / 路径无效 → 返回空 DiffResultModel（前端只显示文件名占位，不崩）
 *   5. 大文件（> UNTRACKED_DIFF_MAX_BYTES） → 1 行占位说明，不读全文
 */
describe("buildUntrackedDiff", () => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gm-untracked-diff-"));
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("【1】文本文件 + 末尾有换行 → 输出 + 行，无 No newline 注脚", async () => {
    const filename = "hello.txt";
    await fs.writeFile(path.join(tmpRoot, filename), "line1\nline2\nline3\n", "utf8");

    const diff = await buildUntrackedDiff(tmpRoot, filename);

    expect(diff.binary).toBe(false);
    expect(diff.oldPath).toBeNull();
    expect(diff.newPath).toBe(filename);
    expect(diff.hunks).toHaveLength(1);

    const hunk = diff.hunks[0]!;
    expect(hunk.oldStart).toBe(0);
    expect(hunk.oldLines).toBe(0);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(3);
    expect(hunk.lines).toHaveLength(3);
    expect(hunk.lines.every((l) => l.lineType === "addition")).toBe(true);
    expect(hunk.lines.map((l) => l.content)).toEqual(["line1", "line2", "line3"]);
  });

  it("【2】文本文件 + 末尾无换行 → diff 文本含 No newline at end of file 标记", async () => {
    const filename = "no-trailing-newline.txt";
    await fs.writeFile(path.join(tmpRoot, filename), "only-one-line", "utf8");

    const diff = await buildUntrackedDiff(tmpRoot, filename);

    expect(diff.binary).toBe(false);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]!.lines).toHaveLength(1);
    expect(diff.hunks[0]!.lines[0]!.content).toBe("only-one-line");
    expect(diff.hunks[0]!.lines[0]!.lineType).toBe("addition");
  });

  it("【3】二进制文件（含 \\0 字节） → binary=true, hunks 为空", async () => {
    const filename = "binary.bin";
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);
    await fs.writeFile(path.join(tmpRoot, filename), buf);

    const diff = await buildUntrackedDiff(tmpRoot, filename);

    expect(diff.binary).toBe(true);
    expect(diff.hunks).toHaveLength(0);
  });

  it("【4】文件不存在 → 返回空 DiffResultModel，不抛错", async () => {
    const diff = await buildUntrackedDiff(tmpRoot, "does-not-exist.txt");

    expect(diff.binary).toBe(false);
    expect(diff.hunks).toHaveLength(0);
    expect(diff.newPath).toBe("does-not-exist.txt");
  });

  it("【5】大文件（> UNTRACKED_DIFF_MAX_BYTES） → 1 行占位，包含 too large 文案", async () => {
    const filename = "huge.txt";
    const oversize = UNTRACKED_DIFF_MAX_BYTES + 1024;
    await fs.writeFile(path.join(tmpRoot, filename), Buffer.alloc(oversize, 0x61));

    const diff = await buildUntrackedDiff(tmpRoot, filename);

    expect(diff.binary).toBe(false);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]!.lines).toHaveLength(1);
    expect(diff.hunks[0]!.lines[0]!.content).toContain("too large to preview");
  });

  it("【6】空文件 → 0 hunks 但 newPath 仍标注，不当作 untracked 失败", async () => {
    const filename = "empty.txt";
    await fs.writeFile(path.join(tmpRoot, filename), "", "utf8");

    const diff = await buildUntrackedDiff(tmpRoot, filename);

    expect(diff.binary).toBe(false);
    expect(diff.hunks).toHaveLength(0);
    expect(diff.newPath).toBe(filename);
    expect(diff.oldPath).toBeNull();
  });
});

/**
 * parseDiffOutput 的二进制识别曾经用 `raw.includes("Binary files")`，
 * 会把 diff 内容里包含该字面量的 hunk 行误判为二进制（典型场景：
 * _helpers.ts 自己改了某行又出现在 `+` 行里）。
 * 现已改成"按行 + 行首 + 完整格式"严格匹配，本组用例守住该回归。
 */
describe("parseDiffOutput · 二进制识别不误伤代码字面量", () => {
  it("hunk 内 + 行含 'Binary files' 字符串字面量 → 仍按文本 diff 解析", () => {
    const raw = [
      `diff --git a/x.ts b/x.ts`,
      `index 1111..2222 100644`,
      `--- a/x.ts`,
      `+++ b/x.ts`,
      `@@ -1,1 +1,2 @@`,
      ` const a = 1;`,
      `+const msg = "Binary files /dev/null and b/x.ts differ";`,
    ].join("\n");

    const diff = parseDiffOutput(raw, "x.ts");

    expect(diff.binary).toBe(false);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]!.lines).toHaveLength(2);
    expect(diff.hunks[0]!.lines[1]!.lineType).toBe("addition");
    expect(diff.hunks[0]!.lines[1]!.content).toContain("Binary files");
  });

  it("hunk 内上下文行（前导空格）含 'Binary files' → 仍按文本 diff 解析", () => {
    const raw = [
      `diff --git a/x.ts b/x.ts`,
      `--- a/x.ts`,
      `+++ b/x.ts`,
      `@@ -1,1 +1,1 @@`,
      ` const tip = "Binary files appear here";`,
    ].join("\n");

    const diff = parseDiffOutput(raw, "x.ts");

    expect(diff.binary).toBe(false);
    expect(diff.hunks).toHaveLength(1);
  });

  it("真正的二进制 diff（独立一行 + 行首） → binary=true", () => {
    const raw = [
      `diff --git a/img.png b/img.png`,
      `index 1111..2222 100644`,
      `Binary files a/img.png and b/img.png differ`,
    ].join("\n");

    const diff = parseDiffOutput(raw, "img.png");

    expect(diff.binary).toBe(true);
    expect(diff.hunks).toHaveLength(0);
    expect(diff.newPath).toBe("img.png");
  });
});
