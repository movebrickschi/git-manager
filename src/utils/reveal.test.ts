import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { platformMock } = vi.hoisted(() => ({
  platformMock: {
    isElectron: false,
    selectDirectory: vi.fn(),
    revealInFolder: vi.fn(),
  },
}));

vi.mock("./commands", () => ({ platform: platformMock }));

import { revealOrCopyPath } from "./reveal";

describe("revealOrCopyPath", () => {
  let toasts: string[];
  const showToast = (m: string): void => {
    toasts.push(m);
  };

  beforeEach(() => {
    toasts = [];
    platformMock.isElectron = false;
    platformMock.revealInFolder.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Electron 模式：调用 revealInFolder，不弹 toast", async () => {
    platformMock.isElectron = true;
    platformMock.revealInFolder.mockResolvedValue(undefined);

    await revealOrCopyPath("C:/repo/a.txt", showToast);

    expect(platformMock.revealInFolder).toHaveBeenCalledWith("C:/repo/a.txt");
    expect(toasts).toHaveLength(0);
  });

  it("Electron 模式：revealInFolder 失败时 toast 报错", async () => {
    platformMock.isElectron = true;
    platformMock.revealInFolder.mockRejectedValue(new Error("boom"));

    await revealOrCopyPath("C:/repo/a.txt", showToast);

    expect(toasts[0]).toContain("boom");
  });

  it("Web 模式：复制绝对路径到剪贴板并提示，不调用 revealInFolder", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await revealOrCopyPath("C:/repo/a.txt", showToast);

    expect(writeText).toHaveBeenCalledWith("C:/repo/a.txt");
    expect(platformMock.revealInFolder).not.toHaveBeenCalled();
    expect(toasts[0]).toContain("已复制");
    expect(toasts[0]).toContain("C:/repo/a.txt");
  });

  it("Web 模式：剪贴板不可用时退化为只展示路径，不报 NOT_SUPPORTED", async () => {
    vi.stubGlobal("navigator", { clipboard: undefined });

    await revealOrCopyPath("C:/repo/a.txt", showToast);

    expect(toasts[0]).toContain("C:/repo/a.txt");
    expect(toasts[0]).not.toContain("已复制");
    expect(toasts[0]).not.toContain("NOT_SUPPORTED");
  });

  it("Web 模式：writeText 抛错时退化为只展示路径", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await revealOrCopyPath("C:/repo/a.txt", showToast);

    expect(writeText).toHaveBeenCalled();
    expect(toasts[0]).toContain("C:/repo/a.txt");
    expect(toasts[0]).not.toContain("已复制");
  });
});
