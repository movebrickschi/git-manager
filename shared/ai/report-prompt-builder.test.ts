import { describe, expect, it } from "vitest";
import { buildReportPolishPrompt } from "./report-prompt-builder.js";

const SAMPLE = `# 📅 工作周报（2026-05-18 ~ 2026-05-22）

## 📦 demo
- feat hello
`;

describe("buildReportPolishPrompt · 日报 / 周报", () => {
  it("未指定 kind 时仍按日报规则（今天 / 本周）", () => {
    const { system } = buildReportPolishPrompt({
      rawMarkdown: SAMPLE,
      style: "formal",
      lang: "zh",
    });
    expect(system).toContain("今天 / 本周");
  });

  it("kind=daily 时总览要求写今天做了什么", () => {
    const { system } = buildReportPolishPrompt({
      rawMarkdown: SAMPLE,
      style: "formal",
      lang: "zh",
      kind: "daily",
    });
    expect(system).toContain("今天做了哪几方面工作");
    expect(system).not.toContain("不要编造「下周计划");
  });

  it("kind=weekly 时按周报结构润色，禁止编造下周计划", () => {
    const { system, user } = buildReportPolishPrompt({
      rawMarkdown: SAMPLE,
      style: "formal",
      lang: "zh",
      kind: "weekly",
      title: "工作周报（2026-05-18 ~ 2026-05-22）",
    });
    expect(system).toContain("工作周报");
    expect(system).toContain("本周完成了哪几方面工作");
    expect(system).toContain("不要编造「下周计划");
    expect(system).toContain("周几");
    expect(user).toContain("工作周报（2026-05-18 ~ 2026-05-22）");
  });
});
