import { describe, it, expect, vi, beforeEach } from "vitest";

// 顶层 hoist：必须在 import remoteService 之前 mock _helpers
vi.mock("./_helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_helpers.js")>();
  return {
    ...actual,
    getGit: vi.fn(),
    getRemoteGit: vi.fn(),
    getConflictFiles: vi.fn(),
  };
});

// 联网命令（push/pull/fetch）现在走 git-net 的可杀子进程，不再调 simple-git 实例，
// 因此这里 mock 掉 git-net，断言改为针对 runNetworkGit。
vi.mock("./git-net.js", () => ({
  runNetworkGit: vi.fn(),
  cancelNetworkGit: vi.fn(),
}));

import { remoteService } from "./remote.service.js";
import { getGit, getRemoteGit, getConflictFiles } from "./_helpers.js";
import { runNetworkGit } from "./git-net.js";

interface MockGit {
  status: ReturnType<typeof vi.fn>;
  raw: ReturnType<typeof vi.fn>;
  branch: ReturnType<typeof vi.fn>;
  getRemotes: ReturnType<typeof vi.fn>;
}

function makeMockGit(): MockGit {
  return {
    status: vi.fn(),
    raw: vi.fn(),
    branch: vi.fn(),
    getRemotes: vi.fn(),
  };
}

function statusClean() {
  return { files: [], conflicted: [] };
}

function statusDirty() {
  return { files: [{ path: "a.ts", index: " ", working_dir: "M" }], conflicted: [] };
}

