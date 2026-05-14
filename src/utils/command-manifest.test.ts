import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { COMMANDS } from "../../shared/command-manifest";

/**
 * 守护 electron/preload.ts 中手写的 ALLOWED_CHANNELS 与 shared/command-manifest
 * 的 ipc 字段完全一致。
 *
 * 历史 bug：preload 手写名单与 manifest 漂移（push/pull/fetch 被改名为
 * push_remote/pull_remote/fetch_remote 时漏改 preload），导致 packaged 模式下
 * 这三条 IPC 被 preload 静默拒绝。
 *
 * 为什么 preload 不能直接 `import { COMMANDS } from "../shared/..."`：
 * Electron `webPreferences.sandbox = true` 的 preload 只能 require electron
 * 和极少数 Node 内置模块；require 外部 .js/.ts 会让整个 preload 静默失败，
 * renderer 端 `window.electronAPI` 变成 undefined（症状：UI 退回 web 模式）。
 *
 * 改名/新增 IPC 时**必须**同步 electron/preload.ts；本测试在 CI 中守护。
 */
describe("electron/preload ALLOWED_CHANNELS", () => {
  it("must contain every ipc from shared/command-manifest", async () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const preloadPath = path.join(repoRoot, "electron", "preload.ts");
    const source = await fs.readFile(preloadPath, "utf8");
    const missing = COMMANDS.map((c) => c.ipc).filter((ipc) => !source.includes(`"${ipc}"`));
    expect(missing).toEqual([]);
  });
});
