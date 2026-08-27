/**
 * 日报仓库勾选：独立多选（不是单选），列表 = 已打开 ∪ 最近打开。
 */
import { describe, expect, it } from "vitest";
import {
  buildReportRepoOptions,
  defaultSelectedRepos,
  repoDisplayName,
  toggleRepoSelection,
} from "./report-repos.js";

describe("repoDisplayName", () => {
  it("Windows 路径取最后一段", () => {
    expect(repoDisplayName("C:\\lcc\\workspace\\git-manager")).toBe("git-manager");
  });

  it("POSIX 路径取最后一段", () => {
    expect(repoDisplayName("/home/me/work/hellome")).toBe("hellome");
  });
});

describe("buildReportRepoOptions", () => {
  it("已打开仓库排在前面，最近打开且未打开的跟在后面且不重复", () => {
    const options = buildReportRepoOptions({
      openRepos: [
        { path: "C:\\a\\git-manager", name: "git-manager", color: "#d73a49" },
        { path: "C:\\a\\hellome", name: "hellome", color: "#22863a" },
      ],
      recentRepos: [
        { path: "C:\\a\\git-manager" },
        { path: "C:\\a\\other" },
      ],
    });

    expect(options.map((o) => o.path)).toEqual([
      "C:\\a\\git-manager",
      "C:\\a\\hellome",
      "C:\\a\\other",
    ]);
    expect(options[0]?.open).toBe(true);
    expect(options[1]?.open).toBe(true);
    expect(options[2]?.open).toBe(false);
    expect(options[2]?.name).toBe("other");
  });

  it("跳过空路径", () => {
    const options = buildReportRepoOptions({
      openRepos: [{ path: "", name: "x", color: "#000" }],
      recentRepos: [{ path: "" }, { path: "C:\\a\\ok" }],
    });
    expect(options.map((o) => o.path)).toEqual(["C:\\a\\ok"]);
  });
});

describe("toggleRepoSelection · 独立多选，勾第二个不会取消第一个", () => {
  it("勾选第二个仓库时保留已勾选的第一个", () => {
    expect(toggleRepoSelection(["C:\\a\\git-manager"], "C:\\a\\hellome", true)).toEqual([
      "C:\\a\\git-manager",
      "C:\\a\\hellome",
    ]);
  });

  it("取消勾选只拿掉目标仓库，其它保持", () => {
    expect(
      toggleRepoSelection(["C:\\a\\git-manager", "C:\\a\\hellome"], "C:\\a\\git-manager", false)
    ).toEqual(["C:\\a\\hellome"]);
  });

  it("允许全部取消（空数组），不强制回退成单仓库", () => {
    expect(toggleRepoSelection(["C:\\a\\git-manager"], "C:\\a\\git-manager", false)).toEqual([]);
  });
});

describe("defaultSelectedRepos", () => {
  it("无持久化时默认勾上全部已打开仓库，而不是只留当前激活的那一个", () => {
    expect(
      defaultSelectedRepos({
        openPaths: ["C:\\a\\git-manager", "C:\\a\\hellome"],
        availablePaths: ["C:\\a\\git-manager", "C:\\a\\hellome", "C:\\a\\other"],
        persisted: null,
      })
    ).toEqual(["C:\\a\\git-manager", "C:\\a\\hellome"]);
  });

  it("有持久化时只保留仍在可选列表里的路径", () => {
    expect(
      defaultSelectedRepos({
        openPaths: ["C:\\a\\git-manager"],
        availablePaths: ["C:\\a\\git-manager", "C:\\a\\hellome", "C:\\a\\other"],
        persisted: ["C:\\a\\hellome", "C:\\gone"],
      })
    ).toEqual(["C:\\a\\hellome"]);
  });

  it("持久化全部失效时回退到已打开仓库", () => {
    expect(
      defaultSelectedRepos({
        openPaths: ["C:\\a\\git-manager"],
        availablePaths: ["C:\\a\\git-manager", "C:\\a\\other"],
        persisted: ["C:\\gone"],
      })
    ).toEqual(["C:\\a\\git-manager"]);
  });
});
