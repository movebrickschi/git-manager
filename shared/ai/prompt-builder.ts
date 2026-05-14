import type { CommitLang, CommitStyle, PublicAiSettings } from "./types.js";

const STYLE_INSTR: Record<CommitStyle, string> = {
  cc: "遵循 Conventional Commits 规范，第一行格式 `<type>(<scope?>): <subject>`，type 取自 feat / fix / refactor / perf / test / docs / style / build / ci / chore / revert",
  plain: "使用纯文本第一行总结，不加 type/scope 前缀",
  gitmoji: "第一行以 gitmoji emoji 开头，紧跟祈使语气总结，例如 `✨ 新增 …`",
};

const LANG_INSTR: Record<CommitLang, string> = {
  zh: "用简体中文输出 commit 信息",
  en: "Write the commit message in English",
  auto: "根据 diff 中代码注释和文件名的主要语言自动选择中文或英文",
};

export interface PromptInputs {
  diffText: string;
  fileSummary: string;
  settings: Pick<PublicAiSettings, "commitStyle" | "lang">;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

export function buildPrompt({ diffText, fileSummary, settings }: PromptInputs): BuiltPrompt {
  const system = [
    "你是一名 Git commit message 专家，遵守以下规则：",
    `1. ${STYLE_INSTR[settings.commitStyle]}`,
    `2. ${LANG_INSTR[settings.lang]}`,
    "3. 第一行 ≤ 50 字符，祈使语气（如 add / fix / 新增 / 修复），结尾不加句号",
    "4. 多文件改动可加 body：与第一行之间空一行，每行 ≤ 72 字符，使用 `-` bullet",
    "5. 只返回 commit message 本身，不要任何解释、引号、Markdown 代码块包裹",
  ].join("\n");

  const user = [
    `改动概要：${fileSummary}`,
    "",
    "暂存区 diff：",
    "```diff",
    diffText,
    "```",
  ].join("\n");

  return { system, user };
}
