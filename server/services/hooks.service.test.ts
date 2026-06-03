/**
 * hooksService · 单测
 *
 * 覆盖：
 *   - listHooks 全 missing / mixed enabled+sample+disabled / 未知 hook 名抛错
 *   - readHookContent 三状态都能读出
 *   - writeHookContent 创建启用版本 + 清除同名 disabled
 *   - enableHook / disableHook 重命名往返
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hooksService } from "./hooks.service.js";

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-hooks-"));
  // 模拟一个最小 git 仓库结构（hooks 目录）
  await fs.mkdir(path.join(dir, ".git", "hooks"), { recursive: true });
  return dir;
}

async function writeHookFile(repo: string, name: string, content = "#!/bin/sh\nexit 0\n") {
  await fs.writeFile(path.join(repo, ".git", "hooks", name), content, { mode: 0o755 });
}

describe("hooksService.listHooks", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("空 hooks 目录 → 所有 hook 都是 missing", async () => {
    const list = await hooksService.listHooks(repo);
    expect(list.every((h) => h.state === "missing")).toBe(true);
    expect(list.find((h) => h.name === "pre-commit")).toBeTruthy();
    expect(list.length).toBeGreaterThan(10);
  });

  it("混合状态：sample / enabled / disabled 各一", async () => {
    await writeHookFile(repo, "pre-commit.sample");
    await writeHookFile(repo, "pre-push");
    await writeHookFile(repo, "post-commit.disabled");

    const list = await hooksService.listHooks(repo);
    const preCommit = list.find((h) => h.name === "pre-commit")!;
    expect(preCommit.state).toBe("sample-only");
    expect(preCommit.size).toBeGreaterThan(0);

    const prePush = list.find((h) => h.name === "pre-push")!;
    expect(prePush.state).toBe("enabled");

    const postCommit = list.find((h) => h.name === "post-commit")!;
    expect(postCommit.state).toBe("disabled");
  });
});

describe("hooksService.readHookContent", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("enabled 状态优先于 disabled / sample", async () => {
    await writeHookFile(repo, "pre-commit", "ENABLED\n");
    await writeHookFile(repo, "pre-commit.sample", "SAMPLE\n");
    const content = await hooksService.readHookContent(repo, "pre-commit");
    expect(content).toBe("ENABLED\n");
  });

  it("disabled fallback 当 enabled 不存在", async () => {
    await writeHookFile(repo, "pre-commit.disabled", "DISABLED\n");
    const content = await hooksService.readHookContent(repo, "pre-commit");
    expect(content).toBe("DISABLED\n");
  });

  it("sample fallback 当其它都不存在", async () => {
    await writeHookFile(repo, "pre-commit.sample", "SAMPLE\n");
    const content = await hooksService.readHookContent(repo, "pre-commit");
    expect(content).toBe("SAMPLE\n");
  });

  it("全无 → 抛 NOT_FOUND", async () => {
    await expect(hooksService.readHookContent(repo, "pre-commit")).rejects.toThrow(/NOT_FOUND/);
  });

  it("未知 hook 名 → 抛 UNKNOWN_HOOK", async () => {
    await expect(hooksService.readHookContent(repo, "bogus-hook" as never)).rejects.toThrow(
      /UNKNOWN_HOOK/
    );
  });
});

describe("hooksService.writeHookContent + enable/disable 往返", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("write → 创建 enabled 文件", async () => {
    await hooksService.writeHookContent(repo, "pre-commit", "echo hi\n");
    const list = await hooksService.listHooks(repo);
    const pc = list.find((h) => h.name === "pre-commit")!;
    expect(pc.state).toBe("enabled");
    const content = await hooksService.readHookContent(repo, "pre-commit");
    expect(content).toBe("echo hi\n");
  });

  it("write 时若存在同名 .disabled → 清除", async () => {
    await writeHookFile(repo, "pre-commit.disabled", "OLD\n");
    await hooksService.writeHookContent(repo, "pre-commit", "NEW\n");
    const list = await hooksService.listHooks(repo);
    expect(list.find((h) => h.name === "pre-commit")!.state).toBe("enabled");
  });

  it("disable → enable 往返保持内容", async () => {
    await hooksService.writeHookContent(repo, "pre-commit", "echo hello\n");
    await hooksService.disableHook(repo, "pre-commit");
    expect(
      (await hooksService.listHooks(repo)).find((h) => h.name === "pre-commit")!.state
    ).toBe("disabled");
    await hooksService.enableHook(repo, "pre-commit");
    expect(
      (await hooksService.listHooks(repo)).find((h) => h.name === "pre-commit")!.state
    ).toBe("enabled");
    expect(await hooksService.readHookContent(repo, "pre-commit")).toBe("echo hello\n");
  });

  it("disable 不存在的文件 → no-op，不抛", async () => {
    await expect(hooksService.disableHook(repo, "pre-commit")).resolves.toBeUndefined();
  });
});
