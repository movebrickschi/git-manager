import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/report", () => ({
  reportBridge: {
    listAuthors: vi.fn().mockResolvedValue([]),
    listBranches: vi.fn().mockResolvedValue({}),
    extract: vi.fn(),
    polish: vi.fn(),
    abort: vi.fn(),
  },
}));

vi.mock("@/services/ai", () => ({
  aiBridge: {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
  },
}));

import { reportBridge } from "@/services/report";
import { useReportStore } from "./reportStore";
import { useRepoStore } from "./repoStore";

function stubLocalStorage(mem = new Map<string, string>()) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mem.set(key, value);
    },
    removeItem: (key: string) => {
      mem.delete(key);
    },
    clear: () => mem.clear(),
  });
  return mem;
}

function seedTwoOpenRepos() {
  const repoStore = useRepoStore();
  repoStore.repos = [
    { path: "C:\\a\\git-manager", name: "git-manager", currentBranch: "main", color: "#d73a49" },
    { path: "C:\\a\\hellome", name: "hellome", currentBranch: "main", color: "#22863a" },
  ];
  repoStore.activeRepoIndex = 0;
  return repoStore;
}

describe("reportStore · 仓库独立多选", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(reportBridge.listBranches).mockReset().mockResolvedValue({});
    vi.mocked(reportBridge.listAuthors).mockReset().mockResolvedValue([]);
    vi.mocked(reportBridge.extract).mockReset();
  });

  it("首次同步默认勾上全部已打开仓库，而不是只留当前激活 tab", () => {
    seedTwoOpenRepos();
    const reportStore = useReportStore();
    reportStore.syncReposFromActive();

    expect(reportStore.filter.repos).toEqual(["C:\\a\\git-manager", "C:\\a\\hellome"]);
  });

  it("勾选最近打开的第二个仓库时保留已勾选的第一个", () => {
    const repoStore = useRepoStore();
    repoStore.repos = [
      { path: "C:\\a\\git-manager", name: "git-manager", currentBranch: "main", color: "#d73a49" },
    ];
    repoStore.recentRepos = [{ path: "C:\\a\\git-manager" }, { path: "C:\\a\\hellome" }];
    repoStore.activeRepoIndex = 0;

    const reportStore = useReportStore();
    reportStore.syncReposFromActive();
    reportStore.toggleRepo("C:\\a\\hellome", true);

    expect(reportStore.filter.repos).toEqual(["C:\\a\\git-manager", "C:\\a\\hellome"]);
    expect(reportStore.selectableRepos.map((r) => r.path)).toEqual([
      "C:\\a\\git-manager",
      "C:\\a\\hellome",
    ]);
    expect(reportStore.selectableRepos[1]?.open).toBe(false);
  });

  it("取消「全部」只拿掉已打开 tab，单独勾上的最近仓库仍保留", () => {
    const repoStore = useRepoStore();
    repoStore.repos = [
      { path: "C:\\a\\git-manager", name: "git-manager", currentBranch: "main", color: "#d73a49" },
    ];
    repoStore.recentRepos = [{ path: "C:\\a\\git-manager" }, { path: "C:\\a\\hellome" }];
    repoStore.activeRepoIndex = 0;

    const reportStore = useReportStore();
    reportStore.syncReposFromActive();
    reportStore.toggleRepo("C:\\a\\hellome", true);
    expect(reportStore.allOpenReposChecked).toBe(true);

    reportStore.toggleAllOpenRepos();
    expect(reportStore.filter.repos).toEqual(["C:\\a\\hellome"]);
  });

  it("勾选与每仓分支会写进 localStorage，新 store 能读回来", () => {
    const mem = stubLocalStorage();
    seedTwoOpenRepos();
    const s1 = useReportStore();
    s1.syncReposFromActive();
    s1.toggleRepo("C:\\a\\hellome", false);
    s1.toggleBranchForRepo("C:\\a\\git-manager", "develop", true);

    expect(mem.get("git-manager.report-repos")).toContain("git-manager");
    expect(mem.get("git-manager.report-repos")).not.toContain("hellome");

    setActivePinia(createPinia());
    seedTwoOpenRepos();
    const s2 = useReportStore();
    s2.syncReposFromActive();
    expect(s2.filter.repos).toEqual(["C:\\a\\git-manager"]);
    expect(s2.filter.branchByRepo?.["C:\\a\\git-manager"]).toEqual(["develop"]);
  });

  it("勾选同一仓库第二根分支时保留第一根", () => {
    seedTwoOpenRepos();
    const reportStore = useReportStore();
    reportStore.syncReposFromActive();
    reportStore.toggleBranchForRepo("C:\\a\\git-manager", "main", true);
    reportStore.toggleBranchForRepo("C:\\a\\git-manager", "dev", true);
    expect(reportStore.filter.branchByRepo?.["C:\\a\\git-manager"]).toEqual(["main", "dev"]);
  });

  it("读得懂旧的单字符串 persist 并升成数组", () => {
    const mem = stubLocalStorage();
    mem.set(
      "git-manager.report-repos",
      JSON.stringify({
        repos: ["C:\\a\\git-manager"],
        branchByRepo: { "C:\\a\\git-manager": "develop" },
      })
    );
    seedTwoOpenRepos();
    const reportStore = useReportStore();
    reportStore.syncReposFromActive();
    expect(reportStore.filter.branchByRepo?.["C:\\a\\git-manager"]).toEqual(["develop"]);
  });
});

describe("reportStore · 周报模式", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(reportBridge.extract).mockReset();
  });

  it("切到周报时今日改成本周，并持久化到新 store", () => {
    const s1 = useReportStore();
    expect(s1.filter.kind).toBe("daily");
    expect(s1.filter.range.preset).toBe("today");

    s1.setKind("weekly");
    expect(s1.filter.kind).toBe("weekly");
    expect(s1.filter.range.preset).toBe("this-week");

    setActivePinia(createPinia());
    const s2 = useReportStore();
    expect(s2.filter.kind).toBe("weekly");
    expect(s2.filter.range.preset).toBe("this-week");
  });

  it("generate 把 kind=weekly 和当前勾选仓库传给 extract", async () => {
    seedTwoOpenRepos();
    const reportStore = useReportStore();
    reportStore.syncReposFromActive();
    reportStore.setKind("weekly");
    vi.mocked(reportBridge.extract).mockResolvedValue({
      ok: false,
      code: "NO_COMMITS",
      reason: "empty",
    });

    await reportStore.generate();

    expect(reportBridge.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "weekly",
        repos: ["C:\\a\\git-manager", "C:\\a\\hellome"],
      })
    );
  });

  it("后一次 loadBranches 覆盖前一次，过期请求不回写", async () => {
    seedTwoOpenRepos();
    const reportStore = useReportStore();
    reportStore.syncReposFromActive();

    let resolveFirst!: (value: Record<string, { branches: string[]; current: string }>) => void;
    const first = new Promise<Record<string, { branches: string[]; current: string }>>((r) => {
      resolveFirst = r;
    });
    vi.mocked(reportBridge.listBranches)
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({
        "C:\\a\\hellome": { branches: ["main"], current: "main" },
      });

    const p1 = reportStore.loadBranches();
    await reportStore.loadBranches();
    resolveFirst({
      "C:\\a\\git-manager": { branches: ["stale"], current: "stale" },
    });
    await p1;

    expect(reportStore.branchesByRepo).toEqual({
      "C:\\a\\hellome": { branches: ["main"], current: "main" },
    });
  });
});
