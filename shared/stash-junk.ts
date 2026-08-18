/**
 * 搁置时默认跳过的编译产物。
 *
 * `__pycache__` / `*.pyc` 是 Python 跑脚本吐出的字节码：二进制、可再生成、
 * 不该进 stash。更关键的是 `git stash push --staged` 对新增二进制打反向补丁
 * 时常报 `cannot apply binary patch ... without full index`，把整次搁置打成
 * 「stash 已建、工作区没清」的半残态。
 *
 * 只拦编译产物，不拦业务二进制（图片、字体等）——那些走 stash 的 restore 兜底。
 */
export function isStashJunkPath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  if (/(^|\/)__pycache__(\/|$)/.test(norm)) return true;
  if (/\.py[cod]$/i.test(norm)) return true;
  return false;
}
