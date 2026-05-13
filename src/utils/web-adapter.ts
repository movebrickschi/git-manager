import type { Commands, Platform } from "./types";
import { COMMANDS } from "../../shared/command-manifest";

const BASE = "/api";

async function post<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("无法连接后端服务，请确认服务器已启动");
  }
  if (!res.ok && res.status >= 500) {
    let msg = `服务器错误 (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) msg = json.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }
  const json = (await res.json()) as { success: boolean; data?: T; error?: string };
  if (!json.success) throw new Error(json.error ?? "请求失败");
  return json.data as T;
}

export function createWebAdapter(): Commands {
  const out: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const spec of COMMANDS) {
    out[spec.method] = (...args: unknown[]) => {
      const body: Record<string, unknown> = {};
      spec.bodyKeys.forEach((k, i) => {
        body[k] = args[i];
      });
      return post(spec.http, body);
    };
  }
  return out as unknown as Commands;
}

export function createWebPlatform(): Platform {
  return {
    isElectron: false,
    selectDirectory: () => {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.setAttribute("webkitdirectory", "");
        input.setAttribute("directory", "");
        input.onchange = () => {
          const files = input.files;
          if (files && files.length > 0) {
            const relativePath = files[0]!.webkitRelativePath;
            const dirName = relativePath.split("/")[0] ?? null;
            resolve(dirName);
          } else {
            resolve(null);
          }
        };
        input.oncancel = () => resolve(null);
        input.click();
      });
    },
  };
}
