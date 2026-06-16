/**
 * Electron 主进程的 Git 凭据存储（safeStorage 加密版）。
 *
 * - token 走 safeStorage（macOS Keychain / Win DPAPI / Linux libsecret）加密后落 userData。
 * - safeStorage 不可用（部分 Linux 无 libsecret）时降级明文 + warn 一次（与 ai-apikey 一致）。
 * - 列表只回 {host, username, hasToken}，绝不回 token 明文。
 * - 启动时把本实现 + askpass 目录注入 credential.service 的模块单例。
 */
import { app, safeStorage } from "electron";
import { promises as fs } from "fs";
import * as path from "path";
import {
  setAskpassDir,
  setCredentialStorage,
  type CredentialStorage,
} from "../server/services/credential.service";

interface StoredRecord {
  username: string;
  secret: string;
  encrypted: boolean;
}
type StoreMap = Record<string, StoredRecord>;

function credFile(): string {
  return path.join(app.getPath("userData"), "git-credentials.json");
}

async function readMap(): Promise<StoreMap> {
  try {
    return JSON.parse(await fs.readFile(credFile(), "utf8")) as StoreMap;
  } catch {
    return {};
  }
}

async function writeMap(map: StoreMap): Promise<void> {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(credFile(), JSON.stringify(map, null, 2), { mode: 0o600 });
}

const electronCredentialStorage: CredentialStorage = {
  async get(host) {
    const rec = (await readMap())[host];
    if (!rec) return null;
    if (!rec.encrypted) return { username: rec.username, token: rec.secret };
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn("[credential] safeStorage unavailable; encrypted token cannot be decrypted");
      return null;
    }
    try {
      const token = safeStorage.decryptString(Buffer.from(rec.secret, "base64"));
      return { username: rec.username, token };
    } catch {
      return null;
    }
  },
  async list() {
    const map = await readMap();
    return Object.entries(map).map(([host, rec]) => ({
      host,
      username: rec.username,
      hasToken: !!rec.secret,
    }));
  },
  async save(host, username, token) {
    const map = await readMap();
    if (safeStorage.isEncryptionAvailable()) {
      map[host] = {
        username,
        secret: safeStorage.encryptString(token).toString("base64"),
        encrypted: true,
      };
    } else {
      console.warn("[credential] safeStorage unavailable; storing token in plaintext");
      map[host] = { username, secret: token, encrypted: false };
    }
    await writeMap(map);
  },
  async delete(host) {
    const map = await readMap();
    if (map[host]) {
      delete map[host];
      await writeMap(map);
    }
  },
};

/** 在 app ready 后调用：注入 safeStorage 凭据存储 + askpass 落盘目录。 */
export function setupElectronCredentialStorage(): void {
  setCredentialStorage(electronCredentialStorage);
  setAskpassDir(path.join(app.getPath("userData"), "askpass"));
}
