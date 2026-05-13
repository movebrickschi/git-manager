import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { gitService } from "./git-service.js";
import { COMMANDS } from "../shared/command-manifest.js";

const router = Router();

const IS_PROD = process.env.NODE_ENV === "production";

function classifyError(e: unknown): { code: string; status: number } {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const msg = raw.toLowerCase();
  if (msg.includes("path traversal") || msg.includes("invalid filepath")) {
    return { code: "PATH_DENIED", status: 400 };
  }
  if (msg.includes("not a git repository") || msg.includes("enoent")) {
    return { code: "REPO_NOT_FOUND", status: 404 };
  }
  if (msg.includes("conflict")) {
    return { code: "GIT_CONFLICT", status: 409 };
  }
  if (msg.includes("non-fast-forward")) {
    return { code: "NON_FAST_FORWARD", status: 409 };
  }
  if (msg.includes("authentication") || msg.includes("permission denied")) {
    return { code: "AUTH_FAILED", status: 401 };
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return { code: "GIT_TIMEOUT", status: 504 };
  }
  return { code: "GIT_ERR", status: 500 };
}

function wrap(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    const traceId = randomUUID();
    res.setHeader("X-Trace-Id", traceId);
    try {
      const result = await fn(req);
      res.json({ success: true, data: result });
    } catch (e: unknown) {
      const { code, status } = classifyError(e);
      const errMsg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      console.error(`[${traceId}] ${req.method} ${req.path} ${code}:`, errMsg);
      res.status(status).json({
        success: false,
        code,
        traceId,
        error: IS_PROD ? code : e instanceof Error ? e.message : String(e),
      });
    }
  };
}

type ServiceCallable = (...args: unknown[]) => unknown | Promise<unknown>;

const svc = gitService as unknown as Record<string, ServiceCallable>;

for (const spec of COMMANDS) {
  router.post(
    spec.http,
    wrap(async (req) => {
      const args = spec.bodyKeys.map((k) => (req.body as Record<string, unknown>)?.[k]);
      return await svc[spec.method].call(gitService, ...args);
    })
  );
}

export default router;
