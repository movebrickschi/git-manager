/**
 * Git 远端主机解析（纯函数，浏览器 + Node 共用，无任何 node 依赖）。
 *
 * 凭据按 host 缓存，存取两侧都必须用**同一套**归一化规则，否则 buildAuthEnv 取不到
 * 用户刚存的凭据。故抽到 shared 供 server（credential.service）与前端（凭据对话框）共用。
 */

/**
 * 归一化主机键：小写、去 scheme / userinfo / 路径、去 https 默认端口 443；保留非默认端口。
 * 例：`HTTPS://Alice@GitHub.com:443/x` → `github.com`；`gitlab.example.com:8443` 保留端口。
 */
export function normalizeHost(host: string): string {
  let h = (host ?? "").trim().toLowerCase();
  if (!h) return "";
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // 去 scheme://
  h = h.replace(/^[^@/]*@/, ""); // 去 userinfo@
  h = h.replace(/[/?#].*$/, ""); // 去 path / query / fragment
  h = h.replace(/:443$/, ""); // 去 https 默认端口
  return h;
}

/**
 * 从远端 URL 解析主机键。**仅 HTTPS/HTTP 返回 host**；SSH（`git@host:` / `ssh://`）/ git:// 返回
 * null —— 走密钥，askpass 不介入。无法解析 → null。
 */
export function resolveHost(remoteUrl: string): string | null {
  const url = (remoteUrl ?? "").trim();
  if (!url) return null;
  // scp-like ssh：git@github.com:owner/repo.git（无 scheme，但有 user@host:）
  if (/^[^/\s]+@[^/\s]+:/.test(url) && !/^https?:\/\//i.test(url)) return null;
  if (/^ssh:\/\//i.test(url) || /^git:\/\//i.test(url)) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    let host = u.hostname.toLowerCase();
    if (u.port && u.port !== "443" && u.port !== "80") host += `:${u.port}`;
    return host || null;
  } catch {
    return null;
  }
}
