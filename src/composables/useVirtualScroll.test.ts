import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { useVirtualScroll } from "./useVirtualScroll";

describe("useVirtualScroll", () => {
  it("scrollTop=0 时 visibleStart 不会小于 0", () => {
    const scrollTop = ref(0);
    const viewportHeight = ref(400);
    const totalItems = ref(1000);
    const { visibleStart } = useVirtualScroll({
      scrollTop,
      viewportHeight,
      totalItems,
      itemHeight: 20,
      overscan: 5,
    });
    expect(visibleStart.value).toBe(0);
  });

  it("visibleEnd 不会超过 totalItems", () => {
    const scrollTop = ref(99999);
    const viewportHeight = ref(400);
    const totalItems = ref(100);
    const { visibleEnd } = useVirtualScroll({
      scrollTop,
      viewportHeight,
      totalItems,
      itemHeight: 20,
      overscan: 5,
    });
    expect(visibleEnd.value).toBe(100);
  });

  it("计算 visibleStart/visibleEnd 含 overscan", () => {
    const scrollTop = ref(200); // 滚动到第 10 项 (200 / 20)
    const viewportHeight = ref(400); // 视口可见 20 项
    const totalItems = ref(1000);
    const { visibleStart, visibleEnd, offsetY, totalHeight } = useVirtualScroll({
      scrollTop,
      viewportHeight,
      totalItems,
      itemHeight: 20,
      overscan: 3,
    });
    expect(visibleStart.value).toBe(10 - 3); // 7
    expect(visibleEnd.value).toBe(10 + 20 + 3); // 33
    expect(offsetY.value).toBe(7 * 20);
    expect(totalHeight.value).toBe(1000 * 20);
  });

  it("响应式更新：scrollTop 变化触发重算", () => {
    const scrollTop = ref(0);
    const viewportHeight = ref(200);
    const totalItems = ref(1000);
    const { visibleStart } = useVirtualScroll({
      scrollTop,
      viewportHeight,
      totalItems,
      itemHeight: 20,
      overscan: 0,
    });
    expect(visibleStart.value).toBe(0);
    scrollTop.value = 100;
    expect(visibleStart.value).toBe(5);
  });

  it("空列表应得到 visibleStart=visibleEnd=0", () => {
    const scrollTop = ref(0);
    const viewportHeight = ref(400);
    const totalItems = ref(0);
    const { visibleStart, visibleEnd, totalHeight } = useVirtualScroll({
      scrollTop,
      viewportHeight,
      totalItems,
      itemHeight: 20,
      overscan: 5,
    });
    expect(visibleStart.value).toBe(0);
    expect(visibleEnd.value).toBe(0);
    expect(totalHeight.value).toBe(0);
  });

  it("itemHeight=0 不应除零崩溃，返回安全默认值", () => {
    const scrollTop = ref(0);
    const viewportHeight = ref(400);
    const totalItems = ref(100);
    const { visibleStart, visibleEnd } = useVirtualScroll({
      scrollTop,
      viewportHeight,
      totalItems,
      itemHeight: 0,
      overscan: 5,
    });
    expect(Number.isFinite(visibleStart.value)).toBe(true);
    expect(Number.isFinite(visibleEnd.value)).toBe(true);
  });
});
