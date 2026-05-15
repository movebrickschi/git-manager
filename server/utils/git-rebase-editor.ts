/**
 * 跨平台生成"一次性 git sequence editor"脚本。
 *
 * git rebase -i 启动时会调用 `${GIT_SEQUENCE_EDITOR} <path-to-todo-file>` 让用户
 * 修改 todo 列表。我们生成一个临时 shell/cmd 脚本，作用就是把预先准备好的
 * todo 内容**覆盖**到 git 传进来的临时文件，从而实现"非交互式"传入用户编排
 * 好的 rebase 计划。
 *
 * 为什么不直接写 `.git/rebase-merge/git-rebase-todo`：那个文件只在 rebase
 * **已经启动**之后才存在；git 期望我们通过 editor 协议在启动阶段写入。
 *
 * 跨平台细节：
 *   - Linux/macOS：写 sh 脚本，`chmod +x`，`cp $todo $1`
 *   - Windows：写 .cmd 脚本，`copy /Y %todo% %1 >nul`
 *
 * Windows 路径注意事项：simple-git 在 Windows 上会把 `GIT_SEQUENCE_EDITOR` 当
 * shell command 处理，路径里的反斜杠 / 空格会被 cmd /c 解析。为简化兼容，我们
 * **统一**把整个 GIT_SEQUENCE_EDITOR 值用双引号包裹（包括 sh 脚本的解释器和路径）；
 * Windows 上则改用 .cmd 后缀让 cmd.exe 直接执行。
 *
 * 配合 `GIT_EDITOR=true`（取自系统 PATH 的 GNU true）让任何后续需要 message
 * 编辑的步骤直接接受默认值，reword / squash 的新消息通过 todo 中的 `exec git
 * commit --amend -m "..."` 行实现，无需 GIT_EDITOR 介入。
 */
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

export interface SequenceEditor {
  /** 完整命令字符串，可直接赋给 `GIT_SEQUENCE_EDITOR` env */
  command: string;
  /** 当 rebase 流程结束时调用，清理整套临时目录 */
  cleanup: () => Promise<void>;
}

/**
 * 把 `todoText` 准备成一次性 sequence editor。
 * 返回的 `command` 字符串供 `process.env.GIT_SEQUENCE_EDITOR` 使用。
 */
export async function createSequenceEditor(todoText: string): Promise<SequenceEditor> {
  const sessionDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "gitmanager-rebase-")
  );
  const todoFile = path.join(sessionDir, "todo.txt");
  await fs.writeFile(todoFile, todoText, "utf-8");

  const isWin = process.platform === "win32";
  const scriptPath = path.join(sessionDir, isWin ? "editor.cmd" : "editor.sh");

  if (isWin) {
    // %~1 = 第一个参数去引号
    // copy /Y 覆盖目标且不询问；> nul 抑制 "1 file copied" 输出
    const winTodo = todoFile.split("/").join("\\");
    const content = `@echo off\r\ncopy /Y "${winTodo}" "%~1" > nul\r\n`;
    await fs.writeFile(scriptPath, content, "utf-8");
  } else {
    const content = `#!/bin/sh\ncp "${todoFile}" "$1"\n`;
    await fs.writeFile(scriptPath, content, "utf-8");
    await fs.chmod(scriptPath, 0o755);
  }

  // GIT_SEQUENCE_EDITOR 必须可被 shell 直接执行；带空格的路径用双引号包裹
  // Windows 的 .cmd 文件，git 会通过 cmd.exe 调用；带引号路径 OK
  const command = `"${scriptPath}"`;

  return {
    command,
    cleanup: async () => {
      try {
        await fs.rm(sessionDir, { recursive: true, force: true });
      } catch {
        // 清理失败不算错；下次 boot 时 OS 自己回收
      }
    },
  };
}

/**
 * 转义 shell 单引号内的内容。对 reword / squash 新消息嵌入到 todo 文件中
 * 的 `exec git commit --amend -m '<msg>'` 行使用。
 *
 * 实现：把每个 `'` 替换为 `'\''`，即 close-quote → escape → reopen-quote。
 */
export function shellEscapeSingleQuote(s: string): string {
  return s.replace(/'/g, "'\\''");
}
