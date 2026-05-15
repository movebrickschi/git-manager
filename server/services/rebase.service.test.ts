import { describe, expect, it } from "vitest";
import { serializeTodos } from "./rebase.service.js";
import type { RebaseTodoEntry } from "../../shared/types.js";
import { shellEscapeSingleQuote } from "../utils/git-rebase-editor.js";

describe("serializeTodos", () => {
  it("pick → 直出 `pick <hash> <subject>`", () => {
    const todos: RebaseTodoEntry[] = [
      { action: "pick", commitId: "abc123def", shortId: "abc123d", subject: "first commit" },
    ];
    expect(serializeTodos(todos)).toBe("pick abc123d first commit\n");
  });

  it("drop / fixup / edit 各自对应关键字", () => {
    const todos: RebaseTodoEntry[] = [
      { action: "pick", commitId: "111", shortId: "111", subject: "a" },
      { action: "drop", commitId: "222", shortId: "222", subject: "b" },
      { action: "fixup", commitId: "333", shortId: "333", subject: "c" },
      { action: "edit", commitId: "444", shortId: "444", subject: "d" },
    ];
    expect(serializeTodos(todos)).toBe(
      [
        "pick 111 a",
        "drop 222 b",
        "fixup 333 c",
        "edit 444 d",
        "",
      ].join("\n")
    );
  });

  it("squash 走原生关键字（依赖 GIT_EDITOR=true 接受默认合并消息）", () => {
    const todos: RebaseTodoEntry[] = [
      { action: "pick", commitId: "111", shortId: "111", subject: "base" },
      { action: "squash", commitId: "222", shortId: "222", subject: "follow-up" },
    ];
    expect(serializeTodos(todos)).toBe("pick 111 base\nsquash 222 follow-up\n");
  });

  it("reword 转译为 pick + exec amend；新消息走 shell 单引号包裹", () => {
    const todos: RebaseTodoEntry[] = [
      {
        action: "reword",
        commitId: "abc123",
        shortId: "abc123",
        subject: "old",
        newMessage: "new message",
      },
    ];
    const out = serializeTodos(todos);
    expect(out).toContain("pick abc123 old");
    expect(out).toContain("exec git commit --amend --no-verify -m 'new message'");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("reword 未传 newMessage → 用原 subject 当回退", () => {
    const todos: RebaseTodoEntry[] = [
      { action: "reword", commitId: "x", shortId: "x", subject: "fallback" },
    ];
    const out = serializeTodos(todos);
    expect(out).toContain("exec git commit --amend --no-verify -m 'fallback'");
  });

  it("reword 消息含单引号 → 用 '\\'' 经典 shell 转义", () => {
    const todos: RebaseTodoEntry[] = [
      {
        action: "reword",
        commitId: "x",
        shortId: "x",
        subject: "old",
        newMessage: "it's a 'test'",
      },
    ];
    const out = serializeTodos(todos);
    // 验证最终包裹后引号闭合正确：'it'\''s a '\''test'\'''
    expect(out).toContain(
      `exec git commit --amend --no-verify -m 'it'\\''s a '\\''test'\\'''`
    );
  });

  it("混合编排：pick + reword + squash + drop + edit + fixup 一次性生成", () => {
    const todos: RebaseTodoEntry[] = [
      { action: "pick", commitId: "1", shortId: "1", subject: "A" },
      { action: "reword", commitId: "2", shortId: "2", subject: "B", newMessage: "B-new" },
      { action: "drop", commitId: "3", shortId: "3", subject: "C" },
      { action: "squash", commitId: "4", shortId: "4", subject: "D" },
      { action: "edit", commitId: "5", shortId: "5", subject: "E" },
      { action: "fixup", commitId: "6", shortId: "6", subject: "F" },
    ];
    const out = serializeTodos(todos);
    expect(out).toBe(
      [
        "pick 1 A",
        "pick 2 B",
        "exec git commit --amend --no-verify -m 'B-new'",
        "drop 3 C",
        "squash 4 D",
        "edit 5 E",
        "fixup 6 F",
        "",
      ].join("\n")
    );
  });
});

describe("shellEscapeSingleQuote", () => {
  it("空字符串原样返回", () => {
    expect(shellEscapeSingleQuote("")).toBe("");
  });
  it("无单引号字符串原样返回", () => {
    expect(shellEscapeSingleQuote("hello world!@#$%")).toBe("hello world!@#$%");
  });
  it("单引号被替换为 '\\''", () => {
    expect(shellEscapeSingleQuote("it's")).toBe("it'\\''s");
  });
  it("多个连续单引号都被转义", () => {
    expect(shellEscapeSingleQuote("'''")).toBe("'\\'''\\'''\\''");
  });
});
