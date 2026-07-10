import { describe, expect, it } from "vitest";
import { repoWatcherNeedsFullRefresh } from "./useRepoWatcher";

describe("repoWatcherNeedsFullRefresh", () => {
  it("requests a full refresh for HEAD and refs changes only", () => {
    expect(repoWatcherNeedsFullRefresh("head")).toBe(true);
    expect(repoWatcherNeedsFullRefresh("refs")).toBe(true);
    expect(repoWatcherNeedsFullRefresh("work")).toBe(false);
    expect(repoWatcherNeedsFullRefresh("index")).toBe(false);
    expect(repoWatcherNeedsFullRefresh("merge")).toBe(false);
  });
});
