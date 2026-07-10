import { describe, expect, it } from "vitest";
import { makeIgnoredPredicate } from "./repo-watcher-ignored.js";

describe("makeIgnoredPredicate", () => {
  const ignored = makeIgnoredPredicate();

  it.each([
    "C:\\repo\\.git\\refs\\heads\\main",
    "C:\\repo\\.git\\refs\\heads\\main.lock",
    "/repo/.git/refs/remotes/origin/main",
    "/repo/.git/refs/tags/v1.0.0",
    "C:\\repo\\.git\\FETCH_HEAD",
    "/repo/.git/packed-refs",
    "/repo/.git/packed-refs.lock",
  ])("keeps Git reference metadata watchable: %s", (file) => {
    expect(ignored(file)).toBe(false);
  });

  it.each([
    "C:\\repo\\.git\\objects\\ab\\cdef",
    "/repo/.git/logs/HEAD",
    "/repo/.git/hooks/pre-commit",
    "/repo/node_modules/pkg/index.js",
    "C:\\repo\\dist\\index.js",
  ])("continues to ignore high-noise paths: %s", (file) => {
    expect(ignored(file)).toBe(true);
  });
});
