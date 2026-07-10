import { describe, expect, it } from "vitest";
import { classifyRepoWatcherPath } from "./repo-watcher-types.js";

describe("classifyRepoWatcherPath", () => {
  it("classifies Git reference metadata as refs across path separators", () => {
    for (const file of [
      ".git/refs/heads/main",
      ".git\\refs\\heads\\main.lock",
      ".git/refs/remotes/origin/main",
      ".git\\refs\\tags\\v1.0.0",
      ".git/FETCH_HEAD",
      ".git/FETCH_HEAD.lock",
      ".git/ORIG_HEAD",
      ".git/packed-refs",
      ".git/packed-refs.lock",
    ]) {
      expect(classifyRepoWatcherPath(file), file).toBe("refs");
    }
  });

  it("preserves existing HEAD, index, merge, and work classifications", () => {
    expect(classifyRepoWatcherPath(".git/HEAD")).toBe("head");
    expect(classifyRepoWatcherPath(".git\\index")).toBe("index");
    expect(classifyRepoWatcherPath(".git/rebase-merge/git-rebase-todo")).toBe("merge");
    expect(classifyRepoWatcherPath(".git/CHERRY_PICK_HEAD")).toBe("merge");
    expect(classifyRepoWatcherPath("src/App.vue")).toBe("work");
  });
});
