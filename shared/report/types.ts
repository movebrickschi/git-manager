/**
 * Daily Report 共享类型。
 *
 * 三端共用（Vue 前端 / Electron main / Express server），因此本文件严禁
 * import 任何 node-only 或 browser-only 的 API（fs / window / document …）。
 */

/** 时间范围预设。 */
export type ReportRangePreset =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "custom";

/** 输出格式。 */
export type ReportOutputFormat = "markdown" | "plain";

// `ReportLang` / `ReportPolishStyle` 统一定义在 `shared/ai/types.ts`
// （它们本质是 AI 输出风格，应与连接层并列在 AI 模块），此处 import+re-export
// 同时保留对外路径与本文件内引用。
import type { ReportLang, ReportPolishStyle } from "../ai/types.js";
export type { ReportLang, ReportPolishStyle };

/** 时间范围。 */
export interface ReportRange {
  preset: ReportRangePreset;
  /** ISO 字符串；preset='custom' 时必填。 */
  fromISO?: string;
  /** ISO 字符串；preset='custom' 时必填。包含日期当天 23:59:59。 */
  toISO?: string;
}

/** 抽取过滤条件。 */
export interface ReportFilter {
  range: ReportRange;
  /**
   * 作者过滤。
   * - 不传 / 空数组 = 仅当前 git 用户
   * - `["*"]` = 全部作者
   * - 其它 = 邮箱或姓名精确匹配（多选 OR）
   */
  authors?: string[];
  /** 仓库根目录绝对路径，至少 1 个。 */
  repos: string[];
  /**
   * 分支过滤（全局回退）。
   * - 不传 / 空数组 = 仅当前分支
   * - `["--all"]` = 所有分支
   * - 其它 = 指定分支名白名单
   *
   * **优先级低于 `branchByRepo`**：单仓库下若 `branchByRepo[repo]` 存在，
   * 以它为准；否则才回到本字段。
   */
  branches?: string[];
  /**
   * 每个仓库单独指定要扫描的分支。key 为仓库绝对路径，value 为分支名。
   *
   * 典型用法：用户在某些仓库里平时不在 main 上工作，希望出报告时
   * 抓另一个 feature 分支的提交，但**不希望切换工作区**。本字段就只是
   * 给 `git log` 传 ref，**不**做 checkout。
   */
  branchByRepo?: Record<string, string>;
  /** commit message 必须包含的关键字（任一命中即可）。 */
  includeKeywords?: string[];
  /** commit message 命中即排除的关键字。 */
  excludeKeywords?: string[];
  /** 排除合并 commit（双父）。默认 true。 */
  excludeMerge: boolean;
  /** 排除 revert commit（message 以 `Revert` 开头）。默认 true。 */
  excludeRevert: boolean;
  /** 按 message 字符串去重，仅保留首次出现的那条。默认 true。 */
  dedupMessage: boolean;
}

/** 单条提交记录。 */
export interface ReportEntry {
  /** 仓库根目录绝对路径。 */
  repo: string;
  /** 仓库展示名（path.basename(repo)）。 */
  repoName: string;
  /** 抽取时所在分支；若 branches=['--all'] 则可能为空。 */
  branch?: string;
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  /** 提交时间 ISO 字符串。 */
  dateISO: string;
  /** 完整 commit message（含 body）。 */
  message: string;
  /** message 第一行。 */
  subject: string;
  /**
   * 从 conventional commits 前缀提取的模块名。
   * 例如 `feat(order): xxx` → `feat`。无法解析时为 `other`。
   */
  module: string;
  /** scope 部分，例如 `feat(order): xxx` → `order`。 */
  scope?: string;
  /** 父 commit 数；>1 即合并提交。 */
  parentCount: number;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
}

/** 分组节点；可递归。 */
export interface ReportGroup {
  /** 节点层级语义。 */
  level: "repo" | "module" | "date";
  /** 分组键值（仓库名 / 模块名 / 日期）。 */
  key: string;
  /** 该节点下叶子提交（仅叶子节点非空）。 */
  entries: ReportEntry[];
  /** 子分组（非叶子节点非空）。 */
  children: ReportGroup[];
  /** 当前节点的累计 commit 数。 */
  count: number;
}

/** 抽取 + 分组后的完整结果。 */
export interface ReportResult {
  filter: ReportFilter;
  /** 三层分组：repo → module → date。 */
  groups: ReportGroup[];
  /** 渲染后的 Markdown 文本（可直接发钉钉/复制）。 */
  markdown: string;
  /** 渲染后的纯文本（不含 Markdown 符号）。 */
  plain: string;
  /** 命中过滤后的 commit 总数。 */
  totalCommits: number;
  /** 抽取时间 ISO。 */
  generatedAtISO: string;
}

/** 作者建议条目（用于 AuthorPicker 自动补全）。 */
export interface AuthorSuggestion {
  name: string;
  email: string;
  /** 在指定仓库 / 时间窗口内的提交数；越大越靠前。 */
  count: number;
}

/** 报告抽取阶段的错误码。 */
export type ReportErrorCode =
  | "NO_REPO"
  | "NO_COMMITS"
  | "GIT_FAIL"
  | "INVALID_RANGE"
  | "UNKNOWN";

export type ReportExtractResult =
  | { ok: true; result: ReportResult }
  | { ok: false; code: ReportErrorCode; reason: string };

/** 润色入参。 */
export interface ReportPolishInput {
  /** 待润色的 Markdown 报告。 */
  markdown: string;
  style: ReportPolishStyle;
  lang: ReportLang;
  /**
   * 用户在本次调用临时覆盖的自定义提示词。
   * 不传 → 使用 ai-settings.json 中持久化的 report.customPrompt。
   */
  customPrompt?: string;
}

export type ReportPolishResult =
  | { ok: true; markdown: string }
  | { ok: false; code: string; reason: string };

/** 每个仓库的分支信息（用于 UI 下拉）。 */
export interface RepoBranchInfo {
  /** 该仓库所有本地分支名（已排序）。 */
  branches: string[];
  /** 当前 HEAD 所在分支（可能为空，表示 detached HEAD）。 */
  current?: string;
}

/** ReportFilter 默认值。 */
export const DEFAULT_REPORT_FILTER: ReportFilter = {
  range: { preset: "today" },
  authors: [],
  repos: [],
  branches: [],
  branchByRepo: {},
  includeKeywords: [],
  excludeKeywords: [],
  excludeMerge: true,
  excludeRevert: true,
  dedupMessage: true,
};
