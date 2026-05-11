/**
 * 把 unknown 错误统一映射为字符串消息，避免全项目散落 `catch (e: any) { e.message }`。
 *
 * 用法：
 *   try { ... } catch (e: unknown) {
 *     showToast(`操作失败: ${errMsg(e)}`);
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
