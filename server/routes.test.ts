import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// 必须先 mock，再 import router（vitest 顶层 hoist vi.mock）
vi.mock("./git-service.js", () => ({
  gitService: {
    openRepo: vi.fn(),
    getLog: vi.fn(),
    getStatus: vi.fn(),
    createBranch: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    mergeBranch: vi.fn(),
  },
}));

import { gitService } from "./git-service.js";
import router from "./routes.js";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

describe("server routes — wrap() happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  it("成功响应应为 { success:true, data } 包装 + 注入 X-Trace-Id 头", async () => {
    vi.mocked(gitService.openRepo).mockResolvedValue({
      path: "/r",
      name: "r",
      currentBranch: "main",
    });

    const res = await request(makeApp())
      .post("/api/repo/open")
      .send({ path: "/r" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { path: "/r", name: "r", currentBranch: "main" },
    });
    expect(res.headers["x-trace-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("成功响应即便 service 返回 undefined 也应正常 200 + success:true", async () => {
    vi.mocked(gitService.push).mockResolvedValue(undefined);

    const res = await request(makeApp())
      .post("/api/push")
      .send({ repoPath: "/r" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("server routes — classifyError() 错误码映射", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  const cases: Array<{
    name: string;
    errorMessage: string;
    expectedStatus: number;
    expectedCode: string;
  }> = [
    {
      name: "path traversal → 400 PATH_DENIED",
      errorMessage: "Path traversal detected",
      expectedStatus: 400,
      expectedCode: "PATH_DENIED",
    },
    {
      name: "invalid filePath → 400 PATH_DENIED",
      errorMessage: "invalid filePath",
      expectedStatus: 400,
      expectedCode: "PATH_DENIED",
    },
    {
      name: "not a git repository → 404 REPO_NOT_FOUND",
      errorMessage: "fatal: not a git repository",
      expectedStatus: 404,
      expectedCode: "REPO_NOT_FOUND",
    },
    {
      name: "ENOENT → 404 REPO_NOT_FOUND",
      errorMessage: "ENOENT: no such file",
      expectedStatus: 404,
      expectedCode: "REPO_NOT_FOUND",
    },
    {
      name: "conflict → 409 GIT_CONFLICT",
      errorMessage: "merge conflict in foo.ts",
      expectedStatus: 409,
      expectedCode: "GIT_CONFLICT",
    },
    {
      name: "non-fast-forward → 409 NON_FAST_FORWARD",
      errorMessage: "rejected: non-fast-forward",
      expectedStatus: 409,
      expectedCode: "NON_FAST_FORWARD",
    },
    {
      name: "authentication → 401 AUTH_FAILED",
      errorMessage: "authentication required",
      expectedStatus: 401,
      expectedCode: "AUTH_FAILED",
    },
    {
      name: "permission denied → 401 AUTH_FAILED",
      errorMessage: "permission denied (publickey)",
      expectedStatus: 401,
      expectedCode: "AUTH_FAILED",
    },
    {
      name: "timeout → 504 GIT_TIMEOUT",
      errorMessage: "operation timed out",
      expectedStatus: 504,
      expectedCode: "GIT_TIMEOUT",
    },
    {
      name: "unclassified → 500 GIT_ERR",
      errorMessage: "some random failure",
      expectedStatus: 500,
      expectedCode: "GIT_ERR",
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      vi.mocked(gitService.getStatus).mockRejectedValue(
        new Error(c.errorMessage),
      );

      const res = await request(makeApp())
        .post("/api/status")
        .send({ repoPath: "/r" });

      expect(res.status).toBe(c.expectedStatus);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(c.expectedCode);
      expect(res.body.traceId).toMatch(/^[0-9a-f-]{36}$/i);
    });
  }

  it("非生产环境 error 字段应回显原始 message", async () => {
    process.env.NODE_ENV = "development";
    // 注意：routes.ts 顶层就读了 IS_PROD，改 env 后需要重新 import；这里依赖 IS_PROD=false 默认行为
    vi.mocked(gitService.getStatus).mockRejectedValue(
      new Error("verbose internal stack"),
    );

    const res = await request(makeApp())
      .post("/api/status")
      .send({ repoPath: "/r" });

    expect(res.body.error).toBe("verbose internal stack");
  });
});

describe("server routes — 参数透传契约", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  it("POST /api/log 应把 repoPath + filter 原样透传给 gitService.getLog", async () => {
    vi.mocked(gitService.getLog).mockResolvedValue({
      commits: [],
      graphRows: [],
    });

    const filter = {
      skip: 0,
      limit: 100,
      branch: "main",
      author: null,
      dateFrom: null,
      dateTo: null,
      path: null,
      searchText: "",
      useRegex: false,
      matchCase: false,
    };

    await request(makeApp())
      .post("/api/log")
      .send({ repoPath: "/r", filter });

    expect(gitService.getLog).toHaveBeenCalledTimes(1);
    expect(gitService.getLog).toHaveBeenCalledWith("/r", filter);
  });

  it("POST /api/branch/create 应透传 repoPath, name, startPoint（可选参数 undefined 不丢失语义）", async () => {
    vi.mocked(gitService.createBranch).mockResolvedValue(undefined);

    await request(makeApp())
      .post("/api/branch/create")
      .send({ repoPath: "/r", name: "feat/x" });

    expect(gitService.createBranch).toHaveBeenCalledWith(
      "/r",
      "feat/x",
      undefined,
    );
  });

  it("POST /api/commit 应把 message 与 amend 透传", async () => {
    vi.mocked(gitService.commit).mockResolvedValue("c0ffee");

    await request(makeApp())
      .post("/api/commit")
      .send({ repoPath: "/r", message: "feat: x", amend: false });

    expect(gitService.commit).toHaveBeenCalledWith(
      "/r",
      "feat: x",
      false,
    );
  });
});
