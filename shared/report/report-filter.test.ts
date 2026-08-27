/**
 * shared/report/report-filter · parseConventional 专项单测
 *
 * 守护 module / scope / subject / breaking 四个字段在各种常见 commit 前缀下的解析结果，
 * 避免后续重构正则时悄悄破坏日报分组与 release-notes 用途。
 */
import { describe, expect, it } from "vitest";
import {
  parseConventional,
  applyReportFilter,
  resolveRange,
  rangeAfterKindSwitch,
  resolveGitLogRefs,
  normalizeRepoBranches,
  toggleRepoBranch,
} from "./report-filter.js";
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

describe("rangeAfterKindSwitch", () => {
  it("切到周报时，今日/昨日改成默认本周", () => {
    expect(rangeAfterKindSwitch("weekly", "today")).toBe("this-week");
    expect(rangeAfterKindSwitch("weekly", "yesterday")).toBe("this-week");
  });

  it("切到日报时，本周/上周改成默认今日", () => {
    expect(rangeAfterKindSwitch("daily", "this-week")).toBe("today");
    expect(rangeAfterKindSwitch("daily", "last-week")).toBe("today");
  });

  it("自定义/月报范围在模式切换时保持不变", () => {
    expect(rangeAfterKindSwitch("weekly", "custom")).toBe("custom");
    expect(rangeAfterKindSwitch("weekly", "this-month")).toBe("this-month");
    expect(rangeAfterKindSwitch("daily", "last-month")).toBe("last-month");
    expect(rangeAfterKindSwitch("weekly", "last-week")).toBe("last-week");
  });
});

describe("normalizeRepoBranches", () => {
  it("legacy 单字符串变成单元素数组", () => {
    expect(normalizeRepoBranches("feature/x")).toEqual(["feature/x"]);
  });

  it("数组去空、去重、保序", () => {
    expect(normalizeRepoBranches(["main", "dev", "main", "", "feat/x"])).toEqual([
      "main",
      "dev",
      "feat/x",
    ]);
  });

  it("空值得到空数组", () => {
    expect(normalizeRepoBranches(undefined)).toEqual([]);
    expect(normalizeRepoBranches("")).toEqual([]);
    expect(normalizeRepoBranches([])).toEqual([]);
  });
});

describe("toggleRepoBranch · 同一仓库可勾多个分支", () => {
  it("勾第二个分支时保留第一个", () => {
    expect(toggleRepoBranch(["main"], "dev", true)).toEqual(["main", "dev"]);
  });

  it("取消勾选只拿掉目标分支", () => {
    expect(toggleRepoBranch(["main", "dev"], "main", false)).toEqual(["dev"]);
  });

  it("允许全部取消", () => {
    expect(toggleRepoBranch(["main"], "main", false)).toEqual([]);
  });
});

describe("resolveGitLogRefs · 每仓分支优先于全局白名单", () => {
  it("branchByRepo 命中时只扫该仓指定分支，不把全局 branches 拼上去", () => {
    expect(
      resolveGitLogRefs(
        {
          branches: ["main", "develop"],
          branchByRepo: { "C:\\a\\hellome": ["feature/x"] },
        },
        "C:\\a\\hellome",
        "main"
      )
    ).toEqual({ all: false, refs: ["feature/x"] });
  });

  it("同一仓库勾多个分支时全部作为 git log refs", () => {
    expect(
      resolveGitLogRefs(
        {
          branches: [],
          branchByRepo: { "/r": ["main", "dev", "feat/x"] },
        },
        "/r",
        "release"
      )
    ).toEqual({ all: false, refs: ["main", "dev", "feat/x"] });
  });

  it("仍能消化旧的单字符串 persist 形态", () => {
    expect(
      resolveGitLogRefs(
        {
          branches: [],
          branchByRepo: { "/r": "hotfix" as unknown as string[] },
        },
        "/r",
        "main"
      )
    ).toEqual({ all: false, refs: ["hotfix"] });
  });

  it("每仓分支为空数组时回退当前分支", () => {
    expect(
      resolveGitLogRefs({ branches: [], branchByRepo: { "/r": [] } }, "/r", "release")
    ).toEqual({ all: false, refs: ["release"] });
  });

  it("--all 高于 branchByRepo", () => {
    expect(
      resolveGitLogRefs(
        { branches: ["--all"], branchByRepo: { "/r": ["dev"] } },
        "/r",
        "main"
      )
    ).toEqual({ all: true, refs: [] });
  });

  it("没有 per-repo / 白名单时回退当前分支", () => {
    expect(resolveGitLogRefs({ branches: [], branchByRepo: {} }, "/r", "release")).toEqual({
      all: false,
      refs: ["release"],
    });
  });

  it("都没有时 refs 为空（交给 git log 默认 HEAD）", () => {
    expect(resolveGitLogRefs({ branches: [] }, "/r")).toEqual({ all: false, refs: [] });
  });
});
