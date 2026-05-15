/**
 * Phase 3 E smoke test：用真实的 git CLI 在一个临时仓库里跑一次混合 rebase
 * 编排（pick + reword + drop），验证：
 *   1. 临时 GIT_SEQUENCE_EDITOR 脚本能被 git 调用并替换 todo 文件（Windows .cmd + sh）
 *   2. reword 的 `exec git commit --amend -m '...'` 行能被 git 正确执行
 *   3. drop 行能真正丢弃该 commit
 *   4. 最终 commit 数量 / message 都符合预期
 *
 * 运行：node scripts/smoke-rebase.mjs
 * 失败时退出码 1；成功时打印 ✅。
 *
 * 不进 CI（依赖 git CLI + 临时目录），但开发期手动跑一次确认就够，等价于
 * "我把这条命令亲手敲过"的证据，避免"应该没问题"。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

async function main() {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "rebase-smoke-"));
  console.log(`[smoke] tmp repo at ${tmpRoot}`);
  try {
    const run = (cmd) =>
      execSync(cmd, { cwd: tmpRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();

    run("git init -b main");
    run('git config user.email "smoke@test"');
    run('git config user.name "Smoke"');

    for (let i = 1; i <= 4; i++) {
      await writeFile(path.join(tmpRoot, `f${i}.txt`), `v${i}\n`, "utf-8");
      run(`git add f${i}.txt`);
      run(`git commit -m "commit ${i}"`);
    }

    const before = run('git log --oneline');
    console.log("[smoke] before rebase:\n" + before);

    // 直接通过 tsx loader import 源文件 .ts
    // 调用方式：tsx scripts/smoke-rebase.mjs
    const { serializeTodos } = await import("../server/services/rebase.service.ts");
    const { createSequenceEditor } = await import("../server/utils/git-rebase-editor.ts");

    // 编排：commit 1 pick，commit 2 reword → "renamed second"，commit 3 drop，commit 4 pick
    const commits = run('git log --reverse --pretty=format:%h~%s').split("\n").map((l) => {
      const [h, ...s] = l.split("~");
      return { h, s: s.join("~") };
    });
    const todoText = serializeTodos([
      { action: "pick", commitId: "", shortId: commits[0].h, subject: commits[0].s },
      { action: "reword", commitId: "", shortId: commits[1].h, subject: commits[1].s, newMessage: "renamed second" },
      { action: "drop", commitId: "", shortId: commits[2].h, subject: commits[2].s },
      { action: "pick", commitId: "", shortId: commits[3].h, subject: commits[3].s },
    ]);
    console.log("[smoke] todo text:\n" + todoText);

    const editor = await createSequenceEditor(todoText);
    try {
      const env = {
        ...process.env,
        GIT_SEQUENCE_EDITOR: editor.command,
        GIT_EDITOR: process.platform === "win32" ? "rem" : "true",
      };
      execSync(`git rebase -i --no-autosquash --root`, {
        cwd: tmpRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } finally {
      await editor.cleanup();
    }

    const after = run('git log --oneline');
    console.log("[smoke] after rebase:\n" + after);
    const messages = run('git log --reverse --pretty=format:%s').split("\n");

    const expected = ["commit 1", "renamed second", "commit 4"];
    if (
      messages.length !== expected.length ||
      messages.some((m, i) => m !== expected[i])
    ) {
      throw new Error(
        `expected commits ${JSON.stringify(expected)} but got ${JSON.stringify(messages)}`
      );
    }

    console.log("[smoke] ✅ pass — pick+reword+drop sequence verified end-to-end");
  } finally {
    try {
      await rm(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((e) => {
  console.error("[smoke] ❌ FAIL:", e);
  process.exit(1);
});
