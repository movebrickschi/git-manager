import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { useMultiSelect } from "./useMultiSelect";

function setup(keys: string[]) {
  const flat = ref<readonly string[]>(keys);
  const ms = useMultiSelect(flat);
  return { flat, ms };
}

describe("useMultiSelect · 基础 toggle / clear / removeKeys", () => {
  it("toggle 单 key 加入再切换移除", () => {
    const { ms } = setup(["a", "b", "c"]);
    expect(ms.isSelected("a")).toBe(false);
    ms.toggle("a");
    expect(ms.isSelected("a")).toBe(true);
    expect(ms.selectedCount.value).toBe(1);
    ms.toggle("a");
    expect(ms.isSelected("a")).toBe(false);
    expect(ms.selectedCount.value).toBe(0);
  });

  it("clear 一次清空", () => {
    const { ms } = setup(["a", "b"]);
    ms.toggle("a");
    ms.toggle("b");
    expect(ms.selectedCount.value).toBe(2);
    ms.clear();
    expect(ms.selectedCount.value).toBe(0);
  });

  it("removeKeys 只移除目标 key", () => {
    const { ms } = setup(["a", "b", "c"]);
    ms.toggle("a");
    ms.toggle("b");
    ms.toggle("c");
    ms.removeKeys(["a", "c"]);
    expect(ms.isSelected("a")).toBe(false);
    expect(ms.isSelected("b")).toBe(true);
    expect(ms.isSelected("c")).toBe(false);
  });
});

describe("useMultiSelect · 新增 addKeys / toggleKeys（section 全选支撑）", () => {
  it("addKeys 加入全新 keys", () => {
    const { ms } = setup(["a", "b", "c"]);
    ms.addKeys(["a", "b"]);
    expect(ms.isSelected("a")).toBe(true);
    expect(ms.isSelected("b")).toBe(true);
    expect(ms.selectedCount.value).toBe(2);
  });

  it("addKeys 重复加入已选 key 是幂等的", () => {
    const { ms } = setup(["a", "b"]);
    ms.toggle("a");
    ms.addKeys(["a", "b"]);
    expect(ms.selectedCount.value).toBe(2);
  });

  it("addKeys 空数组 → 无变化", () => {
    const { ms } = setup(["a"]);
    ms.toggle("a");
    const before = ms.selectedCount.value;
    ms.addKeys([]);
    expect(ms.selectedCount.value).toBe(before);
  });

  it("toggleKeys：全部已选 → 全部移除（取消整组）", () => {
    const { ms } = setup(["a", "b", "c"]);
    ms.addKeys(["a", "b", "c"]);
    ms.toggleKeys(["a", "b", "c"]);
    expect(ms.selectedCount.value).toBe(0);
  });

  it("toggleKeys：部分已选 → 全部加入（不是反选！）", () => {
    const { ms } = setup(["a", "b", "c"]);
    ms.toggle("a");
    ms.toggleKeys(["a", "b", "c"]);
    expect(ms.isSelected("a")).toBe(true);
    expect(ms.isSelected("b")).toBe(true);
    expect(ms.isSelected("c")).toBe(true);
  });

  it("toggleKeys：全未选 → 全部加入", () => {
    const { ms } = setup(["a", "b"]);
    ms.toggleKeys(["a", "b"]);
    expect(ms.isSelected("a")).toBe(true);
    expect(ms.isSelected("b")).toBe(true);
  });

  it("toggleKeys 空数组 → 无变化", () => {
    const { ms } = setup(["a"]);
    ms.toggle("a");
    ms.toggleKeys([]);
    expect(ms.selectedCount.value).toBe(1);
    expect(ms.isSelected("a")).toBe(true);
  });

  it("toggleKeys 一组中只有部分 key 存在于 flat 中 → 仍走全部加入分支", () => {
    const { ms } = setup(["a", "b", "c"]);
    // d 不在 flat 中，但本 hook 不校验 key 合法性
    ms.toggleKeys(["a", "d"]);
    expect(ms.isSelected("a")).toBe(true);
    expect(ms.isSelected("d")).toBe(true);
    // 再次 toggleKeys 同组 → 因 "a" 与 "d" 全部已选 → 应全部移除
    ms.toggleKeys(["a", "d"]);
    expect(ms.isSelected("a")).toBe(false);
    expect(ms.isSelected("d")).toBe(false);
  });
});
