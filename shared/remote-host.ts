/**
 * Remote Host 解析 · 把 git remote URL 解析到平台 + owner/repo + PR/Issue URL
 *
 * 支持的输入格式：
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo
 *   git@github.com:owner/repo.git
 *   ssh://git@github.com/owner/repo.git
 *   https://oauth2:TOKEN@github.com/owner/repo.git    （token 会被忽略）
 *
 * 支持的平台：github / gitlab / bitbucket / gitea / 其它（other）
 *
 * 用法：
 *   const meta = parseRemoteUrl("git@github.com:owner/repo.git");
 *   meta.pullRequestsUrl  // → https://github.com/owner/repo/pulls
 */
export type RemoteHost = "github" | "gitlab" | "bitbucket" | "gitea" | "other";

export interface RemoteMeta {
  /** 平台类型 */
  host: RemoteHost;
  /** 平台域名（github.com / gitlab.com / 自托管时为实际域名） */
  domain: string;
  /** owner / namespace（GitLab group） */
  owner: string;
  /** 仓库名（去 .git 后缀） */
  repo: string;
  /** 仓库主页 URL */
  homeUrl: string;
  /** PR / MR 列表页 URL（GitHub: /pulls, GitLab: /-/merge_requests, Bitbucket: /pull-requests/） */
  pullRequestsUrl: string;
  /** Issue 列表页 URL */
  issuesUrl: string;
}

/** 把 origin URL 解析为结构化 meta；无法识别返回 null。 */
export function parseRemoteUrl(url: string): RemoteMeta | null {
  if (typeof url !== "string" || url.trim().length === 0) return null;
  let cleaned = url.trim();

  // 去掉 user:token@ 前缀
  cleaned = cleaned.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, "$1");

  // 转换 ssh-form: git@github.com:owner/repo.git → https://github.com/owner/repo.git
  const sshMatch = cleaned.match(/^([\w.-]+@)([^:]+):(.+)$/);
  if (sshMatch) {
    cleaned = `https://${sshMatch[2]}/${sshMatch[3]}`;
  }

  // 去 .git 后缀
  cleaned = cleaned.replace(/\.git\/?$/, "");

  let u: URL;
  try {
    u = new URL(cleaned);
  } catch {
    return null;
  }

  const domain = u.hostname.toLowerCase();
  const segments = u.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  // GitLab 支持 namespace 嵌套：owner1/owner2/repo
  const repo = segments[segments.length - 1]!;
  const owner = segments.slice(0, -1).join("/");

  const host: RemoteHost = domain.includes("github.")
    ? "github"
    : domain.includes("gitlab.")
      ? "gitlab"
      : domain.includes("bitbucket.")
        ? "bitbucket"
        : domain.includes("gitea")
          ? "gitea"
          : "other";

  const homeUrl = `https://${domain}/${owner}/${repo}`;
  let pullRequestsUrl: string;
  let issuesUrl: string;
  switch (host) {
    case "github":
    case "gitea":
      pullRequestsUrl = `${homeUrl}/pulls`;
      issuesUrl = `${homeUrl}/issues`;
      break;
    case "gitlab":
      pullRequestsUrl = `${homeUrl}/-/merge_requests`;
      issuesUrl = `${homeUrl}/-/issues`;
      break;
    case "bitbucket":
      pullRequestsUrl = `${homeUrl}/pull-requests/`;
      issuesUrl = `${homeUrl}/issues`;
      break;
    default:
      pullRequestsUrl = homeUrl;
      issuesUrl = homeUrl;
  }

  return { host, domain, owner, repo, homeUrl, pullRequestsUrl, issuesUrl };
}
