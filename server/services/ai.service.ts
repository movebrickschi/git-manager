/**
 * AI Commit Message 生成 · Node 端公共服务。
 *
 * 同时被 Electron main（注入 safeStorage backed storage）与 Express server
 * （明文文件 storage）复用：核心 fetch / prompt / 错误分类 / 重试 逻辑只此一份。
 *
 * 本身不依赖 Electron API，可在纯 Node 进程运行。
 */
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { simpleGit } from "simple-git";
import { buildPrompt } from "../../shared/ai/prompt-builder.js";
import { truncateDiff } from "../../shared/ai/diff-truncator.js";
import {
  DEFAULT_PUBLIC_AI_SETTINGS,
  type AiGenerateResult,
  type AiSettings,
  type AiSettingsView,
  type AiTestResult,
  type PublicAiSettings,
} from "../../shared/ai/types.js";

export interface SecretStorage {
  getApiKey(): Promise<string | null>;
  saveApiKey(plainKey: string): Promise<void>;
}

export interface PublicStorage {
  read(): Promise<PublicAiSettings | null>;
  write(s: PublicAiSettings): Promise<void>;
}

export interface AiServiceDeps {
  secretStorage: SecretStorage;
  publicStorage: PublicStorage;
}

function defaultConfigDir(): string {
  return path.join(os.homedir(), ".git-manager");
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export function createPlainFileStorage(dir = defaultConfigDir()): {
  secret: SecretStorage;
  pub: PublicStorage;
} {
  const apiKeyFile = path.join(dir, "ai-apikey.txt");
  const settingsFile = path.join(dir, "ai-settings.json");

  const secret: SecretStorage = {
    async getApiKey() {
      if (process.env.AI_API_KEY) return process.env.AI_API_KEY;
      try {
        const buf = await fs.readFile(apiKeyFile, "utf-8");
        return buf.trim() || null;
      } catch {
        return null;
      }
    },
    async saveApiKey(plain) {
      await ensureDir(dir);
      await fs.writeFile(apiKeyFile, plain, { mode: 0o600 });
    },
  };

  const pub: PublicStorage = {
    async read() {
      try {
        const buf = await fs.readFile(settingsFile, "utf-8");
        const parsed = JSON.parse(buf) as Partial<PublicAiSettings>;
        return { ...DEFAULT_PUBLIC_AI_SETTINGS, ...parsed };
      } catch {
        return null;
      }
    },
    async write(s) {
      await ensureDir(dir);
      await fs.writeFile(settingsFile, JSON.stringify(s, null, 2), { mode: 0o644 });
    },
  };

  return { secret, pub };
}

async function loadFullSettings(deps: AiServiceDeps): Promise<AiSettings | null> {
  const apiKey = await deps.secretStorage.getApiKey();
  if (!apiKey) return null;
  const pub = (await deps.publicStorage.read()) ?? DEFAULT_PUBLIC_AI_SETTINGS;
  return { ...pub, apiKey };
}

async function getStagedDiff(repoPath: string): Promise<string> {
  const git = simpleGit({ baseDir: repoPath, binary: "git" });
  return await git.diff(["--cached"]);
}

interface RawChoice {
  message?: { content?: string };
}
interface ChatResponse {
  choices?: RawChoice[];
  error?: { message?: string; code?: string };
}

function classifyHttpStatus(
  status: number,
  bodyMsg?: string
): AiGenerateResult & { ok: false } {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: "AUTH",
      reason: bodyMsg ?? `apiKey 无效或权限不足 (HTTP ${status})`,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      code: "RATE_LIMIT",
      reason: bodyMsg ?? `触发上游限速 (HTTP ${status})`,
    };
  }
  if (status >= 500) {
    return { ok: false, code: "SERVER", reason: bodyMsg ?? `上游服务异常 (HTTP ${status})` };
  }
  return { ok: false, code: "UNKNOWN", reason: bodyMsg ?? `HTTP ${status}` };
}

function cleanMessage(raw: string): string {
  let s = raw.trim();
  const fenceMatch = s.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch && fenceMatch[1]) s = fenceMatch[1].trim();
  s = s.replace(/^["「『](.*)["」』]$/s, "$1").trim();
  return s;
}

/**
 * AI 服务连接层配置（baseUrl / apiKey / model / timeout）。
 *
 * `AiSettings` 是它的超集，所以 commit message 调用方可以直接传 AiSettings；
 * Daily Report 调用方只需要构造一个 4 字段子集即可复用同一份连接。
 */
export type AiConnection = Pick<AiSettings, "baseUrl" | "apiKey" | "model" | "timeout">;

/**
 * 通用 chat/completions 调用（commit 生成与日报润色共用）。
 *
 * - 自动管理 timeout AbortController
 * - 兼容外部 signal（用户主动 abort）
 * - HTTP 错误按 AiErrorCode 分类
 * - 清理输出：去三反引号围栏、去前后中英引号
 */
