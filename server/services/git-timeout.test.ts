import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures the spy exists before vi.mock factory is hoisted to top.
const { simpleGitSpy } = vi.hoisted(() => ({
  simpleGitSpy: vi.fn((_options?: unknown) => ({})),
}));

vi.mock("simple-git", () => ({
  simpleGit: simpleGitSpy,
}));

import {
  getGit,
  getRemoteGit,
  GIT_TIMEOUT_MS,
  REMOTE_GIT_TIMEOUT_MS,
} from "./_helpers.js";

type GitOpts = {
  baseDir?: string;
  binary?: string;
  maxConcurrentProcesses?: number;
  timeout?: { block?: number };
};

function lastOpts(): GitOpts {
  const calls = simpleGitSpy.mock.calls;
  return calls[calls.length - 1]![0] as GitOpts;
}

// Regression guard: the push dialog runs fetch (networked git) before pushing.
// The original bug reused getGit block: 30s ("kill the child after 30s of no
// output"), which fired during auth waits / SSH-TLS handshakes / slow networks /
// remote "counting objects", surfacing simple-git "block timeout reached".
// This locks in the contract that the networked factory uses a much larger block.
describe("git factory block timeout config", () => {
  beforeEach(() => {
    simpleGitSpy.mockClear();
  });

  it("getGit (local ops) uses GIT_TIMEOUT_MS as block timeout", () => {
    getGit("/repo");
    expect(lastOpts().timeout?.block).toBe(GIT_TIMEOUT_MS);
  });

  it("getRemoteGit (networked ops) block timeout must be far larger than 30s", () => {
    getRemoteGit("/repo");
    expect(lastOpts().timeout?.block).toBe(REMOTE_GIT_TIMEOUT_MS);
    expect(REMOTE_GIT_TIMEOUT_MS).toBeGreaterThan(GIT_TIMEOUT_MS);
    expect(REMOTE_GIT_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
  });

  it("getRemoteGit keeps baseDir / binary, only relaxes block timeout", () => {
    getRemoteGit("/some/repo");
    const opts = lastOpts();
    expect(opts.baseDir).toBe("/some/repo");
    expect(opts.binary).toBe("git");
  });
});