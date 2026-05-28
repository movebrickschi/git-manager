/**
 * shared/report/report-filter · parseConventional 专项单测
 *
 * 守护 module / scope / subject / breaking 四个字段在各种常见 commit 前缀下的解析结果，
 * 避免后续重构正则时悄悄破坏日报分组与 release-notes 用途。
 */
import { describe, expect, it } from "vitest";
import { parseConventional, applyReportFilter, resolveRange } from "./report-filter.js";
import type { ReportEntry, ReportFilter } from "./types.js";

describe("parseConventional · 常见格式", () => {
  it("纯 type 无 scope: `feat: hello`", () => {
    const r = parseConventional("feat: hello");
    expect(r).toEqual({ module: "feat", scope: undefined, subject: "hello", breaking: false });
  });

  it("type + scope: `feat(order): 新功能`", () => {
    const r = parseConventional("feat(order): 新功能");
    expect(r).toEqual({ module: "feat", scope: "order", subject: "新功能", breaking: false });
  });

  it("BREAKING `!` 无 scope: `feat!: 不兼容改动`", () => {
    const r = parseConventional("feat!: 不兼容改动");
    expect(r).toEqual({ module: "feat", scope: undefined, subject: "不兼容改动", breaking: true });
  });

  it("BREAKING `!` 有 scope: `feat(api)!: 重命名 endpoint`", () => {
    const r = parseConventional("feat(api)!: 重命名 endpoint");
    expect(r).toEqual({ module: "feat", scope: "api", subject: "重命名 endpoint", breaking: true });
  });

  it("大写 type 应统一为小写: `FEAT: x`", () => {
    const r = parseConventional("FEAT: x");
    expect(r.module).toBe("feat");
    expect(r.subject).toBe("x");
  });

  it("scope 含 `/`: `feat(desktop/keys): xxx`", () => {
    const r = parseConventional("feat(desktop/keys): xxx");
    expect(r.scope).toBe("desktop/keys");
    expect(r.module).toBe("feat");
  });

  it("非 conventional 格式回退 other: `修复登录 bug`", () => {
    const r = parseConventional("修复登录 bug");
    expect(r).toEqual({ module: "other", subject: "修复登录 bug", breaking: false });
  });

  it("空字符串: 回退 other 且 subject 为空", () => {
    const r = parseConventional("");
    expect(r.module).toBe("other");
    expect(r.subject).toBe("");
    expect(r.breaking).toBe(false);
  });

  it("多行 message 只取首行: `feat: a\\n\\ndetail`", () => {
    const r = parseConventional("feat: a\n\ndetail");
    expect(r.module).toBe("feat");
    expect(r.subject).toBe("a");
  });

  it("type 后多余空格: `feat:    hello   `", () => {
    const r = parseConventional("feat:    hello   ");
    expect(r.subject).toBe("hello");
    expect(r.module).toBe("feat");
  });

  it("subject 含 emoji 不被破坏: `feat: ✨ 新功能`", () => {
    const r = parseConventional("feat: ✨ 新功能");
    expect(r.subject).toBe("✨ 新功能");
  });
});

describe("applyReportFilter · dedupMessage 现在带 scope 维度", () => {
  function makeEntry(overrides: Partial<ReportEntry>): ReportEntry {
    return {
      repo: "/r/a",
      repoName: "a",
      branch: "main",
      sha: "x",
      shortSha: "x",
      author: "A",
      email: "a@x",
      dateISO: "2026-05-21T08:00:00.000Z",
      message: "x",
      subject: "x",
      module: "feat",
      scope: undefined,
      parentCount: 1,
      ...overrides,
    };
  }

  const baseFilter: ReportFilter = {
    range: { preset: "this-week" },
    repos: ["/r/a"],
    dedupMessage: true,
    excludeMerge: false,
    excludeRevert: false,
  };

  it("同 repo 同 subject 不同 scope → 都保留", () => {
    const entries: ReportEntry[] = [
      makeEntry({ subject: "support oauth", scope: "auth" }),
      makeEntry({ subject: "support oauth", scope: "payment" }),
    ];
    const out = applyReportFilter(entries, baseFilter);
    expect(out).toHaveLength(2);
  });

  it("同 repo 同 subject 同 scope → 去重", () => {
    const entries: ReportEntry[] = [
      makeEntry({ subject: "support oauth", scope: "auth", sha: "1" }),
      makeEntry({ subject: "support oauth", scope: "auth", sha: "2" }),
    ];
    const out = applyReportFilter(entries, baseFilter);
    expect(out).toHaveLength(1);
  });

  it("同 repo 同 subject 都无 scope → 去重", () => {
    const entries: ReportEntry[] = [
      makeEntry({ subject: "improve speed", scope: undefined, sha: "1" }),
      makeEntry({ subject: "improve speed", scope: undefined, sha: "2" }),
    ];
    const out = applyReportFilter(entries, baseFilter);
    expect(out).toHaveLength(1);
  });
});

describe("resolveRange · 边界 sanity 检查", () => {
  it("today 边界为当天 0:00 - 23:59:59.999", () => {
    const now = new Date("2026-05-21T15:30:00.000Z");
    const r = resolveRange({ preset: "today" }, now);
    expect(r.fromISO.length).toBeGreaterThan(10);
    expect(r.toISO.length).toBeGreaterThan(10);
    expect(Date.parse(r.fromISO)).toBeLessThanOrEqual(Date.parse(r.toISO));
  });

  it("custom 缺省 fromISO/toISO 时回退当天", () => {
    const now = new Date("2026-05-21T15:30:00.000Z");
    const r = resolveRange({ preset: "custom" }, now);
    expect(Date.parse(r.fromISO)).toBeLessThanOrEqual(Date.parse(r.toISO));
  });
});