export async function chatCompletions(
  settings: AiConnection,
  system: string,
  user: string,
  externalSignal?: AbortSignal
): Promise<AiGenerateResult> {
  const url = settings.baseUrl.replace(/\/$/, "") + "/chat/completions";
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort("timeout"), settings.timeout);
  const onExternalAbort = () => ctrl.abort("external");
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort("external");
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.4,
        stream: false,
      }),
      signal: ctrl.signal,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const reason = ctrl.signal.reason;
    if (reason === "external" || externalSignal?.aborted) {
      return { ok: false, code: "ABORT", reason: "已取消" };
    }
    if (reason === "timeout" || msg.toLowerCase().includes("abort") || msg === "timeout") {
      return { ok: false, code: "TIMEOUT", reason: `请求超时（${settings.timeout} ms）` };
    }
    return { ok: false, code: "NETWORK", reason: `网络不可达：${msg}` };
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }

  if (!res.ok) {
    let bodyMsg: string | undefined;
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      bodyMsg = errJson.error?.message;
    } catch {
      // ignore
    }
    return classifyHttpStatus(res.status, bodyMsg);
  }

  let body: ChatResponse;
  try {
    body = (await res.json()) as ChatResponse;
  } catch (e: unknown) {
    return {
      ok: false,
      code: "UNKNOWN",
      reason: `响应解析失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (body.error) {
    return { ok: false, code: "AUTH", reason: body.error.message ?? "上游报错" };
  }
  const content = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) return { ok: false, code: "EMPTY", reason: "AI 返回空内容" };
  return { ok: true, message: cleanMessage(content) };
}

export function makeAiService(deps: AiServiceDeps) {
  let currentController: AbortController | null = null;
  let currentInstance = 0;

  return {
    async getSettingsView(): Promise<AiSettingsView> {
      const apiKey = await deps.secretStorage.getApiKey();
      const pub = (await deps.publicStorage.read()) ?? DEFAULT_PUBLIC_AI_SETTINGS;
      return { ...pub, hasApiKey: !!apiKey };
    },

    async saveSettings(s: AiSettings): Promise<void> {
      const { apiKey, ...pub } = s;
      await deps.publicStorage.write(pub);
      if (apiKey && apiKey.trim()) await deps.secretStorage.saveApiKey(apiKey.trim());
    },

    async testConnection(input: AiSettings): Promise<AiTestResult> {
      const url = input.baseUrl.replace(/\/$/, "") + "/models";
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort("timeout"), 8000);
      let apiKey = input.apiKey?.trim();
      if (!apiKey) {
        const stored = await deps.secretStorage.getApiKey();
        apiKey = stored ?? "";
      }
      if (!apiKey) {
        clearTimeout(t);
        return { ok: false, code: "NO_API_KEY", reason: "未填入 apiKey 且未存配置" };
      }
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: ctrl.signal,
        });
      } catch (e: unknown) {
        clearTimeout(t);
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.toLowerCase().includes("abort") || msg === "timeout") {
          return { ok: false, code: "TIMEOUT", reason: "测试请求超时（8s）" };
        }
        return { ok: false, code: "NETWORK", reason: `连接失败：${msg}` };
      } finally {
        clearTimeout(t);
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, code: "AUTH", reason: `apiKey 无效 (HTTP ${res.status})` };
      }
      if (res.status === 404) {
        // 部分私有部署不暴露 /models，回退视为可用
        return { ok: true };
      }
      if (!res.ok) {
        return { ok: false, code: "SERVER", reason: `测试失败 HTTP ${res.status}` };
      }
      try {
        const body = (await res.json()) as { data?: Array<{ id?: string }> };
        const models = body.data?.map((d) => d.id ?? "").filter(Boolean);
        return { ok: true, models };
      } catch {
        return { ok: true };
      }
    },

    async generate(repoPath: string): Promise<AiGenerateResult> {
      currentController?.abort("superseded");
      const ctrl = new AbortController();
      currentController = ctrl;
      const myInstance = ++currentInstance;
      const releaseIfMine = () => {
        if (currentInstance === myInstance) currentController = null;
      };

      try {
        const settings = await loadFullSettings(deps);
        if (!settings) {
          return { ok: false, code: "NO_API_KEY", reason: "未配置 AI apiKey" };
        }
        let diff: string;
        try {
          diff = await getStagedDiff(repoPath);
        } catch (e: unknown) {
          return {
            ok: false,
            code: "UNKNOWN",
            reason: `读取 staged diff 失败：${e instanceof Error ? e.message : String(e)}`,
          };
        }
        if (!diff || !diff.trim()) {
          return { ok: false, code: "NO_STAGED", reason: "无暂存改动可生成" };
        }
        if (ctrl.signal.aborted) {
          return { ok: false, code: "ABORT", reason: "已取消" };
        }
        const { truncated, fileSummary } = truncateDiff(diff, settings.maxDiffChars);
        const { system, user } = buildPrompt({
          diffText: truncated,
          fileSummary,
          settings,
        });

        let result = await chatCompletions(settings, system, user, ctrl.signal);
        if (
          !result.ok &&
          (result.code === "SERVER" || result.code === "NETWORK") &&
          !ctrl.signal.aborted
        ) {
          await new Promise((r) => setTimeout(r, 2000));
          if (!ctrl.signal.aborted) {
            result = await chatCompletions(settings, system, user, ctrl.signal);
          } else {
            return { ok: false, code: "ABORT", reason: "已取消" };
          }
        }
        return result;
      } finally {
        releaseIfMine();
      }
    },

    abort(): void {
      currentController?.abort("user-cancel");
      currentController = null;
    },
  };
}

export type AiService = ReturnType<typeof makeAiService>;
