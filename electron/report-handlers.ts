/**
 * Electron 主进程的 Daily Report handler 注册器。
 *
 * 与 ai-handlers 一样复用 safeStorage backed apiKey + userData/ai-settings.json
 * 公开配置（report 子段会自动跟随）。**完全不另起 storage**，符合「commit
 * 生成与日报润色共用同一份 API Key」的设计约束。
 */
import { app, ipcMain } from "electron";
import { promises as fs } from "fs";
import * as path from "path";
import { safeStorage } from "electron";
import {
  makeReportService,
  type ReportServiceDeps,
} from "../server/services/report.service";
import type { SecretStorage, PublicStorage } from "../server/services/ai.service";
import {
  DEFAULT_PUBLIC_AI_SETTINGS,
  type PublicAiSettings,
} from "../shared/ai/types";
import type {
  ReportFilter,
  ReportPolishInput,
} from "../shared/report/types";

interface ApiKeyFile {
  encrypted: boolean;
  value: string;
}

function configDir(): string {
  return app.getPath("userData");
}

function apiKeyPath(): string {
  return path.join(configDir(), "ai-apikey.json");
}

function settingsPath(): string {
  return path.join(configDir(), "ai-settings.json");
}

const electronSecretStorage: SecretStorage = {
  async getApiKey() {
    if (process.env.AI_API_KEY) return process.env.AI_API_KEY;
    try {
      const buf = await fs.readFile(apiKeyPath(), "utf-8");
      const parsed = JSON.parse(buf) as ApiKeyFile;
      if (!parsed.encrypted) return parsed.value || null;
      if (!safeStorage.isEncryptionAvailable()) return null;
      const plain = safeStorage.decryptString(Buffer.from(parsed.value, "base64"));
      return plain || null;
    } catch {
      return null;
    }
  },
  async saveApiKey() {
    // report 模块不直接写 apiKey；保存动作仍走 ai-handlers，避免双写造成不一致
    throw new Error("report handler does not save apiKey directly");
  },
};

const electronPublicStorage: PublicStorage = {
  async read() {
    try {
      const buf = await fs.readFile(settingsPath(), "utf-8");
      const parsed = JSON.parse(buf) as Partial<PublicAiSettings>;
      return { ...DEFAULT_PUBLIC_AI_SETTINGS, ...parsed };
    } catch {
      return null;
    }
  },
  async write() {
    // 同 saveApiKey；不在 report 端做配置写入
    throw new Error("report handler does not write settings directly");
  },
};

export function registerReportHandlers(): void {
  const deps: ReportServiceDeps = {
    secretStorage: electronSecretStorage,
    publicStorage: electronPublicStorage,
  };
  const svc = makeReportService(deps);

  ipcMain.handle("report:list_authors", async (_e, repos: string[], since?: string, until?: string) => {
    try {
      return await svc.listAuthors(Array.isArray(repos) ? repos : [], since, until);
    } catch (e: unknown) {
      console.error("[ipc:report:list_authors]", e);
      return [];
    }
  });

  ipcMain.handle("report:list_branches", async (_e, repos: string[]) => {
    try {
      return await svc.listBranches(Array.isArray(repos) ? repos : []);
    } catch (e: unknown) {
      console.error("[ipc:report:list_branches]", e);
      return {};
    }
  });

  ipcMain.handle("report:extract", async (_e, filter: ReportFilter) => {
    try {
      return await svc.extract(filter);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[ipc:report:extract]", msg);
      return { ok: false, code: "UNKNOWN", reason: msg };
    }
  });

  ipcMain.handle("report:polish", async (_e, input: ReportPolishInput) => {
    try {
      return await svc.polish(input);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[ipc:report:polish]", msg);
      return { ok: false, code: "UNKNOWN", reason: msg };
    }
  });

  ipcMain.handle("report:abort", async () => {
    svc.abort();
    return { ok: true };
  });
}
