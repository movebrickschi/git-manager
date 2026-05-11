import { describe, it, expect } from "vitest";
import { safeJoin } from "./path-safe.js";
import * as path from "path";

const REPO = path.resolve("/tmp/repo");

describe("safeJoin", () => {
  describe("接受合法路径", () => {
    it("仓库内根文件", () => {
      expect(safeJoin(REPO, "README.md")).toBe(path.join(REPO, "README.md"));
    });
    it("子目录", () => {
      expect(safeJoin(REPO, "src/utils/foo.ts")).toBe(
        path.join(REPO, "src/utils/foo.ts")
      );
    });
    it("./ 前缀", () => {
      expect(safeJoin(REPO, "./a/b.ts")).toBe(path.join(REPO, "a/b.ts"));
    });
  });

  describe("拒绝路径遍历", () => {
    it("../etc/passwd", () => {
      expect(() => safeJoin(REPO, "../etc/passwd")).toThrow(
        /path traversal denied/
      );
    });
    it("a/../../etc/passwd", () => {
      expect(() => safeJoin(REPO, "a/../../etc/passwd")).toThrow(
        /path traversal denied/
      );
    });
    it("绝对路径", () => {
      const abs = process.platform === "win32" ? "C:\\Windows\\hosts" : "/etc/passwd";
      expect(() => safeJoin(REPO, abs)).toThrow(/path traversal denied/);
    });
  });

  describe("拒绝异常输入", () => {
    it("空字符串", () => {
      expect(() => safeJoin(REPO, "")).toThrow(/invalid filePath/);
    });
    it("null byte 截断", () => {
      expect(() => safeJoin(REPO, "README\0.md")).toThrow(/null byte/);
    });
    it("纯 . 等价于 repo 根本身", () => {
      expect(() => safeJoin(REPO, ".")).toThrow(/path traversal denied/);
    });
    it("非字符串（实际场景：JSON 解码异常）", () => {
      // @ts-expect-error 故意测异常输入
      expect(() => safeJoin(REPO, 123)).toThrow(/invalid filePath/);
    });
  });
});
