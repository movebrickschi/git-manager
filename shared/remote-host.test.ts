/**
 * parseRemoteUrl · 单测
 *
 * 覆盖 5 大类输入：https / ssh-form (git@host:owner/repo) / ssh proto
 * (ssh://git@host/...) / token URL / 异常 URL，以及 4 个平台：
 * github / gitlab / bitbucket / gitea。
 */
import { describe, expect, it } from "vitest";
import { parseRemoteUrl } from "./remote-host.js";

describe("parseRemoteUrl · GitHub", () => {
  it.each([
    "https://github.com/movebrickschi/git-manager.git",
    "https://github.com/movebrickschi/git-manager",
    "git@github.com:movebrickschi/git-manager.git",
    "ssh://git@github.com/movebrickschi/git-manager.git",
    "https://oauth2:GITHUB_TOKEN@github.com/movebrickschi/git-manager.git",
  ])("各种 URL 形式都解析到 owner/repo + GitHub host: %s", (url) => {
    const meta = parseRemoteUrl(url)!;
    expect(meta).not.toBeNull();
    expect(meta.host).toBe("github");
    expect(meta.domain).toBe("github.com");
    expect(meta.owner).toBe("movebrickschi");
    expect(meta.repo).toBe("git-manager");
    expect(meta.pullRequestsUrl).toBe("https://github.com/movebrickschi/git-manager/pulls");
    expect(meta.issuesUrl).toBe("https://github.com/movebrickschi/git-manager/issues");
    expect(meta.homeUrl).toBe("https://github.com/movebrickschi/git-manager");
  });
});

describe("parseRemoteUrl · GitLab + 嵌套 namespace", () => {
  it("gitlab.com 顶层", () => {
    const meta = parseRemoteUrl("https://gitlab.com/group1/repo.git")!;
    expect(meta.host).toBe("gitlab");
    expect(meta.owner).toBe("group1");
    expect(meta.pullRequestsUrl).toBe("https://gitlab.com/group1/repo/-/merge_requests");
  });

  it("GitLab 多级 namespace", () => {
    const meta = parseRemoteUrl("https://gitlab.example.com/team/sub-team/repo.git")!;
    expect(meta.host).toBe("gitlab");
    expect(meta.domain).toBe("gitlab.example.com");
    expect(meta.owner).toBe("team/sub-team");
    expect(meta.repo).toBe("repo");
  });
});

describe("parseRemoteUrl · Bitbucket / Gitea / other", () => {
  it("Bitbucket", () => {
    const meta = parseRemoteUrl("https://bitbucket.org/owner/repo.git")!;
    expect(meta.host).toBe("bitbucket");
    expect(meta.pullRequestsUrl).toBe("https://bitbucket.org/owner/repo/pull-requests/");
  });

  it("Gitea（自托管）", () => {
    const meta = parseRemoteUrl("https://gitea.example.com/user/repo.git")!;
    expect(meta.host).toBe("gitea");
    expect(meta.pullRequestsUrl).toBe("https://gitea.example.com/user/repo/pulls");
  });

  it("未知平台 fallback 到 other", () => {
    const meta = parseRemoteUrl("https://my-git.example.org/user/repo.git")!;
    expect(meta.host).toBe("other");
    expect(meta.pullRequestsUrl).toBe(meta.homeUrl);
  });
});

describe("parseRemoteUrl · 异常输入", () => {
  it.each(["", "   ", "not-a-url", "https://"])("非法输入返回 null: %s", (s) => {
    expect(parseRemoteUrl(s)).toBeNull();
  });

  it("非 string 输入也安全", () => {
    expect(parseRemoteUrl(123 as unknown as string)).toBeNull();
  });
});
