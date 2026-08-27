/**
 * shared/report/report-grouper · 单测
 *
 * 重点覆盖：
 * 1. Markdown 渲染格式（嵌套列表 + 顶级 bullet）
 * 2. commit body 中的 Git trailer 过滤（Co-authored-by / Signed-off-by 等）
 * 3. 多 detail 行的去重与缩进
 */
import { describe, it, expect } from "vitest";
import { buildAndRender } from "./report-grouper.js";
import type { ReportEntry } from "./types.js";

function makeEntry(overrides: Partial<ReportEntry>): ReportEntry {
  return {
    repo: "/tmp/demo-repo",
    repoName: "demo-repo",
    branch: "main",
    sha: "abcdef1234567890",
    shortSha: "abcdef1",
    author: "Alice",
    email: "alice@example.com",
    dateISO: "2026-05-21T08:00:00.000Z",
    message: "feat: hello",
    subject: "feat: hello",
    module: "feat",
    scope: undefined,
    parentCount: 1,
    filesChanged: 1,
    insertions: 10,
    deletions: 1,
    ...overrides,
  };
}

describe("renderEntryBlockMd · 嵌套列表格式", () => {
  it("commit subject 渲染为顶级 bullet，scope 用行内代码内联", () => {
    const entry = makeEntry({
      subject: "API 密钥面板仅保留词元工厂服务商",
      scope: "desktop/keys",
      message: "API 密钥面板仅保留词元工厂服务商",
    });

    const { markdown } = buildAndRender([entry], {
      rangeISO: { fromISO: "2026-05-21T00:00:00Z", toISO: "2026-05-21T23:59:59Z" },
    });

    expect(markdown).toContain("- API 密钥面板仅保留词元工厂服务商 `desktop/keys`");
    // 不再用四级标题
    expect(markdown).not.toMatch(/^#### /m);
  });

  it("commit body 明细行以缩进 2 空格的子 bullet 形式展开", () => {
    const entry = makeEntry({
      subject: "销毁性 slash 命令中文化",
      scope: "i18n",
      message: [
        "销毁性 slash 命令中文化",
        "",
        "/new、/undo 的 detail 文案改为中文",
        "_maybe_confirm_destructive_slash 通用确认模板全部中文化",
        "取消、'始终允许'后续提示文案中文化",
      ].join("\n"),
    });

    const { markdown } = buildAndRender([entry], {
      rangeISO: { fromISO: "2026-05-21T00:00:00Z", toISO: "2026-05-21T23:59:59Z" },
    });

    expect(markdown).toContain("- 销毁性 slash 命令中文化 `i18n`");
    expect(markdown).toContain("  - /new、/undo 的 detail 文案改为中文");
    expect(markdown).toContain(
      "  - _maybe_confirm_destructive_slash 通用确认模板全部中文化"
    );
    expect(markdown).toContain("  - 取消、'始终允许'后续提示文案中文化");
  });

  it("多条 detail 行按出现顺序保序、相同内容去重", () => {
    const entry = makeEntry({
      subject: "重复 detail 测试",
      message: ["重复 detail 测试", "", "明细A", "明细B", "明细A"].join("\n"),
    });

    const { markdown } = buildAndRender([entry], {
      rangeISO: { fromISO: "2026-05-21T00:00:00Z", toISO: "2026-05-21T23:59:59Z" },
    });

    const matches = markdown.match(/ {2}- 明细A/g) ?? [];
    expect(matches.length).toBe(1);
    expect(markdown.indexOf("明细A")).toBeLessThan(markdown.indexOf("明细B"));
  });
});

describe("extractDetailLines · Git trailer 过滤", () => {
  it.each([
    "Co-authored-by: Cursor <cursoragent@cursor.com>",
    "Co-Authored-By: Foo <foo@bar.com>",
    "co-authored-by: lowercase tester <x@y.com>",
    "Signed-off-by: Bob <bob@example.com>",
    "Reviewed-by: Carol <carol@example.com>",
    "Acked-by: Dave <dave@example.com>",
    "Tested-by: Eve <eve@example.com>",
    "Reported-by: Frank <frank@example.com>",
    "Suggested-by: Grace <grace@example.com>",
    "Helped-by: Henry <henry@example.com>",
    "Cc: someone@example.com",
    "Change-Id: I0123456789abcdef",
  ])("跳过 trailer：%s", (trailer) => {
    const entry = makeEntry({
      subject: "feat: 改了点东西",
      message: ["feat: 改了点东西", "", "真实明细行", "", trailer].join("\n"),
    });

    const { markdown } = buildAndRender([entry], {
      rangeISO: { fromISO: "2026-05-21T00:00:00Z", toISO: "2026-05-21T23:59:59Z" },
    });

    expect(markdown).toContain("  - 真实明细行");
    expect(markdown).not.toContain(trailer);
  });

  it("即使 trailer 行前面有 markdown bullet 前缀（`- Co-authored-by: …`）也照样跳过", () => {
    const entry = makeEntry({
      subject: "feat: 防绕过",
      message: [
        "feat: 防绕过",
        "",
        "正常明细",
        "- Co-authored-by: Cursor <cursoragent@cursor.com>",
        "* Signed-off-by: Bob <bob@example.com>",
      ].join("\n"),
    });

    const { markdown } = buildAndRender([entry], {
      rangeISO: { fromISO: "2026-05-21T00:00:00Z", toISO: "2026-05-21T23:59:59Z" },
    });

    expect(markdown).toContain("  - 正常明细");
    expect(markdown).not.toMatch(/co-authored-by/i);
    expect(markdown).not.toMatch(/signed-off-by/i);
  });

  it("issue 引用类 trailer（Fixes / Closes / Refs）默认保留，仍当作明细输出", () => {
    const entry = makeEntry({
      subject: "fix: 修复 #42",
      message: [
        "fix: 修复 #42",
        "",
        "重写校验逻辑",
        "Fixes #42",
        "Closes #50",
      ].join("\n"),
    });

    const { markdown } = buildAndRender([entry], {
      rangeISO: { fromISO: "2026-05-21T00:00:00Z", toISO: "2026-05-21T23:59:59Z" },
    });

    expect(markdown).toContain("  - 重写校验逻辑");
    expect(markdown).toContain("  - Fixes #42");
    expect(markdown).toContain("  - Closes #50");
  });

  it("用户在 body 里写非 trailer 的「X: Y」（不是已知 token）不应被误伤", () => {
    const entry = makeEntry({
      subject: "docs: 解释设计",
      message: [
        "docs: 解释设计",
        "",
        "Notes: 设计决策已和 PM 对齐",
        "TODO: 后续补充 README",
      ].join("\n"),
    });

    const { markdown } = buildAndRender([entry], {
      rangeISO: { fromISO: "2026-05-21T00:00:00Z", toISO: "2026-05-21T23:59:59Z" },
    });

    expect(markdown).toContain("  - Notes: 设计决策已和 PM 对齐");
    expect(markdown).toContain("  - TODO: 后续补充 README");
  });
});

function localISO(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

describe("buildAndRender · 周报模式", () => {
  const rangeISO = {
    fromISO: localISO(2026, 5, 18),
    toISO: localISO(2026, 5, 19),
  };

  it("未指定 kind 时标题仍为工作日报，分组仍是 repo → module → date", () => {
    const entry = makeEntry({
      dateISO: localISO(2026, 5, 18),
      module: "feat",
      subject: "add oauth",
    });
    const { markdown, groups } = buildAndRender([entry], { rangeISO });

    expect(markdown).toContain("# 📅 工作日报");
    expect(groups[0]?.children[0]?.level).toBe("module");
    expect(groups[0]?.children[0]?.children[0]?.level).toBe("date");
  });

  it("kind=weekly 时标题为工作周报，分组为 repo → date → module", () => {
    const mondayFeat = makeEntry({
      dateISO: localISO(2026, 5, 18),
      module: "feat",
      subject: "add oauth",
      scope: "auth",
      message: "add oauth",
    });
    const tuesdayFix = makeEntry({
      dateISO: localISO(2026, 5, 19),
      module: "fix",
      subject: "fix login",
      sha: "bbbbbb1234567890",
      shortSha: "bbbbbb1",
      message: "fix login",
    });

    const { markdown, groups } = buildAndRender([mondayFeat, tuesdayFix], {
      rangeISO,
      kind: "weekly",
    });

    expect(markdown).toContain("# 📅 工作周报");
    expect(markdown).not.toContain("# 📅 工作日报");
    expect(groups[0]?.level).toBe("repo");
    expect(groups[0]?.children.map((c) => c.level)).toEqual(["date", "date"]);
    expect(groups[0]?.children[0]?.key).toBe("2026-05-19");
    expect(groups[0]?.children[0]?.children[0]?.level).toBe("module");
    expect(groups[0]?.children[1]?.key).toBe("2026-05-18");
    expect(markdown).toContain("**周二 2026-05-19**");
    expect(markdown).toContain("**周一 2026-05-18**");
    expect(markdown.indexOf("**周二 2026-05-19**")).toBeLessThan(
      markdown.indexOf("**周一 2026-05-18**")
    );
  });

  it("kind=weekly 时总览行带模块计数", () => {
    const { markdown } = buildAndRender(
      [
        makeEntry({ dateISO: localISO(2026, 5, 18), module: "feat", subject: "a", message: "a" }),
        makeEntry({
          dateISO: localISO(2026, 5, 19),
          module: "fix",
          subject: "b",
          message: "b",
          sha: "cccccccccccccccc",
          shortSha: "ccccccc",
        }),
      ],
      { rangeISO, kind: "weekly" }
    );

    expect(markdown).toMatch(/feat 1/);
    expect(markdown).toMatch(/fix 1/);
  });
});
