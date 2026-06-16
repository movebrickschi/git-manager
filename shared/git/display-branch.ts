/**
 * 解析“状态栏应显示的当前分支名”，前后端共用、纯函数可测。
 *
 * simple-git 在 detached / rebase / bisect 等状态下，`git branch -vv` 会给出形如
 * `(HEAD detached at abc123)` / `(no branch, rebasing dev)` 的伪条目，且可能被标成 current。
 * 因此不能简单取 `find(isHead).name`（会把括号 porcelain 串当成分支名漏出去）。
 *
 * 规则：
 *  - 有真实 isHead 本地分支（名字不以 `(` 开头）→ 返回该分支名
 *  - 否则若有 headSha → 返回 `(HEAD: <sha>)`（detached/rebase 的统一显示）
 *  - 否则若存在 isHead 伪条目 → 兜底返回其原名
 *  - 都没有 → 返回 null，调用方应保留原值（避免把状态栏刷成空）
 *
 * @param local 本地分支列表（仅需 name / isHead）
 * @param headSha 当前 HEAD 短 sha（unborn 仓库为 null）
 */
export function resolveDisplayBranch(
  local: ReadonlyArray<{ name: string; isHead: boolean }>,
  headSha: string | null
): string | null {
  const head = local.find((b) => b.isHead);
  if (head && !head.name.startsWith("(")) return head.name;
  if (headSha) return `(HEAD: ${headSha})`;
  if (head) return head.name;
  return null;
}
