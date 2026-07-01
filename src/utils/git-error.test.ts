import { describe, it, expect } from "vitest";
import { translateGitError } from "./git-error";

describe("translateGitError", () => {
  describe("通过 code 翻译（来自 server wrap classifyError）", () => {
    it("PATH_DENIED", () => {
      expect(translateGitError({ code: "PATH_DENIED" })).toMatch(/路径越界/);
    });
    it("NON_FAST_FORWARD", () => {
      expect(translateGitError({ code: "NON_FAST_FORWARD" })).toMatch(/pull/);
    });
    it("AUTH_FAILED", () => {
      expect(translateGitError({ code: "AUTH_FAILED" })).toMatch(/认证/);
    });
  });
  describe("通过原始 stderr 关键字翻译", () => {
    it("non-fast-forward", () => {
      expect(
        translateGitError("Updates were rejected because the tip is behind: non-fast-forward")
      ).toMatch(/pull/);
    });
    it("could not resolve host", () => {
      expect(
        translateGitError("fatal: unable to access 'x': Could not resolve host: github.com")
      ).toMatch(/无法解析|网络/);
    });
    it("index.lock", () => {
      expect(translateGitError("fatal: Unable to create '/.git/index.lock': File exists.")).toMatch(
        /锁定/
      );
    });
    it("destination already exists", () => {
      expect(
        translateGitError(
          "fatal: destination path 'foo' already exists and is not an empty directory."
        )
      ).toMatch(/已存在/);
    });
  });
  describe("Smart Pull 新增模式", () => {
    it("LOCAL_CHANGES_OVERWRITTEN code", () => {
      expect(translateGitError({ code: "LOCAL_CHANGES_OVERWRITTEN" })).toMatch(/未提交/);
    });
    it("STASH_POP_CONFLICT code", () => {
      expect(translateGitError({ code: "STASH_POP_CONFLICT" })).toMatch(/暂存/);
    });
    it("auto stash failed 原文", () => {
      expect(translateGitError("Auto stash failed: lock issue")).toMatch(/自动暂存失败/);
    });
    it("pull completed + stash pop conflict 原文", () => {
      expect(
        translateGitError(
          "Pull completed, but restoring stashed local changes caused conflicts. Resolve them and then drop stash@{0} manually."
        )
      ).toMatch(/拉取成功/);
    });
    it("pull completed + stash pop failed 原文", () => {
      expect(
        translateGitError("Pull completed, but stash pop failed: io error. Your local changes are still saved in stash@{0}.")
      ).toMatch(/拉取成功.*stash/);
    });
    it("pull completed auto-stashed restored 原文", () => {
      expect(
        translateGitError("Pull completed (local changes auto-stashed and restored)")
      ).toMatch(/拉取完成/);
    });
    it("your local changes overwritten 仍走旧 pattern", () => {
      expect(
        translateGitError(
          "Your local changes to the following files would be overwritten by merge"
        )
      ).toMatch(/本地未提交.*覆盖/);
    });
  });

  describe("无上游 / Push / 身份 等新增模式", () => {
    it("pull 未指定分支（无上游）", () => {
      expect(
        translateGitError(
          "You asked to pull from the remote 'origin', but did not specify a branch. Because this is not the default configured remote for your current branch, you must specify a branch on the command line."
        )
      ).toMatch(/上游/);
    });
    it("there is no tracking information", () => {
      expect(
        translateGitError("There is no tracking information for the current branch.")
      ).toMatch(/跟踪信息|上游/);
    });
    it("has no upstream branch", () => {
      expect(
        translateGitError("fatal: The current branch feat/x has no upstream branch.")
      ).toMatch(/上游/);
    });
    it("failed to push some refs", () => {
      expect(translateGitError("error: failed to push some refs to 'origin'")).toMatch(
        /推送失败/
      );
    });
    it("everything up-to-date", () => {
      expect(translateGitError("Everything up-to-date")).toMatch(/已是最新/);
    });
    it("please tell me who you are", () => {
      expect(
        translateGitError("*** Please tell me who you are. Run git config --global user.email")
      ).toMatch(/用户名和邮箱/);
    });
    it("dubious ownership", () => {
      expect(
        translateGitError("fatal: detected dubious ownership in repository at 'C:/repo'")
      ).toMatch(/safe\.directory|属主/);
    });
    it("not a git repository（无 fatal 前缀也能命中）", () => {
      expect(translateGitError("Not a git repository: C:/x")).toMatch(/不是 git/);
    });
    it("裸错误码字符串（生产模式）→ 中文", () => {
      expect(translateGitError("GIT_ERR")).toMatch(/git 内部错误/);
      expect(translateGitError("AUTH_FAILED")).toMatch(/认证/);
    });
  });

  describe("边界", () => {
    it('空字符串返回 "未知错误"', () => {
      expect(translateGitError("")).toBe("未知错误");
    });
    it("null", () => {
      expect(translateGitError(null)).toBe("未知错误");
    });
    it("未匹配模式 → 原文兜底", () => {
      expect(translateGitError("some random unknown text 中文混杂")).toBe(
        "some random unknown text 中文混杂"
      );
    });
    it("string 直接传入", () => {
      expect(translateGitError("fatal: not a git repository")).toMatch(/不是 git/);
    });
  });
});
