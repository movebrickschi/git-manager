import { effectScope, nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { RepoWatcherEvent } from "../../shared/repo-watcher-types";
import { beginGitWrite, endGitWrite } from "@/utils/git-busy";
import {
  createPendingRepoChangeDispatcher,
  createRepoChangeDeduper,
  repoWatcherNeedsFullRefresh,
  setWatchedRepo,
  useRepoWatcher,
} from "./useRepoWatcher";

function makeEvent(at: number, overrides: Partial<RepoWatcherEvent> = {}): RepoWatcherEvent {
  return {
    repoPath: "C:/repo",
    kind: "refs",
    at,
    ...overrides,
  };
}

type EventListener = (event: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, EventListener[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close(): void {
    this.closed = true;
  }
}

describe("repoWatcherNeedsFullRefresh", () => {
  it("requests a full refresh for HEAD and refs changes only", () => {
    expect(repoWatcherNeedsFullRefresh("head")).toBe(true);
    expect(repoWatcherNeedsFullRefresh("refs")).toBe(true);
    expect(repoWatcherNeedsFullRefresh("work")).toBe(false);
    expect(repoWatcherNeedsFullRefresh("index")).toBe(false);
    expect(repoWatcherNeedsFullRefresh("merge")).toBe(false);
  });
});

describe("pending repo change delivery", () => {
  it("flushes the latest same-kind pending event inside the pre-write dedup window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.stubGlobal("EventSource", FakeEventSource);
    FakeEventSource.instances = [];
    await setWatchedRepo("C:/repo", true);

    const received: RepoWatcherEvent[] = [];
    const scope = effectScope();
    let dispose = () => {};
    let writing = false;

    try {
      scope.run(() => {
        dispose = useRepoWatcher((event) => received.push(event));
      });
      await nextTick();
      const source = FakeEventSource.instances.at(-1);
      expect(source).toBeDefined();

      source!.emit("repo-changed", makeEvent(1));
      beginGitWrite();
      writing = true;
      await nextTick();
      source!.emit("repo-changed", makeEvent(2));
      source!.emit("repo-changed", makeEvent(3));
      endGitWrite();
      writing = false;
      await nextTick();

      expect(received.map((event) => event.at)).toEqual([1, 3]);
    } finally {
      if (writing) endGitWrite();
      dispose();
      scope.stop();
      await setWatchedRepo(null, true);
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("keeps the newest timestamp and OR-merges requiresContextRefresh", () => {
    let writing = true;
    const received: RepoWatcherEvent[] = [];
    const dispatcher = createPendingRepoChangeDispatcher(
      (event) => received.push(event),
      () => writing
    );

    dispatcher.dispatch(makeEvent(10, { requiresContextRefresh: true }));
    dispatcher.dispatch(makeEvent(20));
    expect(dispatcher.pendingCount()).toBe(1);

    writing = false;
    dispatcher.flush();

    expect(received).toEqual([makeEvent(20, { requiresContextRefresh: true })]);
    expect(dispatcher.pendingCount()).toBe(0);
  });

  it("deduplicates an ordinary same-kind event immediately after a pending flush", () => {
    let now = 1_000;
    let writing = true;
    const received: RepoWatcherEvent[] = [];
    const deduper = createRepoChangeDeduper(
      (event) => received.push(event),
      () => now
    );
    const dispatcher = createPendingRepoChangeDispatcher(
      deduper.dispatch,
      () => writing,
      deduper.dispatchImmediately
    );

    dispatcher.dispatch(makeEvent(1));
    writing = false;
    dispatcher.flush();

    now += 50;
    dispatcher.dispatch(makeEvent(2));
    expect(received.map((event) => event.at)).toEqual([1]);

    now += 51;
    dispatcher.dispatch(makeEvent(3));
    expect(received.map((event) => event.at)).toEqual([1, 3]);
  });
});

describe("repo change dispatcher lifecycle", () => {
  it("clears and stops pending delivery", () => {
    let writing = true;
    const received: RepoWatcherEvent[] = [];
    const dispatcher = createPendingRepoChangeDispatcher(
      (event) => received.push(event),
      () => writing
    );

    dispatcher.dispatch(makeEvent(1));
    dispatcher.clear();
    writing = false;
    dispatcher.flush();
    expect(received).toEqual([]);
    expect(dispatcher.pendingCount()).toBe(0);

    writing = true;
    dispatcher.dispatch(makeEvent(2));
    dispatcher.stop();
    writing = false;
    dispatcher.dispatch(makeEvent(3));
    dispatcher.flush();
    expect(received).toEqual([]);
    expect(dispatcher.pendingCount()).toBe(0);
  });

  it("clears dedup history and permanently stops both dispatch paths", () => {
    let now = 1_000;
    const received: RepoWatcherEvent[] = [];
    const deduper = createRepoChangeDeduper(
      (event) => received.push(event),
      () => now
    );

    deduper.dispatch(makeEvent(1));
    now += 50;
    deduper.dispatch(makeEvent(2));
    deduper.clear();
    deduper.dispatch(makeEvent(3));
    expect(received.map((event) => event.at)).toEqual([1, 3]);

    deduper.stop();
    now += 1_000;
    deduper.dispatch(makeEvent(4));
    deduper.dispatchImmediately(makeEvent(5));
    expect(received.map((event) => event.at)).toEqual([1, 3]);
  });

  it("useRepoWatcher dispose closes transport and drops pending and later events", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    FakeEventSource.instances = [];
    await setWatchedRepo("C:/repo", true);

    const received: RepoWatcherEvent[] = [];
    const scope = effectScope();
    let dispose = () => {};
    let writing = false;

    try {
      scope.run(() => {
        dispose = useRepoWatcher((event) => received.push(event));
      });
      await nextTick();
      const source = FakeEventSource.instances.at(-1);
      expect(source).toBeDefined();

      beginGitWrite();
      writing = true;
      await nextTick();
      source!.emit("repo-changed", makeEvent(1));

      dispose();
      dispose();
      expect(source!.closed).toBe(true);

      endGitWrite();
      writing = false;
      await nextTick();
      source!.emit("repo-changed", makeEvent(2));
      expect(received).toEqual([]);
    } finally {
      if (writing) endGitWrite();
      dispose();
      scope.stop();
      await setWatchedRepo(null, true);
      vi.unstubAllGlobals();
    }
  });
});
