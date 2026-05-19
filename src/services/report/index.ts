/**
 * Daily Report · 前端双模式桥（Electron IPC / Web HTTP）。
 *
 * 与 src/services/ai 保持完全同型的调用约定，便于复用与同样的测试模式。
 */
import type {
  AuthorSuggestion,
  RepoBranchInfo,
  ReportExtractResult,
  ReportFilter,
  ReportPolishInput,
  ReportPolishResult,
} from "../../../shared/report/types";

export interface ReportBridge {
  listAuthors(repos: string[], since?: string, until?: string): Promise<AuthorSuggestion[]>;
  listBranches(repos: string[]): Promise<Record<string, RepoBranchInfo>>;
  extract(filter: ReportFilter): Promise<ReportExtractResult>;
  polish(input: ReportPolishInput): Promise<ReportPolishResult>;
  abort(): Promise<void>;
}

function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI;
}

/**
 * 把 Vue 响应式 Proxy / 函数 / class 实例 等不能被 structured clone 的对象，
 * 一次性"塌平"为可序列化的 plain object。
 *
 * Electron `ipcRenderer.invoke` 用 structured clone 算法，遇到 Proxy 会抛
 * `An object could not be cloned`。所有 DTO 我们都已经约束为 plain object，
 * 因此用 JSON 套路足够安全（不会丢失字段）。
 */
function toCloneable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createElectronBridge(): ReportBridge {
  const api = window.electronAPI!;
  return {
    listAuthors: (repos, since, until) =>
      api.invoke("report:list_authors", toCloneable(repos), since, until) as Promise<
        AuthorSuggestion[]
      >,
    listBranches: (repos) =>
      api.invoke("report:list_branches", toCloneable(repos)) as Promise<
        Record<string, RepoBranchInfo>
      >,
    extract: (filter) =>
      api.invoke("report:extract", toCloneable(filter)) as Promise<ReportExtractResult>,
    polish: (input) =>
      api.invoke("report:polish", toCloneable(input)) as Promise<ReportPolishResult>,
    abort: async () => {
      await api.invoke("report:abort");
    },
  };
}

async function webPost<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status >= 500) {
    throw new Error(`服务器错误 (${res.status})`);
  }
  const json = (await res.json()) as { success: boolean; data?: T; error?: string };
  if (!json.success) throw new Error(json.error ?? "请求失败");
  return json.data as T;
}

function createWebBridge(): ReportBridge {
  return {
    listAuthors: (repos, since, until) =>
      webPost<AuthorSuggestion[]>("/report/authors", { repos, since, until }),
    listBranches: (repos) => webPost<Record<string, RepoBranchInfo>>("/report/branches", { repos }),
    extract: (filter) => webPost<ReportExtractResult>("/report/extract", filter),
    polish: (input) => webPost<ReportPolishResult>("/report/polish", input),
    abort: async () => {
      await webPost("/report/abort");
    },
  };
}

export const reportBridge: ReportBridge = isElectron()
  ? createElectronBridge()
  : createWebBridge();
