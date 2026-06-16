/**
 * 运行时生成 GIT_ASKPASS 包装脚本。
 *
 * 原理：git 需要凭据时若设了 `GIT_ASKPASS`，会逐字段调用 `GIT_ASKPASS "<prompt>"`，
 * 从其 stdout 读取答案。我们生成一个纯 node 脚本（askpass.js）按 prompt 文案区分
 * username / password，并从环境变量 GM_ASKPASS_USERNAME / GM_ASKPASS_PASSWORD 回显。
 *
 * 关键安全点：**脚本文件本身不含任何密钥**；用户名 / token 仅在调用时经环境变量
 * 注入到短生命周期子进程，不落盘、不进命令行参数。
 *
 * 为什么落到真实磁盘：Electron 打包后代码在 asar 内无法作为脚本被 git 执行，故必须
 * 写到真实目录（Electron=userData/askpass，Web/dev=tmpdir/gm-askpass）。
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ASKPASS_JS = `'use strict';
// 由 git-manager 运行时生成；不含任何密钥，仅从环境变量回显。
const prompt = process.argv[2] || "";
if (/username/i.test(prompt)) {
  process.stdout.write(process.env.GM_ASKPASS_USERNAME || "");
} else if (/password|token/i.test(prompt)) {
  process.stdout.write(process.env.GM_ASKPASS_PASSWORD || "");
}
process.exit(0);
`;

// win32：用 GM_ASKPASS_NODE 跑同目录 askpass.js；%~dp0 末尾自带反斜杠。
const ASKPASS_CMD = '@echo off\r\n"%GM_ASKPASS_NODE%" "%~dp0askpass.js" %*\r\n';

const ASKPASS_SH = '#!/bin/sh\n"$GM_ASKPASS_NODE" "$(dirname "$0")/askpass.js" "$@"\n';

export function defaultAskpassDir(): string {
  return path.join(os.tmpdir(), "gm-askpass");
}

export interface AskpassResult {
  /** GIT_ASKPASS 应指向的包装脚本绝对路径（win32 .cmd / posix .sh）。 */
  askpassPath: string;
}

async function writeIfChanged(file: string, content: string, mode: number): Promise<void> {
  try {
    const existing = await fs.readFile(file, "utf8");
    if (existing === content) {
      if (process.platform !== "win32") {
        await fs.chmod(file, mode).catch(() => {});
      }
      return;
    }
  } catch {
    /* 文件不存在，落到下面写入 */
  }
  await fs.writeFile(file, content, { mode });
  if (process.platform !== "win32") {
    await fs.chmod(file, mode).catch(() => {});
  }
}

/**
 * 幂等地把 askpass.js + 平台包装脚本写到 dir，返回包装脚本路径。
 * 已存在且内容一致则跳过写入（仅在 posix 上补一次可执行位）。
 */
export async function ensureAskpassScripts(dir = defaultAskpassDir()): Promise<AskpassResult> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await writeIfChanged(path.join(dir, "askpass.js"), ASKPASS_JS, 0o600);

  if (process.platform === "win32") {
    const cmdPath = path.join(dir, "askpass.cmd");
    await writeIfChanged(cmdPath, ASKPASS_CMD, 0o755);
    return { askpassPath: cmdPath };
  }

  const shPath = path.join(dir, "askpass.sh");
  await writeIfChanged(shPath, ASKPASS_SH, 0o755);
  return { askpassPath: shPath };
}
