import { describe, it, expect } from "vitest";
import { resolveDisplayBranch } from "./display-branch.js";

describe("resolveDisplayBranch", () => {
  it("有真实 isHead 本地分支 → 返回分支名", () => {
    expect(
      resolveDisplayBranch(
        [
          { name: "dev", isHead: true },
          { name: "main", isHead: false },
        ],
        "abc1234"
      )
    ).toBe("dev");
  });

  it("无 isHead（detached）但有 headSha → (HEAD: sha)", () => {
    expect(resolveDisplayBranch([{ name: "dev", isHead: false }], "abc1234")).toBe("(HEAD: abc1234)");
  });

  it("isHead 是括号 porcelain 伪条目 + 有 headSha → (HEAD: sha)，不漏 porcelain", () => {
    expect(
      resolveDisplayBranch(
        [
          { name: "(HEAD detached at abc1234)", isHead: true },
          { name: "dev", isHead: false },
        ],
        "abc1234"
      )
    ).toBe("(HEAD: abc1234)");
    expect(
      resolveDisplayBranch([{ name: "(no branch, rebasing dev)", isHead: true }], "abc1234")
    ).toBe("(HEAD: abc1234)");
  });

  it("无 isHead 且 headSha 为 null（unborn）→ null（调用方保留原值）", () => {
    expect(resolveDisplayBranch([], null)).toBeNull();
  });

  it("仅有 isHead porcelain 伪条目但 headSha 为 null → 兜底返回原名", () => {
    expect(resolveDisplayBranch([{ name: "(no branch)", isHead: true }], null)).toBe("(no branch)");
  });
});
