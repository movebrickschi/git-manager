/**
 * Daily Report AI 润色 · prompt 拼装纯函数。
 *
 * 复用 `ai.service.ts` 的 `chat/completions` 通道，本文件只产 system / user
 * 两段字符串。三端共用，不依赖 fs / Electron / fetch。
 *
 * 与 commit message 生成共用同一份 `AiConnectionSettings`（baseUrl / apiKey /
 * model / timeout），但 prompt 风格 / 语言 / 截断阈值由本文件入参单独控制。
 */
import type { ReportLang, ReportPolishStyle } from "../report/types.js";

const STYLE_INSTR: Record<ReportPolishStyle, string> = {
  formal:
    "正式书面语，使用完整句子和过去时；多用「实现 / 完成 / 优化 / 修复」等动词；避免口语化与表情符号",
  casual: "轻松自然语气，第一人称叙述工作产出；可以有少量 emoji，但不要过度堆砌",
  bullet:
    "项目符号列表，每条 ≤ 30 字，动词开头；按重要度排序；不要长段落，不要 emoji",
  narrative:
    "短篇叙事段落（每个项目 1 段，每段 100-200 字）；侧重业务价值，淡化技术细节；不堆 commit 列表",
};

const LANG_INSTR: Record<ReportLang, string> = {
  zh: "用简体中文输出",
  en: "Write the report in concise professional English",
  auto: "根据输入 commit message 主要语言自动选择中文或英文，整篇语言保持一致",
};

export interface ReportPromptInputs {
  /** 已经按 repo→module→date 渲染好的 Markdown 原始报告。 */
  rawMarkdown: string;
  style: ReportPolishStyle;
  lang: ReportLang;
  /** 报告标题，例如「工作日报（2026-04-20）」。 */
  title?: string;
  /** 当输入 Markdown 超过该字符数时，调用方应先截断；本函数不做截断。 */
  maxInputChars?: number;
  /**
   * 用户自定义的追加要求，非空时拼接到 system prompt 末尾。
   * 例如「每条加上工时估算」「使用 emoji」「按业务线分组」。
   */
  customPrompt?: string;
}

export interface BuiltReportPrompt {
  system: string;
  user: string;
}

/** 报告润色的默认输入截断阈值（字符）。 */
export const DEFAULT_REPORT_MAX_INPUT_CHARS = 32000;

/**
 * 安全截断超长输入，避免一次请求把上下文打爆。
 *
 * 策略：取前 N 字符 + 一个简短结尾标记。**不**做"按文件抽样"的高级降级，
 * 因为输入本身已经是结构化 Markdown（repo→module→date），用户多半希望保留前部。
 */
export function truncateReportInput(input: string, maxChars: number): {
  truncated: string;
  wasTruncated: boolean;
} {
  if (input.length <= maxChars) {
    return { truncated: input, wasTruncated: false };
  }
  const head = input.slice(0, Math.max(0, maxChars - 80));
  return {
    truncated:
      head +
      "\n\n…（输入超过 " +
      maxChars +
      " 字符，已截断；如需完整请缩小时间范围或减少仓库数）",
    wasTruncated: true,
  };
}

/** 拼装润色 prompt（不调用 LLM，纯字符串拼装）。 */
export function buildReportPolishPrompt(inputs: ReportPromptInputs): BuiltReportPrompt {
  const style = STYLE_INSTR[inputs.style];
  const lang = LANG_INSTR[inputs.lang];
  const titleHint = inputs.title ? `报告标题：${inputs.title}` : "";

  const baseLines = [
    "你是一名资深技术经理，负责把一份机械汇总的 Git 提交清单润色成可读的工作汇报。",
    "你需要遵守以下规则：",
    `1. 写作风格：${style}`,
    `2. 输出语言：${lang}`,
    "3. 仅基于输入 commit 列表的事实改写，不要凭空虚构未提及的工作内容",
    "4. 保留输入的「项目 / 模块」分组结构（项目用二级标题，模块用三级标题）",
    "5. 同一项目下相似 commit 可以合并成一句，不要逐条复述",
    "6. 输出顶部 1 行总览（句号结尾）：今天 / 本周做了哪几方面工作",
    "7. 强调成果（带数字/影响范围），不要写「修改了某文件」这类无信息量描述",
    "8. 直接返回 Markdown 报告本身，不要任何额外解释 / 引号 / 代码块包裹",
  ];

  const customAddon = inputs.customPrompt?.trim();
  if (customAddon) {
    baseLines.push("", "附加要求（用户自定义，优先级高于上面 1-8）：", customAddon);
  }

  const system = baseLines.join("\n");

  const userParts = [
    titleHint,
    "原始 commit 汇总（请基于此润色）：",
    "```markdown",
    inputs.rawMarkdown,
    "```",
  ].filter(Boolean);

  return { system, user: userParts.join("\n") };
}
