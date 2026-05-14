import type {
  AiGenerateResult,
  AiSettings,
  AiSettingsView,
  AiTestResult,
} from "../../../shared/ai/types";

export interface AiBridge {
  generate(repoPath: string): Promise<AiGenerateResult>;
  getSettings(): Promise<AiSettingsView>;
  saveSettings(s: AiSettings): Promise<void>;
  testConnection(s: AiSettings): Promise<AiTestResult>;
  abort(): Promise<void>;
}

function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI;
}

function createElectronBridge(): AiBridge {
  const api = window.electronAPI!;
  return {
    generate: (repoPath) => api.invoke("ai:generate", repoPath) as Promise<AiGenerateResult>,
    getSettings: () => api.invoke("ai:get_settings") as Promise<AiSettingsView>,
    saveSettings: async (s) => {
      await api.invoke("ai:save_settings", s);
    },
    testConnection: (s) => api.invoke("ai:test_connection", s) as Promise<AiTestResult>,
    abort: async () => {
      await api.invoke("ai:abort");
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

async function webGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok && res.status >= 500) {
    throw new Error(`服务器错误 (${res.status})`);
  }
  const json = (await res.json()) as { success: boolean; data?: T; error?: string };
  if (!json.success) throw new Error(json.error ?? "请求失败");
  return json.data as T;
}

function createWebBridge(): AiBridge {
  return {
    generate: (repoPath) => webPost<AiGenerateResult>("/ai/generate", { repoPath }),
    getSettings: () => webGet<AiSettingsView>("/ai/settings"),
    saveSettings: async (s) => {
      await webPost("/ai/settings", s);
    },
    testConnection: (s) => webPost<AiTestResult>("/ai/test-connection", s),
    abort: async () => {
      await webPost("/ai/abort");
    },
  };
}

export const aiBridge: AiBridge = isElectron() ? createElectronBridge() : createWebBridge();
