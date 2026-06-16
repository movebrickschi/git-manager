/**
 * credential.service —— 应用内 Git HTTPS 凭据服务单测。
 *
 * 覆盖：host 归一化 / resolveHost（https/ssh/scp-like/端口）/ facade CRUD（注入内存存储）/
 * buildAuthEnv 命中与未命中 / 明文文件存储round-trip / askpass 脚本选值（execFile 真跑）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import {
  buildAuthEnv,
  buildAuthEnvForUrl,
  createPlainCredentialStorage,
  credentialFacade,
  normalizeHost,
  resolveHost,
  setAskpassDir,
  setCredentialStorage,
  type CredentialStorage,
  type ResolvedCredential,
} from "./credential.service.js";

const execFile = promisify(execFileCb);

function memStorage(): CredentialStorage & {
  map: Map<string, ResolvedCredential>;
} {
  const map = new Map<string, ResolvedCredential>();
  return {
    map,
    async get(host) {
      return map.get(host) ?? null;
    },
    async list() {
      return [...map.entries()].map(([host, v]) => ({
        host,
        username: v.username,
        hasToken: !!v.token,
      }));
    },
    async save(host, username, token) {
      map.set(host, { username, token });
    },
    async delete(host) {
      map.delete(host);
    },
  };
}

let askpassDir: string;

beforeEach(async () => {
  askpassDir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-cred-askpass-"));
  setAskpassDir(askpassDir);
});

afterEach(async () => {
  await fs.rm(askpassDir, { recursive: true, force: true });
});

describe("normalizeHost", () => {
  it("lowercases, strips scheme/userinfo/path, drops default 443", () => {
    expect(normalizeHost("HTTPS://Alice@GitHub.com:443/owner/repo.git")).toBe("github.com");
    expect(normalizeHost("github.com")).toBe("github.com");
    expect(normalizeHost("  GitHub.COM/ ")).toBe("github.com");
  });
  it("keeps non-default ports", () => {
    expect(normalizeHost("gitlab.example.com:8443")).toBe("gitlab.example.com:8443");
  });
  it("returns empty for blank", () => {
    expect(normalizeHost("")).toBe("");
    expect(normalizeHost("   ")).toBe("");
  });
});

describe("resolveHost", () => {
  it("returns host for https (port handling)", () => {
    expect(resolveHost("https://github.com/o/r.git")).toBe("github.com");
    expect(resolveHost("https://gitlab.example.com:8443/o/r.git")).toBe("gitlab.example.com:8443");
    expect(resolveHost("https://github.com:443/o/r.git")).toBe("github.com");
  });
  it("returns null for ssh / scp-like / git protocol (key-based, askpass not involved)", () => {
    expect(resolveHost("git@github.com:owner/repo.git")).toBeNull();
    expect(resolveHost("ssh://git@github.com:22/o/r.git")).toBeNull();
    expect(resolveHost("git://github.com/o/r.git")).toBeNull();
  });
  it("returns null for empty / unparseable", () => {
    expect(resolveHost("")).toBeNull();
    expect(resolveHost("not a url")).toBeNull();
  });
});

describe("credentialFacade CRUD (injected memory storage)", () => {
  let store: ReturnType<typeof memStorage>;
  beforeEach(() => {
    store = memStorage();
    setCredentialStorage(store);
  });

  it("saves under normalized host and lists without token", async () => {
    await credentialFacade.saveGitCredential("HTTPS://GitHub.com/", "alice", "tok_123");
    expect(store.map.get("github.com")).toEqual({ username: "alice", token: "tok_123" });
    const list = await credentialFacade.listGitCredentials();
    expect(list).toEqual([{ host: "github.com", username: "alice", hasToken: true }]);
    // 列表绝不含 token
    expect(JSON.stringify(list)).not.toContain("tok_123");
  });

  it("rejects empty host / empty token", async () => {
    await expect(credentialFacade.saveGitCredential("", "a", "t")).rejects.toThrow(/INVALID_HOST/);
    await expect(credentialFacade.saveGitCredential("github.com", "a", "")).rejects.toThrow(
      /INVALID_TOKEN/
    );
  });

  it("deletes under normalized host", async () => {
    await credentialFacade.saveGitCredential("github.com", "alice", "tok");
    await credentialFacade.deleteGitCredential("HTTPS://github.com:443/x");
    expect(store.map.has("github.com")).toBe(false);
  });
});

describe("buildAuthEnv / buildAuthEnvForUrl", () => {
  let store: ReturnType<typeof memStorage>;
  beforeEach(() => {
    store = memStorage();
    setCredentialStorage(store);
  });

  it("returns {} when no cached credential", async () => {
    expect(await buildAuthEnvForUrl("https://github.com/o/r.git")).toEqual({});
  });

  it("returns {} for ssh remote even if some cred exists", async () => {
    store.map.set("github.com", { username: "alice", token: "tok" });
    expect(await buildAuthEnvForUrl("git@github.com:o/r.git")).toEqual({});
  });

  it("returns GIT_ASKPASS env when credential cached, and the script selects values", async () => {
    store.map.set("github.com", { username: "alice", token: "s3cr3t" });
    const env = await buildAuthEnvForUrl("https://github.com/o/r.git");
    expect(env.GIT_ASKPASS).toBeTruthy();
    expect(env.GM_ASKPASS_USERNAME).toBe("alice");
    expect(env.GM_ASKPASS_PASSWORD).toBe("s3cr3t");
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");

    // 真跑生成的 askpass.js（包装脚本只是平台 shim），断言按 prompt 选值
    const askpassJs = path.join(askpassDir, "askpass.js");
    const runEnv = { ...process.env, ...env };
    const { stdout: u } = await execFile(
      process.execPath,
      [askpassJs, "Username for 'https://github.com': "],
      { env: runEnv }
    );
    expect(u).toBe("alice");
    const { stdout: p } = await execFile(
      process.execPath,
      [askpassJs, "Password for 'https://alice@github.com': "],
      { env: runEnv }
    );
    expect(p).toBe("s3cr3t");
  });

  it("buildAuthEnv resolves repo origin host (https→env, ssh→{})", async () => {
    store.map.set("github.com", { username: "alice", token: "tok" });

    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "gm-cred-repo-"));
    try {
      await execFile("git", ["-C", repo, "init", "-q"]);
      await execFile("git", ["-C", repo, "remote", "add", "origin", "https://github.com/o/r.git"]);
      const env = await buildAuthEnv(repo);
      expect(env.GM_ASKPASS_USERNAME).toBe("alice");

      await execFile("git", ["-C", repo, "remote", "set-url", "origin", "git@github.com:o/r.git"]);
      expect(await buildAuthEnv(repo)).toEqual({});
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
});

describe("createPlainCredentialStorage (file round-trip)", () => {
  it("persists token to disk and list hides it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-cred-file-"));
    try {
      const s = createPlainCredentialStorage(dir);
      await s.save("github.com", "alice", "tok_plain");
      expect(await s.get("github.com")).toEqual({ username: "alice", token: "tok_plain" });

      const onDisk = await fs.readFile(path.join(dir, "git-credentials.json"), "utf8");
      expect(onDisk).toContain("github.com");

      const list = await s.list();
      expect(list).toEqual([{ host: "github.com", username: "alice", hasToken: true }]);

      await s.delete("github.com");
      expect(await s.get("github.com")).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
