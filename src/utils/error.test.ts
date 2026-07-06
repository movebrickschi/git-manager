import { describe, it, expect } from "vitest";
import { errMsg, errText } from "./error";

describe("errMsg", () => {
  it("Error 实例返回 message", () => {
    expect(errMsg(new Error("boom"))).toBe("boom");
  });
  it("字符串直接返回", () => {
    expect(errMsg("oops")).toBe("oops");
  });
  it("含 message 字段的对象", () => {
    expect(errMsg({ message: "from object" })).toBe("from object");
  });
  it("普通对象 JSON 化", () => {
    expect(errMsg({ a: 1 })).toBe('{"a":1}');
  });
  it("不可序列化对象兜底 String()", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(errMsg(cyclic)).toMatch(/object/i);
  });
  it("null / undefined", () => {
    expect(errMsg(null)).toBe("null");
    expect(errMsg(undefined)).toBe("undefined");
  });
  it("数字", () => {
    expect(errMsg(42)).toBe("42");
  });

  it("Electron IPC 英文包装错误转中文", () => {
    expect(
      errText(
        "Error invoking remote method 'open_repo': TypeError: infoDebugger.extend is not a function"
      )
    ).toBe("调用本地功能失败（打开仓库）：类型错误：infoDebugger.extend 不是函数");
  });
});