describe("remoteService.pull · Smart Pull", () => {
  let mockGit: MockGit;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGit = makeMockGit();
    vi.mocked(getGit).mockReturnValue(mockGit as never);
    vi.mocked(getRemoteGit).mockReturnValue(mockGit as never);
    vi.mocked(getConflictFiles).mockResolvedValue([]);
    // 联网 pull 默认成功；本地 stash/status 仍走 mockGit。
    vi.mocked(runNetworkGit).mockResolvedValue("");
  });

  // -------------------------------------------------------------------------
  // 1) Clean tree
  // -------------------------------------------------------------------------

  it("【1】clean tree + pull 成功 → success, 不调 stash", async () => {
    mockGit.status.mockResolvedValue(statusClean());

    const r = await remoteService.pull("/repo");

    expect(r).toEqual({ success: true, conflicts: [], message: "拉取完成" });
    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["pull"], { extraEnv: {} });
    expect(mockGit.raw).not.toHaveBeenCalled();
  });

  it("【2】clean tree + pull 失败（网络）→ success=false, conflicts=[]", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    vi.mocked(runNetworkGit).mockRejectedValueOnce(new Error("could not resolve host: github.com"));
    vi.mocked(getConflictFiles).mockResolvedValue([]);

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual([]);
    expect(r.message).toMatch(/could not resolve host/);
  });

  it("【3】clean tree + pull 失败 + 产生 merge conflict → conflicts 非空", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    vi.mocked(runNetworkGit).mockRejectedValueOnce(new Error("CONFLICT (content)"));
    vi.mocked(getConflictFiles).mockResolvedValue(["foo.ts", "bar.ts"]);

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual(["foo.ts", "bar.ts"]);
    expect(r.message).toMatch(/CONFLICT/);
  });

  // -------------------------------------------------------------------------
  // 2) Dirty tree → auto stash
  // -------------------------------------------------------------------------

  it("【4】dirty tree + stash+pull+pop 全部成功 → message 含 auto-stashed", async () => {
    mockGit.status.mockResolvedValue(statusDirty());
    mockGit.raw.mockResolvedValue(""); // stash push + stash pop

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(true);
    expect(r.conflicts).toEqual([]);
    expect(r.message).toMatch(/auto-stashed.*restored/);
    // raw 只负责 stash push + stash pop；pull 走 runNetworkGit
    expect(mockGit.raw).toHaveBeenCalledTimes(2);
    expect(mockGit.raw.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(["stash", "push", "--include-untracked"])
    );
    expect(mockGit.raw.mock.calls[1]?.[0]).toEqual(["stash", "pop", "--index"]);
    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["pull"], { extraEnv: {} });
  });

  it("【5】dirty tree + stash 失败 → 早返回，不调 pull", async () => {
    mockGit.status.mockResolvedValue(statusDirty());
    mockGit.raw.mockRejectedValueOnce(new Error("index.lock exists"));

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual([]);
    expect(r.message).toMatch(/Auto stash failed/);
    expect(r.message).toMatch(/index\.lock/);
    expect(mockGit.raw).toHaveBeenCalledTimes(1);
    expect(runNetworkGit).not.toHaveBeenCalled();
  });

  it("【6】dirty tree + stash 成功 + pull 失败（网络）→ 自动 pop stash 回滚", async () => {
    mockGit.status.mockResolvedValue(statusDirty());
    mockGit.raw.mockResolvedValue(""); // stash push + stash pop (rollback)
    vi.mocked(runNetworkGit).mockRejectedValueOnce(new Error("could not resolve host"));
    vi.mocked(getConflictFiles).mockResolvedValue([]);

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual([]);
    expect(r.message).toMatch(/could not resolve host/);
    expect(mockGit.raw).toHaveBeenCalledTimes(2); // push + pop
    // 回滚路径首选 stash pop --index 以保留原 staging
    expect(mockGit.raw.mock.calls[1]?.[0]).toEqual(["stash", "pop", "--index"]);
  });

  it("【7】dirty tree + stash + pull 成功 + pop 冲突 → conflicts 非空 + 提示 drop stash", async () => {
    mockGit.status.mockResolvedValue(statusDirty());
    mockGit.raw
      .mockResolvedValueOnce("") // stash push
      .mockRejectedValueOnce(new Error("CONFLICT in stash pop")); // stash pop fail
    vi.mocked(getConflictFiles).mockResolvedValue(["a.ts"]);

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual(["a.ts"]);
    expect(r.message).toMatch(/restoring stashed local changes/);
    expect(r.message).toMatch(/stash@\{0\}/);
  });

  it("【8】dirty tree + stash + pull 成功 + pop 失败 (非冲突) → 提示 stash 仍可恢复", async () => {
    mockGit.status.mockResolvedValue(statusDirty());
    mockGit.raw
      .mockResolvedValueOnce("") // stash push
      .mockRejectedValueOnce(new Error("io error")); // stash pop fail
    vi.mocked(getConflictFiles).mockResolvedValue([]);

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual([]);
    expect(r.message).toMatch(/stash pop failed.*io error/);
    expect(r.message).toMatch(/stash@\{0\}/);
  });

  it("【9】dirty tree + stash + pull 阶段产生 conflict → 不 pop stash", async () => {
    mockGit.status.mockResolvedValue(statusDirty());
    mockGit.raw.mockResolvedValueOnce(""); // stash push
    vi.mocked(runNetworkGit).mockRejectedValueOnce(new Error("CONFLICT (content)")); // pull conflict
    vi.mocked(getConflictFiles).mockResolvedValue(["x.ts"]);

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual(["x.ts"]);
    expect(r.message).toMatch(/CONFLICT/);
    // 仅 stash push 一次 raw（pull 走 runNetworkGit 且失败 → 不 pop）
    expect(mockGit.raw).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 3) status 读失败
  // -------------------------------------------------------------------------

  it("【10】git status 失败 → 早返回，不调 pull", async () => {
    mockGit.status.mockRejectedValue(new Error("fatal: not a git repository"));

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual([]);
    expect(r.message).toMatch(/not a git repository/);
    expect(mockGit.raw).not.toHaveBeenCalled();
    expect(runNetworkGit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4) 参数透传：remote + rebase
  // -------------------------------------------------------------------------

  it("【11】rebase=true → pull 命令带 --rebase", async () => {
    mockGit.status.mockResolvedValue(statusClean());

    await remoteService.pull("/repo", undefined, true);

    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["pull", "--rebase"], { extraEnv: {} });
  });

  it("【12】remote=origin → pull 命令带 origin", async () => {
    mockGit.status.mockResolvedValue(statusClean());

    await remoteService.pull("/repo", "origin");

    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["pull", "origin"], { extraEnv: {} });
  });

  it("【13】rebase=true + remote=origin → ['pull', '--rebase', 'origin']", async () => {
    mockGit.status.mockResolvedValue(statusClean());

    await remoteService.pull("/repo", "origin", true);

    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["pull", "--rebase", "origin"], {
      extraEnv: {},
    });
  });

  // -------------------------------------------------------------------------
  // 5) 无上游分支的 Pull 兜底：显式 pull <remote> <branch> + 建立 upstream
  // -------------------------------------------------------------------------

  it("【14】无 upstream + 远端有同名分支 → pull origin <branch> 且成功后建立 upstream", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw.mockImplementation((args: string[]) => {
      const a = args.join(" ");
      if (a.includes("rev-parse --abbrev-ref HEAD")) return Promise.resolve("dev\n");
      if (a.includes("@{u}")) return Promise.reject(new Error("fatal: no upstream configured"));
      if (a.startsWith("show-ref")) return Promise.resolve(""); // refs/remotes/origin/dev 存在
      if (a.includes("--set-upstream-to")) return Promise.resolve("");
      return Promise.resolve("");
    });

    const r = await remoteService.pull("/repo", "origin");

    expect(r.success).toBe(true);
    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["pull", "origin", "dev"], { extraEnv: {} });
    expect(mockGit.raw).toHaveBeenCalledWith(["branch", "--set-upstream-to=origin/dev"]);
  });

  it("【15】无 upstream + 远端无同名分支 → 维持 pull origin（不带分支、不建 upstream）", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw.mockImplementation((args: string[]) => {
      const a = args.join(" ");
      if (a.includes("rev-parse --abbrev-ref HEAD")) return Promise.resolve("dev\n");
      if (a.includes("@{u}")) return Promise.reject(new Error("fatal: no upstream configured"));
      if (a.startsWith("show-ref")) return Promise.reject(new Error("not a valid ref")); // 远端无同名分支
      return Promise.resolve("");
    });

    await remoteService.pull("/repo", "origin");

    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["pull", "origin"], { extraEnv: {} });
    expect(mockGit.raw).not.toHaveBeenCalledWith(
      expect.arrayContaining(["branch", "--set-upstream-to=origin/dev"])
    );
  });

  it("【16】已有 upstream → pull origin（不追加显式分支、不建 upstream）", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw.mockImplementation((args: string[]) => {
      const a = args.join(" ");
      if (a.includes("rev-parse --abbrev-ref HEAD")) return Promise.resolve("dev\n");
      if (a.includes("@{u}")) return Promise.resolve("origin/dev\n"); // 已有 upstream
      return Promise.resolve("");
    });

    await remoteService.pull("/repo", "origin");

    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["pull", "origin"], { extraEnv: {} });
    // 已有 upstream：不应查 show-ref，也不应建 upstream
    expect(mockGit.raw).not.toHaveBeenCalledWith(
      expect.arrayContaining(["show-ref"])
    );
  });
});

