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

import { remoteService } from "./remote.service.js";
import { getGit, getRemoteGit, getConflictFiles } from "./_helpers.js";

interface MockGit {
  status: ReturnType<typeof vi.fn>;
  raw: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  branch: ReturnType<typeof vi.fn>;
  getRemotes: ReturnType<typeof vi.fn>;
}

function makeMockGit(): MockGit {
  return {
    status: vi.fn(),
    raw: vi.fn(),
    fetch: vi.fn(),
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
  });

  // -------------------------------------------------------------------------
  // 1) Clean tree
  // -------------------------------------------------------------------------

  it("【1】clean tree + pull 成功 → success, 不调 stash", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw.mockResolvedValue("");

    const r = await remoteService.pull("/repo");

    expect(r).toEqual({ success: true, conflicts: [], message: "Pull completed" });
    expect(mockGit.raw).toHaveBeenCalledTimes(1);
    expect(mockGit.raw).toHaveBeenCalledWith(["pull"]);
  });

  it("【2】clean tree + pull 失败（网络）→ success=false, conflicts=[]", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw.mockRejectedValueOnce(new Error("could not resolve host: github.com"));
    vi.mocked(getConflictFiles).mockResolvedValue([]);

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual([]);
    expect(r.message).toMatch(/could not resolve host/);
  });

  it("【3】clean tree + pull 失败 + 产生 merge conflict → conflicts 非空", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw.mockRejectedValueOnce(new Error("CONFLICT (content)"));
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
    // raw 调用顺序：stash push → pull → stash pop
    mockGit.raw.mockResolvedValue("");

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(true);
    expect(r.conflicts).toEqual([]);
    expect(r.message).toMatch(/auto-stashed.*restored/);
    expect(mockGit.raw).toHaveBeenCalledTimes(3);
    expect(mockGit.raw.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(["stash", "push", "--include-untracked"])
    );
    expect(mockGit.raw.mock.calls[1]?.[0]).toEqual(["pull"]);
    // stash pop 带 --index 以恢复 staging（见 5942e7e）
    expect(mockGit.raw.mock.calls[2]?.[0]).toEqual(["stash", "pop", "--index"]);
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
  });

  it("【6】dirty tree + stash 成功 + pull 失败（网络）→ 自动 pop stash 回滚", async () => {
    mockGit.status.mockResolvedValue(statusDirty());
    // calls: stash push OK → pull FAIL → stash pop OK
    mockGit.raw
      .mockResolvedValueOnce("") // stash push
      .mockRejectedValueOnce(new Error("could not resolve host")) // pull
      .mockResolvedValueOnce(""); // stash pop (rollback)
    vi.mocked(getConflictFiles).mockResolvedValue([]);

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual([]);
    expect(r.message).toMatch(/could not resolve host/);
    expect(mockGit.raw).toHaveBeenCalledTimes(3);
    // 回滚路径首选 stash pop --index 以保留原 staging；失败才 fallback 到 stash pop
    expect(mockGit.raw.mock.calls[2]?.[0]).toEqual(["stash", "pop", "--index"]);
  });

  it("【7】dirty tree + stash + pull 成功 + pop 冲突 → conflicts 非空 + 提示 drop stash", async () => {
    mockGit.status.mockResolvedValue(statusDirty());
    mockGit.raw
      .mockResolvedValueOnce("") // stash push
      .mockResolvedValueOnce("") // pull OK
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
      .mockResolvedValueOnce("") // pull OK
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
    mockGit.raw
      .mockResolvedValueOnce("") // stash push
      .mockRejectedValueOnce(new Error("CONFLICT (content)")); // pull conflict
    vi.mocked(getConflictFiles).mockResolvedValue(["x.ts"]);

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual(["x.ts"]);
    expect(r.message).toMatch(/CONFLICT/);
    // 仅 2 次 raw 调用：stash push + pull；不再 pop stash
    expect(mockGit.raw).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // 3) status 读失败
  // -------------------------------------------------------------------------

  it("【10】git status 失败 → 早返回，不调 raw", async () => {
    mockGit.status.mockRejectedValue(new Error("fatal: not a git repository"));

    const r = await remoteService.pull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual([]);
    expect(r.message).toMatch(/not a git repository/);
    expect(mockGit.raw).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4) 参数透传：remote + rebase
  // -------------------------------------------------------------------------

  it("【11】rebase=true → pull 命令带 --rebase", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw.mockResolvedValue("");

    await remoteService.pull("/repo", undefined, true);

    expect(mockGit.raw).toHaveBeenCalledWith(["pull", "--rebase"]);
  });

  it("【12】remote=origin → pull 命令带 origin", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw.mockResolvedValue("");

    await remoteService.pull("/repo", "origin");

    expect(mockGit.raw).toHaveBeenCalledWith(["pull", "origin"]);
  });

  it("【13】rebase=true + remote=origin → ['pull', '--rebase', 'origin']", async () => {
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw.mockResolvedValue("");

    await remoteService.pull("/repo", "origin", true);

    expect(mockGit.raw).toHaveBeenCalledWith(["pull", "--rebase", "origin"]);
  });
});

