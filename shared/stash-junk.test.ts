import { describe, expect, it } from "vitest";
import { isStashJunkPath } from "./stash-junk.js";

describe("isStashJunkPath", () => {
  it("拦 __pycache__ 目录与 *.py[cod]", () => {
    expect(isStashJunkPath("scripts/__pycache__/deploy_sit.cpython-312.pyc")).toBe(true);
    expect(isStashJunkPath("__pycache__/x.pyc")).toBe(true);
    expect(isStashJunkPath("pkg/__pycache__")).toBe(true);
    expect(isStashJunkPath("foo.pyc")).toBe(true);
    expect(isStashJunkPath("foo.pyo")).toBe(true);
    expect(isStashJunkPath("foo.pyd")).toBe(true);
    expect(isStashJunkPath("scripts\\__pycache__\\x.pyc")).toBe(true);
  });

  it("不拦源码和业务二进制", () => {
    expect(isStashJunkPath("scripts/deploy_sit.py")).toBe(false);
    expect(isStashJunkPath("app/index.html")).toBe(false);
    expect(isStashJunkPath("blob.bin")).toBe(false);
    expect(isStashJunkPath("assets/logo.png")).toBe(false);
    expect(isStashJunkPath(".grok/skills/deploy-agent/SKILL.md")).toBe(false);
  });
});
