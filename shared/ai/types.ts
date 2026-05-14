/**
 * AI 提交信息生成 · 共享类型与默认值。
 *
 * 三端共用（frontend / Electron main / Express server），因此本文件严禁
 * import 任何 node-only 或 browser-only 的 API（fs / window / document …）。
 */

export type CommitStyle = "cc" | "plain" | "gitmoji";
export type CommitLang = "zh" | "en" | "auto";

export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  commitStyle: CommitStyle;
  lang: CommitLang;
  timeout: number;
  maxDiffChars: number;
}

export type PublicAiSettings = Omit<AiSettings, "apiKey">;

export interface AiSettingsView extends PublicAiSettings {
  hasApiKey: boolean;
}

export type AiErrorCode =
  | "NO_API_KEY"
  | "NO_STAGED"
  | "NETWORK"
  | "AUTH"
  | "RATE_LIMIT"
  | "SERVER"
  | "TIMEOUT"
  | "EMPTY"
  | "ABORT"
  | "UNKNOWN";

export type AiGenerateResult =
  | { ok: true; message: string }
  | { ok: false; code: AiErrorCode; reason: string };

export type AiTestResult =
  | { ok: true; models?: string[] }
  | { ok: false; code: AiErrorCode; reason: string };

export interface AiPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}

export const AI_PRESETS: readonly AiPreset[] = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "moonshot", label: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { id: "zhipu", label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { id: "qwen", label: "通义千问 (DashScope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { id: "ollama", label: "Ollama 本地", baseUrl: "http://localhost:11434/v1", model: "qwen2.5-coder" },
  { id: "custom", label: "自定义", baseUrl: "", model: "" },
] as const;

export const DEFAULT_PUBLIC_AI_SETTINGS: PublicAiSettings = {
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  commitStyle: "cc",
  lang: "auto",
  timeout: 30000,
  maxDiffChars: 16000,
};
