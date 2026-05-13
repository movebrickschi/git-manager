import { describe, it, expect } from "vitest";
import { translateGitError } from "./git-error";

describe("translateGitError", () => {
  describe("通过 code 翻译（来自 server wrap classifyError）", () => {
    it("PATH_DENIED", () => {
      expect(translateGitError({ code: "PATH_DENIED" })).toMatch(/路径越界/);
    });
    it("NON_FAST_FORWARD", () => {
      expect(translateGitError({ code: "NON_FAST_FORWARD" })).toMatch(/pull/);
    });
    it("AUTH_FAILED", () => {
      expect(translateGitError({ code: "AUTH_FAILED" })).toMatch(/认证/);
    });
  });
  describe("通过原始 stderr 关键字翻译", () => {
    it("non-fast-forward", () => {
      expect(
        translateGitError("Updates were rejected because the tip is behind: non-fast-forward")
      ).toMatch(/pull/);
    });
    it("could not resolve host", () => {
      expect(
        translateGitError("fatal: unable to access 'x': Could not resolve host: github.com")
      ).toMatch(/无法解析|网络/);
    });
    it("index.lock", () => {
      expect(translateGitError("fatal: Unable to create '/.git/index.lock': File exists.")).toMatch(
        /锁定/
      );
    });
    it("destination already exists", () => {
      expect(
        translateGitError(
          "fatal: destination path 'foo' already exists and is not an empty directory."
        )
      ).toMatch(/已存在/);
    });
  });
  describe("边界", () => {
    it('空字符串返回 "未知错误"', () => {
      expect(translateGitError("")).toBe("未知错误");
    });
    it("null", () => {
      expect(translateGitError(null)).toBe("未知错误");
    });
    it("未匹配模式 → 原文兜底", () => {
      expect(translateGitError("some random unknown text 中文混杂")).toBe(
        "some random unknown text 中文混杂"
      );
    });
    it("string 直接传入", () => {
      expect(translateGitError("fatal: not a git repository")).toMatch(/不是 git/);
    });
  });
});
