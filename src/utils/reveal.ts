import { platform } from "./commands";
import { errText } from "./error";

/**
 * 在文件管理器中定位文件，跨模式统一入口。
 *
 * - 桌面端（Electron）：调 shell.showItemInFolder 高亮该文件；失败则 toast 报错。
 * - Web 端：浏览器无权访问本地文件管理器，改为把**绝对路径复制到剪贴板**并 toast 提示，
 *   用户可直接粘贴到资源管理器 / 终端打开。剪贴板不可用时（非安全上下文等）退化为
 *   只展示路径，让用户手动选中复制——绝不再抛 NOT_SUPPORTED 报错。
 *
 * @param absPath 文件绝对路径（调用方负责拼好分隔符）
 * @param showToast 复用调用方的 useToast().show
 */
export async function revealOrCopyPath(
  absPath: string,
  showToast: (msg: string) => void
): Promise<void> {
  if (platform.isElectron) {
    try {
      await platform.revealInFolder(absPath);
    } catch (e: unknown) {
      showToast(`无法在资源管理器中打开：${errText(e)}`);
    }
    return;
  }

  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(absPath);
    showToast(`Web 模式无法直接定位，已复制绝对路径到剪贴板：${absPath}`);
  } catch {
    showToast(`Web 模式无法直接定位，文件绝对路径：${absPath}`);
  }
}
