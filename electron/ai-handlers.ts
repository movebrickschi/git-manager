/**
 * Electron 主进程的 AI handler 注册器。
 *
 * - apiKey 走 safeStorage（macOS Keychain / Win DPAPI / Linux libsecret）加密
 * - 非密配置走 userData 下的 ai-settings.json
 * - safeStorage 在部分 Linux 桌面（无 libsecret）不可用，降级为明文写入并打印 warn
 * - 环境变量 AI_API_KEY 优先级最高（CI / 开发自测可绕过 keychain）
 */
import { app, ipcMain, safeStorage } from "electron";
import { promises as fs } from "fs";
import * as path from "path";
import {
  makeAiService,
  type PublicStorage,
  type SecretStorage,
} from "../server/services/ai.service";
import {
  DEFAULT_PUBLIC_AI_SETTINGS,
  type AiSettings,
  type PublicAiSettings,
} from "../shared/ai/types";

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

async function ensureDir(): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true });
}

const electronSecretStorage: SecretStorage = {
  async getApiKey() {
    if (process.env.AI_API_KEY) return process.env.AI_API_KEY;
    try {
      const buf = await fs.readFile(apiKeyPath(), "utf-8");
      const parsed = JSON.parse(buf) as ApiKeyFile;
      if (!parsed.encrypted) return parsed.value || null;
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn("[ai] safeStorage unavailable; encrypted apiKey cannot be decrypted");
        return null;
      }
      const plain = safeStorage.decryptString(Buffer.from(parsed.value, "base64"));
      return plain || null;
    } catch {
      return null;
    }
  },
  async saveApiKey(plain) {
    await ensureDir();
    let payload: ApiKeyFile;
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(plain);
      payload = { encrypted: true, value: enc.toString("base64") };
    } else {
      console.warn("[ai] safeStorage unavailable; storing apiKey in plaintext");
      payload = { encrypted: false, value: plain };
    }
    await fs.writeFile(apiKeyPath(), JSON.stringify(payload), { mode: 0o600 });
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
  async write(s) {
    await ensureDir();
    await fs.writeFile(settingsPath(), JSON.stringify(s, null, 2), { mode: 0o644 });
  },
};

export function registerAiHandlers(): void {
  const svc = makeAiService({
    secretStorage: electronSecretStorage,
    publicStorage: electronPublicStorage,
  });

  ipcMain.handle("ai:generate", async (_e, repoPath: string) => {
    if (typeof repoPath !== "string" || !repoPath) {
      return { ok: false, code: "UNKNOWN", reason: "repoPath 缺失" };
    }
    try {
      return await svc.generate(repoPath);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[ipc:ai:generate] unexpected:", msg);
      return { ok: false, code: "UNKNOWN", reason: msg };
    }
  });

  ipcMain.handle("ai:get_settings", async () => {
    try {
      return await svc.getSettingsView();
    } catch (e: unknown) {
      console.error("[ipc:ai:get_settings]", e);
      return { ...DEFAULT_PUBLIC_AI_SETTINGS, hasApiKey: false };
    }
  });

  ipcMain.handle("ai:save_settings", async (_e, settings: AiSettings) => {
    await svc.saveSettings(settings);
    return { ok: true };
  });

  ipcMain.handle("ai:test_connection", async (_e, settings: AiSettings) => {
    try {
      return await svc.testConnection(settings);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, code: "UNKNOWN", reason: msg };
    }
  });

  ipcMain.handle("ai:abort", async () => {
    svc.abort();
    return { ok: true };
  });
}