describe("remoteService.previewPullConflicts · IDEA-style preview", () => {
  let mockGit: MockGit;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGit = makeMockGit();
    vi.mocked(getGit).mockReturnValue(mockGit as never);
    vi.mocked(getRemoteGit).mockReturnValue(mockGit as never);
    // fetch 默认成功（走 runNetworkGit）
    vi.mocked(runNetworkGit).mockResolvedValue("");
  });

  it("【preview-1】clean tree + upstream 配置 + remote 落后 → 空 dirty / 0 commits ahead", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw.mockResolvedValueOnce("origin/main\n").mockResolvedValueOnce("0\n");

    const r = await remoteService.previewPullConflicts("/repo");

    expect(r.dirtyFiles).toEqual([]);
    expect(r.wouldConflict).toEqual([]);
    expect(r.safe).toEqual([]);
    expect(r.upstream).toBe("origin/main");
    expect(r.remoteCommitsAhead).toBe(0);
    expect(r.fetched).toBe(true);
  });

  it("【preview-2】dirty tree + remote 改了相同文件 → wouldConflict 命中", async () => {
    mockGit.status.mockResolvedValue({
      files: [
        { path: "a.ts", index: "M", working_dir: " " },
        { path: "b.ts", index: " ", working_dir: "M" },
        { path: "c.ts", index: "?", working_dir: "?" },
      ],
      conflicted: [],
    });
    mockGit.raw
      .mockResolvedValueOnce("origin/main\n")
      .mockResolvedValueOnce("3\n")
      .mockResolvedValueOnce("a.ts\nd.ts\n");

    const r = await remoteService.previewPullConflicts("/repo");

    expect(new Set(r.dirtyFiles)).toEqual(new Set(["a.ts", "b.ts", "c.ts"]));
    expect(r.wouldConflict).toEqual(["a.ts"]);
    expect(new Set(r.safe)).toEqual(new Set(["b.ts", "c.ts"]));
    expect(r.upstream).toBe("origin/main");
    expect(r.remoteCommitsAhead).toBe(3);
    expect(r.fetched).toBe(true);
  });

  it("【preview-3】fetch 失败 → fetched=false 但仍返回预测", async () => {
    vi.mocked(runNetworkGit).mockRejectedValue(new Error("could not resolve host"));
    mockGit.status.mockResolvedValue(statusDirty());
    mockGit.raw.mockResolvedValueOnce("origin/main\n").mockResolvedValueOnce("0\n");

    const r = await remoteService.previewPullConflicts("/repo");

    expect(r.fetched).toBe(false);
    expect(r.dirtyFiles).toEqual(["a.ts"]);
    expect(r.upstream).toBe("origin/main");
  });

  it("【preview-4】没配 upstream（新分支没 push 过）→ upstream=null, remoteCommitsAhead=0", async () => {
    mockGit.status.mockResolvedValue(statusDirty());
    mockGit.raw.mockRejectedValueOnce(new Error("fatal: no upstream"));

    const r = await remoteService.previewPullConflicts("/repo");

    expect(r.upstream).toBeNull();
    expect(r.remoteCommitsAhead).toBe(0);
    expect(r.dirtyFiles).toEqual(["a.ts"]);
    expect(r.wouldConflict).toEqual([]);
    expect(r.safe).toEqual(["a.ts"]);
  });

  it("【preview-5】diff 失败 → 退化为全部 dirty 当冲突，避免误判 safe", async () => {
    mockGit.status.mockResolvedValue({
      files: [
        { path: "a.ts", index: "M", working_dir: " " },
        { path: "b.ts", index: " ", working_dir: "M" },
      ],
      conflicted: [],
    });
    mockGit.raw
      .mockResolvedValueOnce("origin/main\n")
      .mockResolvedValueOnce("5\n")
      .mockRejectedValueOnce(new Error("fatal: bad revision"));

    const r = await remoteService.previewPullConflicts("/repo");

    expect(new Set(r.wouldConflict)).toEqual(new Set(["a.ts", "b.ts"]));
    expect(r.safe).toEqual([]);
  });

  it("【preview-6】remote=origin → fetch 命令带 origin", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw.mockResolvedValueOnce("origin/main\n").mockResolvedValueOnce("0\n");

    await remoteService.previewPullConflicts("/repo", "origin");

    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["fetch", "origin"], { extraEnv: {} });
  });
});

