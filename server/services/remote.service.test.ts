import { describe, it, expect, vi, beforeEach } from "vitest";

// 顶层 hoist：必须在 import remoteService 之前 mock _helpers
vi.mock("./_helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_helpers.js")>();
  return {
    ...actual,
    getGit: vi.fn(),
    getConflictFiles: vi.fn(),
  };
});

import { remoteService } from "./remote.service.js";
import { getGit, getConflictFiles } from "./_helpers.js";

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
    expect(mockGit.raw.mock.calls[2]?.[0]).toEqual(["stash", "pop"]);
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
    expect(mockGit.raw.mock.calls[2]?.[0]).toEqual(["stash", "pop"]);
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
