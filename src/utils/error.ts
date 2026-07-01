import { translateGitError } from "./git-error";

/**
 * 把 unknown 错误统一映射为字符串消息，避免全项目散落 `catch (e: any) { e.message }`。
 * 返回「原始」文本（不翻译），适合写日志。面向用户展示请用 {@link errText}。
 *
 * 用法：
 *   try { ... } catch (e: unknown) {
 *     showToast(`操作失败: ${errText(e)}`);
 *   }
 */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    const s = JSON.stringify(e);
    return typeof s === "string" ? s : String(e);
  } catch {
    return String(e);
  }
}

/**
 * 面向用户展示的错误文本：在 {@link errMsg} 基础上把常见 git 英文 stderr 翻成中文。
 * 未命中的文本按原样返回。日志请继续用 errMsg（不翻译）。
 */
export function errText(e: unknown): string {
  return translateGitError(errMsg(e));
}