describe("remoteService.forcePull · 丢弃本地改动强制拉取", () => {
  let mockGit: MockGit;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGit = makeMockGit();
    vi.mocked(getGit).mockReturnValue(mockGit as never);
    vi.mocked(getRemoteGit).mockReturnValue(mockGit as never);
    vi.mocked(getConflictFiles).mockResolvedValue([]);
    // pull 默认成功（走 runNetworkGit）；reset/clean 仍走 mockGit.raw
    vi.mocked(runNetworkGit).mockResolvedValue("");
  });

  it("【force-1】reset --hard + clean -fd + pull 全部成功 → success", async () => {
    mockGit.raw.mockResolvedValue(""); // reset + clean

    const r = await remoteService.forcePull("/repo");

    expect(r.success).toBe(true);
    expect(r.message).toMatch(/已丢弃本地修改并完成 Pull/);
    expect(mockGit.raw).toHaveBeenCalledTimes(2);
    expect(mockGit.raw.mock.calls[0]?.[0]).toEqual(["reset", "--hard", "HEAD"]);
    expect(mockGit.raw.mock.calls[1]?.[0]).toEqual(["clean", "-fd"]);
    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["pull"], { extraEnv: {} });
  });

  it("【force-2】reset 失败 → 不继续 clean / pull", async () => {
    mockGit.raw.mockRejectedValueOnce(new Error("permission denied"));

    const r = await remoteService.forcePull("/repo");

    expect(r.success).toBe(false);
    expect(r.message).toMatch(/丢弃本地修改失败/);
    expect(r.message).toMatch(/permission denied/);
    expect(mockGit.raw).toHaveBeenCalledTimes(1);
    expect(runNetworkGit).not.toHaveBeenCalled();
  });

  it("【force-3】reset + clean OK + pull 失败 + 产生冲突 → conflicts 非空", async () => {
    mockGit.raw.mockResolvedValue(""); // reset + clean OK
    vi.mocked(runNetworkGit).mockRejectedValueOnce(new Error("CONFLICT (content)"));
    vi.mocked(getConflictFiles).mockResolvedValue(["x.ts"]);

    const r = await remoteService.forcePull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual(["x.ts"]);
    expect(r.message).toMatch(/CONFLICT/);
  });

  it("【force-4】remote=origin + rebase=true → pull 命令带 --rebase 和 origin", async () => {
    mockGit.raw.mockResolvedValue("");

    await remoteService.forcePull("/repo", "origin", true);

    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["pull", "--rebase", "origin"], {
      extraEnv: {},
    });
  });
});

