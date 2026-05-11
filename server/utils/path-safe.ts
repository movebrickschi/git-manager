import * as path from "path";

/**
 * 防止路径遍历：将 filePath 限制在 repoPath 内。
 * 若 filePath 越界（含 ../../etc/passwd 等）或为绝对路径，抛错。
 *
 * 拦截：
 * - 空字符串 / 非字符串
 * - 含 null byte（截断攻击）
 * - 越界 ../
 * - 绝对路径
 *
 * 通过：
 * - 仓库内任意相对路径（包括 ./README.md / a/b/c.ts）
 */
export function safeJoin(repoPath: string, filePath: string): string {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("invalid filePath");
  }
  if (filePath.includes("\0")) {
    throw new Error("filePath contains null byte");
  }
  const root = path.resolve(repoPath);
  const full = path.resolve(root, filePath);
  const rel = path.relative(root, full);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path traversal denied: ${filePath}`);
  }
  return full;
}
