export interface VerticalScroller {
  scrollTop: number;
}

export interface FrameScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
}

interface PendingSync {
  top: number;
  targets: readonly VerticalScroller[];
}

function browserFrameScheduler(): FrameScheduler {
  return {
    requestFrame: (callback) => window.requestAnimationFrame(() => callback()),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
  };
}

export function useLinkedVerticalScroll(scheduler: FrameScheduler = browserFrameScheduler()) {
  const mirroredPositions = new WeakMap<VerticalScroller, number>();
  let pending: PendingSync | null = null;
  let frameId = 0;
  let disposed = false;

  function consumeMirroredEvent(source: VerticalScroller): boolean {
    const expected = mirroredPositions.get(source);
    if (expected === undefined) return false;

    mirroredPositions.delete(source);
    return Math.abs(expected - source.scrollTop) < 0.5;
  }

  function flush(): void {
    frameId = 0;
    const sync = pending;
    pending = null;
    if (!sync || disposed) return;

    for (const target of sync.targets) {
      if (Math.abs(target.scrollTop - sync.top) < 0.5) continue;
      mirroredPositions.set(target, sync.top);
      target.scrollTop = sync.top;
    }
  }

  function syncFrom(source: VerticalScroller, targets: readonly VerticalScroller[]): void {
    if (disposed || consumeMirroredEvent(source)) return;

    pending = { top: source.scrollTop, targets };
    if (!frameId) frameId = scheduler.requestFrame(flush);
  }

  function cancelPendingFrame(): void {
    if (frameId) scheduler.cancelFrame(frameId);
    frameId = 0;
    pending = null;
  }

  function setScrollTop(scrollers: readonly VerticalScroller[], top: number): void {
    if (disposed) return;
    cancelPendingFrame();

    for (const scroller of scrollers) {
      if (Math.abs(scroller.scrollTop - top) < 0.5) continue;
      mirroredPositions.set(scroller, top);
      scroller.scrollTop = top;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelPendingFrame();
  }

  return {
    syncFrom,
    setScrollTop,
    dispose,
  };
}
