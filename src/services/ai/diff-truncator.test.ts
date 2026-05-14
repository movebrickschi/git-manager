import { describe, expect, it } from "vitest";
import { truncateDiff } from "../../../shared/ai/diff-truncator";

function makeFileDiff(path: string, addedLines: number): string {
  const headers = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${addedLines} @@`,
  ];
  const body = Array.from({ length: addedLines }, (_, i) => `+line ${i + 1}`);
  return [...headers, ...body].join("\n");
}

describe("truncateDiff", () => {
  it("empty diff returns empty + no-files summary", () => {
    const r = truncateDiff("", 1000);
    expect(r.truncated).toBe("");
    expect(r.fileSummary).toBe("无文件改动");
    expect(r.degraded).toBe(false);
  });

  it("short single-file diff returns as-is, not degraded", () => {
    const diff = makeFileDiff("a.ts", 3);
    const r = truncateDiff(diff, 10_000);
    expect(r.truncated).toBe(diff);
    expect(r.degraded).toBe(false);
    expect(r.fileSummary).toMatch(/1 个文件改动/);
    expect(r.fileSummary).toMatch(/a\.ts \(\+3 -0\)/);
  });

  it("over-budget multi-file diff falls back to per-file 100-line cap (stage 1)", () => {
    const diff = [makeFileDiff("a.ts", 200), makeFileDiff("b.ts", 200)].join("\n");
    const r = truncateDiff(diff, diff.length - 10);
    expect(r.degraded).toBe(true);
    expect(r.truncated).toMatch(/\.\.\. \(truncated, original \d+ lines, \+\d+ -\d+\)/);
    expect(r.fileSummary).toMatch(/2 个文件改动/);
    expect(r.truncated.length).toBeLessThan(diff.length);
  });

  it("very large diff falls all the way to stage-2 path-only summary", () => {
    const files = Array.from({ length: 50 }, (_, i) => makeFileDiff(`f${i}.ts`, 500));
    const diff = files.join("\n");
    const r = truncateDiff(diff, 500);
    expect(r.degraded).toBe(true);
    expect(r.truncated.split("\n")).toHaveLength(50);
    expect(r.truncated).toMatch(/^f0\.ts: \+500 -0/);
    expect(r.fileSummary).toMatch(/50 个文件改动/);
  });

  it("addition / deletion counters honor +++ / --- header lines", () => {
    const diff = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
    ].join("\n");
    const r = truncateDiff(diff, 10_000);
    expect(r.fileSummary).toMatch(/x\.ts \(\+1 -1\)/);
  });
});
