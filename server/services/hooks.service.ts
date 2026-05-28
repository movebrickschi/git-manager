/**
 * Git Hooks Service · 列出 / 读取 / 写入 .git/hooks/ 目录
 *
 * Git 内置 hook 类型（按 git man page 列举的常用）：
 *   pre-commit, prepare-commit-msg, commit-msg, post-commit,
 *   pre-rebase, post-checkout, post-merge, pre-push, pre-receive,
 *   update, post-receive, post-update, pre-auto-gc, post-rewrite,
 *   pre-applypatch, applypatch-msg, post-applypatch, sendemail-validate
 *
 * 启用约定：
 *   - 存在 `.git/hooks/<name>` 文件 → 启用
 *   - 存在 `.git/hooks/<name>.sample` → 模板，未启用
 *   - 存在 `.git/hooks/<name>.disabled` → 用户禁用（重命名而非删除，便于恢复）
 *
 * 不实现：实时验证 hook script 语法 / shell 兼容性 / GPG 签名钩子等高级 case。
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

const KNOWN_HOOKS = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-receive",
  "update",
  "post-receive",
  "post-update",
  "push-to-checkout",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
] as const;

export interface HookInfo {
  /** Hook 名（不含路径与后缀）。 */
  name: string;
  /** 当前状态：enabled / disabled / sample-only / missing */
  state: "enabled" | "disabled" | "sample-only" | "missing";
  /** 文件存在时的绝对路径 */
  filePath: string | null;
  /** 字节大小（仅 enabled / disabled / sample-only 有效） */
  size: number | null;
}

export const hooksService = {
  async listHooks(repoPath: string): Promise<HookInfo[]> {
    const hooksDir = path.join(repoPath, ".git", "hooks");
    const out: HookInfo[] = [];
    let entries: string[];
    try {
      entries = await fs.readdir(hooksDir);
    } catch {
      entries = [];
    }
    const fileSet = new Set(entries);

    for (const name of KNOWN_HOOKS) {
      const enabledFile = path.join(hooksDir, name);
      const sampleFile = enabledFile + ".sample";
      const disabledFile = enabledFile + ".disabled";

      let info: HookInfo = { name, state: "missing", filePath: null, size: null };

      if (fileSet.has(name)) {
        try {
          const stat = await fs.stat(enabledFile);
          info = { name, state: "enabled", filePath: enabledFile, size: stat.size };
        } catch {
          // ignore
        }
      } else if (fileSet.has(`${name}.disabled`)) {
        try {
          const stat = await fs.stat(disabledFile);
          info = { name, state: "disabled", filePath: disabledFile, size: stat.size };
        } catch {
          // ignore
        }
      } else if (fileSet.has(`${name}.sample`)) {
        try {
          const stat = await fs.stat(sampleFile);
          info = { name, state: "sample-only", filePath: sampleFile, size: stat.size };
        } catch {
          // ignore
        }
      }
      out.push(info);
    }
    return out;
  },

  async readHookContent(repoPath: string, hookName: string): Promise<string> {
    if (!KNOWN_HOOKS.includes(hookName as (typeof KNOWN_HOOKS)[number])) {
      throw new Error(`UNKNOWN_HOOK: ${hookName}`);
    }
    const hooksDir = path.join(repoPath, ".git", "hooks");
    const candidates = [
      path.join(hooksDir, hookName),
      path.join(hooksDir, `${hookName}.disabled`),
      path.join(hooksDir, `${hookName}.sample`),
    ];
    for (const p of candidates) {
      try {
        return await fs.readFile(p, "utf8");
      } catch {
        // 继续下一个候选
      }
    }
    throw new Error(`NOT_FOUND: hook ${hookName}`);
  },

  /**
   * 写入 hook 内容并设为 enabled 状态。
   * 自动创建 .git/hooks 目录与可执行权限（POSIX：mode 0o755；Windows 平台 mode 被忽略，
   * git for Windows 会按 .gitattributes filemode 与 sh.exe 解析 shebang 行）。
   */
  async writeHookContent(repoPath: string, hookName: string, content: string): Promise<void> {
    if (!KNOWN_HOOKS.includes(hookName as (typeof KNOWN_HOOKS)[number])) {
      throw new Error(`UNKNOWN_HOOK: ${hookName}`);
    }
    const hooksDir = path.join(repoPath, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
    const target = path.join(hooksDir, hookName);
    const disabled = `${target}.disabled`;
    await fs.writeFile(target, content, { encoding: "utf8", mode: 0o755 });
    // 如果存在同名 .disabled 文件，写入正名版本后清除
    try {
      await fs.unlink(disabled);
    } catch {
      // ignore
    }
  },

  /** 启用 hook：把 .disabled 重命名回原名。若已是 enabled 则 no-op。 */
  async enableHook(repoPath: string, hookName: string): Promise<void> {
    const hooksDir = path.join(repoPath, ".git", "hooks");
    const target = path.join(hooksDir, hookName);
    const disabled = `${target}.disabled`;
    try {
      await fs.access(disabled);
    } catch {
      return; // 没有 .disabled，无需操作
    }
    await fs.rename(disabled, target);
  },

  /** 禁用 hook：把启用文件重命名为 <name>.disabled，便于恢复。 */
  async disableHook(repoPath: string, hookName: string): Promise<void> {
    const hooksDir = path.join(repoPath, ".git", "hooks");
    const target = path.join(hooksDir, hookName);
    const disabled = `${target}.disabled`;
    try {
      await fs.access(target);
    } catch {
      return; // 已经不存在
    }
    // 若已有 .disabled，先删旧的（用户多次禁用 / 启用循环）
    try {
      await fs.unlink(disabled);
    } catch {
      // ignore
    }
    await fs.rename(target, disabled);
  },
};