describe("remoteService.previewPullConflicts · IDEA-style preview", () => {
  let mockGit: MockGit;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGit = makeMockGit();
    vi.mocked(getGit).mockReturnValue(mockGit as never);
    vi.mocked(getRemoteGit).mockReturnValue(mockGit as never);
  });

  it("【preview-1】clean tree + upstream 配置 + remote 落后 → 空 dirty / 0 commits ahead", async () => {
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw
      .mockResolvedValueOnce("origin/main\n")
      .mockResolvedValueOnce("0\n");

    const r = await remoteService.previewPullConflicts("/repo");

    expect(r.dirtyFiles).toEqual([]);
    expect(r.wouldConflict).toEqual([]);
    expect(r.safe).toEqual([]);
    expect(r.upstream).toBe("origin/main");
    expect(r.remoteCommitsAhead).toBe(0);
    expect(r.fetched).toBe(true);
  });

  it("【preview-2】dirty tree + remote 改了相同文件 → wouldConflict 命中", async () => {
    mockGit.fetch.mockResolvedValue(undefined);
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
    mockGit.fetch.mockRejectedValue(new Error("could not resolve host"));
    mockGit.status.mockResolvedValue(statusDirty());
    mockGit.raw
      .mockResolvedValueOnce("origin/main\n")
      .mockResolvedValueOnce("0\n");

    const r = await remoteService.previewPullConflicts("/repo");

    expect(r.fetched).toBe(false);
    expect(r.dirtyFiles).toEqual(["a.ts"]);
    expect(r.upstream).toBe("origin/main");
  });

  it("【preview-4】没配 upstream（新分支没 push 过）→ upstream=null, remoteCommitsAhead=0", async () => {
    mockGit.fetch.mockResolvedValue(undefined);
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
    mockGit.fetch.mockResolvedValue(undefined);
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
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.status.mockResolvedValue(statusClean());
    mockGit.raw
      .mockResolvedValueOnce("origin/main\n")
      .mockResolvedValueOnce("0\n");

    await remoteService.previewPullConflicts("/repo", "origin");

    expect(mockGit.fetch).toHaveBeenCalledWith("origin");
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
  });

  it("【force-1】reset --hard + clean -fd + pull 全部成功 → success", async () => {
    mockGit.raw.mockResolvedValue("");

    const r = await remoteService.forcePull("/repo");

    expect(r.success).toBe(true);
    expect(r.message).toMatch(/已丢弃本地修改并完成 Pull/);
    expect(mockGit.raw).toHaveBeenCalledTimes(3);
    expect(mockGit.raw.mock.calls[0]?.[0]).toEqual(["reset", "--hard", "HEAD"]);
    expect(mockGit.raw.mock.calls[1]?.[0]).toEqual(["clean", "-fd"]);
    expect(mockGit.raw.mock.calls[2]?.[0]).toEqual(["pull"]);
  });

  it("【force-2】reset 失败 → 不继续 clean / pull", async () => {
    mockGit.raw.mockRejectedValueOnce(new Error("permission denied"));

    const r = await remoteService.forcePull("/repo");

    expect(r.success).toBe(false);
    expect(r.message).toMatch(/丢弃本地修改失败/);
    expect(r.message).toMatch(/permission denied/);
    expect(mockGit.raw).toHaveBeenCalledTimes(1);
  });

  it("【force-3】reset + clean OK + pull 失败 + 产生冲突 → conflicts 非空", async () => {
    mockGit.raw
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      .mockRejectedValueOnce(new Error("CONFLICT (content)"));
    vi.mocked(getConflictFiles).mockResolvedValue(["x.ts"]);

    const r = await remoteService.forcePull("/repo");

    expect(r.success).toBe(false);
    expect(r.conflicts).toEqual(["x.ts"]);
    expect(r.message).toMatch(/CONFLICT/);
  });

  it("【force-4】remote=origin + rebase=true → pull 命令带 --rebase 和 origin", async () => {
    mockGit.raw.mockResolvedValue("");

    await remoteService.forcePull("/repo", "origin", true);

    expect(mockGit.raw).toHaveBeenCalledWith(["pull", "--rebase", "origin"]);
  });
});
