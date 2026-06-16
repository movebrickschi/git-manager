/**
 * 应用内 Git HTTPS 凭据服务（按 host 缓存）。
 *
 * 职责：
 *   1. 凭据 CRUD（save / list / delete）—— 经可替换的 CredentialStorage 后端持久化
 *      （Electron=safeStorage 加密；Web/默认=明文文件）。
 *   2. host 解析 —— 从远端 URL（https / ssh）归一化出主机键；仅 HTTPS 注入凭据。
 *   3. `buildAuthEnv(repoPath)` / `buildAuthEnvForUrl(url)` —— 命中缓存时生成 GIT_ASKPASS
 *      环境变量，让联网 git 透明鉴权；无缓存 / SSH / 无 remote → 返回 {}（几乎零成本）。
 *
 * 存储单例：因 save/list/delete 经 COMMANDS 自动布线进 facade，无法 per-call 注入依赖，
 * 故用模块级单例 `setCredentialStorage()`（各运行时启动时设置）。默认明文文件存储，
 * 因此 Web 模式无需显式接线即可用。
 *
 * 安全：token 仅存于加密文件（Electron）+ 调用时子进程 env；不进 argv、不写 git 明文
 * credential store、列表 API 绝不回 token 明文。
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { GitCredentialInfo } from "../../shared/types.js";
import { normalizeHost, resolveHost } from "../../shared/git/host.js";
import { getGit } from "./_helpers.js";
import { defaultAskpassDir, ensureAskpassScripts } from "./git-askpass.js";

// 主机解析为纯函数，抽到 shared 供前端凭据对话框复用；此处 re-export 保持旧导入路径不破坏。
export { normalizeHost, resolveHost };

/** 单条凭据的解密视图（仅内部 / buildAuthEnv 使用，绝不经 API 外泄）。 */
export interface ResolvedCredential {
  username: string;
  token: string;
}

/**
 * 凭据持久化后端。加解密由具体实现内部负责（Electron safeStorage / Web 明文），
 * 接口层面只交换**明文 token**。host 入参恒为已归一化的主机键。
 */
export interface CredentialStorage {
  /** 取某 host 的解密凭据；不存在 / 无法解密 → null。 */
  get(host: string): Promise<ResolvedCredential | null>;
  /** 列出全部凭据（**不含 token**）。 */
  list(): Promise<GitCredentialInfo[]>;
  /** 保存 / 覆盖某 host（token 明文传入，实现内部负责加密）。 */
  save(host: string, username: string, token: string): Promise<void>;
  /** 删除某 host 的凭据。 */
  delete(host: string): Promise<void>;
}

interface StoredRecord {
  username: string;
  /** 加密（base64）或明文的 token，由 encrypted 区分。 */
  secret: string;
  encrypted: boolean;
}
type StoreMap = Record<string, StoredRecord>;

/**
 * 默认明文文件存储：`~/.git-manager/git-credentials.json`。
 * 与 ai-apikey 明文策略一致，仅建议本机自用；Electron 会用 safeStorage 版覆盖。
 */
export function createPlainCredentialStorage(
  dir = path.join(os.homedir(), ".git-manager")
): CredentialStorage {
  const file = path.join(dir, "git-credentials.json");

  async function readMap(): Promise<StoreMap> {
    try {
      const buf = await fs.readFile(file, "utf8");
      return JSON.parse(buf) as StoreMap;
    } catch {
      return {};
    }
  }
  async function writeMap(map: StoreMap): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(map, null, 2), { mode: 0o600 });
  }

  return {
    async get(host) {
      const rec = (await readMap())[host];
      return rec ? { username: rec.username, token: rec.secret } : null;
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
      map[host] = { username, secret: token, encrypted: false };
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
}

let storage: CredentialStorage = createPlainCredentialStorage();
let askpassDir: string = defaultAskpassDir();

/** 由各运行时启动时调用，替换默认明文存储（如 Electron 的 safeStorage 版）。 */
export function setCredentialStorage(s: CredentialStorage): void {
  storage = s;
}

/** 由各运行时启动时调用，指定 askpass 脚本落盘目录（Electron=userData/askpass）。 */
export function setAskpassDir(dir: string): void {
  askpassDir = dir;
}

/** 解析仓库 origin（无 origin 则取首个 remote）的 HTTPS 主机键；无 / SSH → null。 */
export async function resolveRepoHost(repoPath: string): Promise<string | null> {
  try {
    const remotes = await getGit(repoPath).getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
    const url = origin?.refs?.push || origin?.refs?.fetch || "";
    return url ? resolveHost(url) : null;
  } catch {
    return null;
  }
}

async function buildAuthEnvForHost(host: string): Promise<Record<string, string>> {
  const cred = await storage.get(host);
  if (!cred || !cred.token) return {};
  const { askpassPath } = await ensureAskpassScripts(askpassDir);
  return {
    GIT_ASKPASS: askpassPath,
    GM_ASKPASS_NODE: process.execPath,
    // 让 electron 可执行以纯 node 模式跑 askpass.js；纯 node/web 下忽略，无副作用。
    ELECTRON_RUN_AS_NODE: "1",
    GM_ASKPASS_USERNAME: cred.username,
    GM_ASKPASS_PASSWORD: cred.token,
  };
}

/** 为某仓库的联网 git 构造 askpass 鉴权环境；无缓存 / SSH / 无 remote → {}。 */
export async function buildAuthEnv(repoPath: string): Promise<Record<string, string>> {
  const host = await resolveRepoHost(repoPath);
  return host ? buildAuthEnvForHost(host) : {};
}

/** clone 场景：尚无 repoPath，直接按 URL 解析 host 构造鉴权环境。 */
export async function buildAuthEnvForUrl(remoteUrl: string): Promise<Record<string, string>> {
  const host = resolveHost(remoteUrl);
  return host ? buildAuthEnvForHost(host) : {};
}

/**
 * 经 COMMANDS 自动布线进 git-service facade 的凭据命令。
 * save/delete 不跑 git，不纳入 WRITE_COMMANDS（无需冻结后台刷新）。
 */
export const credentialFacade = {
  async saveGitCredential(host: string, username: string, token: string): Promise<void> {
    const key = normalizeHost(host);
    if (!key) throw new Error("INVALID_HOST: host 不能为空");
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("INVALID_TOKEN: token 不能为空");
    }
    await storage.save(key, username ?? "", token);
  },
  async listGitCredentials(): Promise<GitCredentialInfo[]> {
    return storage.list();
  },
  async deleteGitCredential(host: string): Promise<void> {
    await storage.delete(normalizeHost(host));
  },
};
