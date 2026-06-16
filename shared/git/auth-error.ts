/**
 * 联网 git 操作的「需要登录」判定（纯函数，前端 / 测试共用）。
 *
 * push/fetch 失败会抛错（message 来自 git stderr）；pull 走 MergeResult.message 不抛。
 * 两路都把文本喂给本函数，命中即弹 GitCredentialDialog。判定保持宽松但不误伤：
 * 仅匹配明确的鉴权 / 凭据缺失语义，避免把普通网络错误也当成需要登录。
 */
const AUTH_ERROR_PATTERN =
  /authentication failed|could not read username|could not read password|terminal prompts disabled|permission denied|http 403|invalid username or password|remote: invalid username or password|fatal: could not read/i;

export function isAuthError(message: string | null | undefined): boolean {
  if (!message) return false;
  return AUTH_ERROR_PATTERN.test(message);
}
