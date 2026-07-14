import { describe, expect, it, vi } from "vitest";
import { useLinkedVerticalScroll, type VerticalScroller } from "./useLinkedVerticalScroll";

function createFrameHarness() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();

  return {
    requestFrame(callback: () => void) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id: number) {
      callbacks.delete(id);
    },
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

function scroller(scrollTop = 0): VerticalScroller {
  return { scrollTop };
}

describe("useLinkedVerticalScroll", () => {
  it("mirrors the latest source position on the next animation frame", () => {
    const frames = createFrameHarness();
    const left = scroller(120);
    const right = scroller();
    const linked = useLinkedVerticalScroll(frames);

    linked.syncFrom(left, [right]);

    expect(right.scrollTop).toBe(0);
    frames.flush();
    expect(right.scrollTop).toBe(120);
  });

  it("supports either pane as the user-controlled source", () => {
    const frames = createFrameHarness();
    const left = scroller();
    const right = scroller(80);
    const linked = useLinkedVerticalScroll(frames);

    linked.syncFrom(right, [left]);
    frames.flush();

    expect(left.scrollTop).toBe(80);
  });

  it("ignores the scroll event caused by its own mirrored write", () => {
    const frames = createFrameHarness();
    const left = scroller(60);
    const right = scroller();
    const linked = useLinkedVerticalScroll(frames);

    linked.syncFrom(left, [right]);
    frames.flush();
    linked.syncFrom(right, [left]);

    expect(frames.pendingCount()).toBe(0);
    expect(left.scrollTop).toBe(60);
  });

  it("does not suppress a real user scroll after a mirrored write", () => {
    const frames = createFrameHarness();
    const left = scroller(60);
    const right = scroller();
    const linked = useLinkedVerticalScroll(frames);

    linked.syncFrom(left, [right]);
    frames.flush();
    right.scrollTop = 140;
    linked.syncFrom(right, [left]);
    frames.flush();

    expect(left.scrollTop).toBe(140);
  });

  it("sets every pane immediately for navigation and reset actions", () => {
    const frames = createFrameHarness();
    const left = scroller(10);
    const right = scroller(20);
    const linked = useLinkedVerticalScroll(frames);

    linked.setScrollTop([left, right], 240);

    expect(left.scrollTop).toBe(240);
    expect(right.scrollTop).toBe(240);
  });

  it("cancels pending synchronization when disposed", () => {
    const frames = createFrameHarness();
    const cancelSpy = vi.spyOn(frames, "cancelFrame");
    const left = scroller(100);
    const right = scroller();
    const linked = useLinkedVerticalScroll(frames);

    linked.syncFrom(left, [right]);
    linked.dispose();
    frames.flush();

    expect(cancelSpy).toHaveBeenCalledOnce();
    expect(right.scrollTop).toBe(0);
  });
});
