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

    const matches = markdown.match(/  - 明细A/g) ?? [];
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
