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
  const raw = errMsg(e);
  return translateRuntimeError(raw) ?? translateGitError(raw);
}

function translateRuntimeError(msg: string): string | null {
  const ipc = msg.match(/^Error invoking remote method '([^']+)':\s*(.*)$/i);
  if (ipc) {
    const method = ipcMethodLabel(ipc[1] ?? "");
    const detail = translateRuntimeDetail(ipc[2] ?? "");
    return `调用本地功能失败（${method}）：${detail}`;
  }
  return null;
}

function ipcMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    open_repo: "打开仓库",
    clone_repo: "克隆仓库",
    pull_remote: "拉取",
    force_pull: "强制拉取",
    reset_to_remote: "重置到远端",
    push_remote: "推送",
    fetch_remote: "抓取",
  };
  return labels[method] ?? method;
}

function translateRuntimeDetail(detail: string): string {
  const translated = translateGitError(detail);
  if (translated !== detail) return translated;
  return detail
    .replace(/^TypeError:\s*/i, "类型错误：")
    .replace(/^ReferenceError:\s*/i, "引用错误：")
    .replace(/^SyntaxError:\s*/i, "语法错误：")
    .replace(/\bis not a function\b/i, "不是函数")
    .replace(/\bCannot find module\b/i, "找不到模块")
    .replace(/\bCannot read properties of undefined\b/i, "无法读取未定义对象的属性")
    .replace(/\bCannot read property\b/i, "无法读取属性");
}
