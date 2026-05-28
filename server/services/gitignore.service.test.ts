/**
 * statusService.addToGitignore · 单测
 *
 * 覆盖：
 *   - 不存在的 .gitignore 自动创建并写入 pattern
 *   - 已有 .gitignore 末尾追加新 pattern + 末尾换行兜底
 *   - 重复 pattern 不追加
 *   - 反斜杠路径归一化为正斜杠
 *   - 空路径 / 非字符串抛错
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { statusService } from "./status.service.js";

describe("statusService.addToGitignore", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "gm-gitignore-"));
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("无 .gitignore → 创建并写入 pattern + 末尾换行", async () => {
    await statusService.addToGitignore(repo, "secret.env");
    const content = await fs.readFile(path.join(repo, ".gitignore"), "utf8");
    expect(content).toBe("secret.env\n");
  });

  it("有 .gitignore 末尾无换行 → 自动补换行再追加", async () => {
    await fs.writeFile(path.join(repo, ".gitignore"), "node_modules", "utf8");
    await statusService.addToGitignore(repo, "dist");
    const content = await fs.readFile(path.join(repo, ".gitignore"), "utf8");
    expect(content).toBe("node_modules\ndist\n");
  });

  it("有 .gitignore 末尾有换行 → 直接追加", async () => {
    await fs.writeFile(path.join(repo, ".gitignore"), "node_modules\n", "utf8");
    await statusService.addToGitignore(repo, "dist");
    const content = await fs.readFile(path.join(repo, ".gitignore"), "utf8");
    expect(content).toBe("node_modules\ndist\n");
  });

  it("重复 pattern → 不追加", async () => {
    await fs.writeFile(path.join(repo, ".gitignore"), "secret.env\n", "utf8");
    await statusService.addToGitignore(repo, "secret.env");
    const content = await fs.readFile(path.join(repo, ".gitignore"), "utf8");
    expect(content).toBe("secret.env\n");
  });

  it("反斜杠路径 → 归一化为正斜杠", async () => {
    await statusService.addToGitignore(repo, "build\\output\\bin");
    const content = await fs.readFile(path.join(repo, ".gitignore"), "utf8");
    expect(content).toBe("build/output/bin\n");
  });

  it("空字符串路径 → 抛 INVALID_PATH", async () => {
    await expect(statusService.addToGitignore(repo, "")).rejects.toThrow(/INVALID_PATH/);
  });

  it("CRLF 文件 → 仍然能追加且不破坏现有内容", async () => {
    await fs.writeFile(path.join(repo, ".gitignore"), "a\r\nb\r\n", "utf8");
    await statusService.addToGitignore(repo, "c");
    const content = await fs.readFile(path.join(repo, ".gitignore"), "utf8");
    expect(content).toBe("a\r\nb\r\nc\n");
  });
});