describe("remoteService.push · 自动建立上游跟踪", () => {
  let mockGit: MockGit;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGit = makeMockGit();
    vi.mocked(getGit).mockReturnValue(mockGit as never);
    vi.mocked(runNetworkGit).mockResolvedValue("");
  });

  it("分支无 upstream → 自动带 --set-upstream", async () => {
    // rev-parse <branch>@{u} 抛错 = 无 upstream
    mockGit.raw.mockRejectedValue(new Error("no upstream configured"));

    await remoteService.push("/repo", "origin", "dev");

    expect(runNetworkGit).toHaveBeenCalledWith(
      "/repo",
      ["push", "--set-upstream", "origin", "dev"],
      { extraEnv: {} }
    );
  });

  it("分支已有 upstream → 不重复加 --set-upstream", async () => {
    mockGit.raw.mockResolvedValue("origin/dev");

    await remoteService.push("/repo", "origin", "dev");

    expect(runNetworkGit).toHaveBeenCalledWith("/repo", ["push", "origin", "dev"], {
      extraEnv: {},
    });
  });

  it("显式 setUpstream → 直接带 --set-upstream，且不再查 upstream", async () => {
    await remoteService.push("/repo", "origin", "dev", { setUpstream: true });

    expect(mockGit.raw).not.toHaveBeenCalled();
    expect(runNetworkGit).toHaveBeenCalledWith(
      "/repo",
      ["push", "--set-upstream", "origin", "dev"],
      { extraEnv: {} }
    );
  });
});
