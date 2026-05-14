import { ref } from "vue";

export interface ConfirmDialogOptions {
  title: string;
  text: string;
  action: () => Promise<void> | void;
}

/**
 * 通用二次确认弹窗状态：标题 / 文本 / 待执行动作。
 * 保留一个 pending action，cancel 会清空，confirm 会执行后清空。
 */
export function useConfirmDialog() {
  const visible = ref(false);
  const title = ref("");
  const text = ref("");
  let pendingAction: ConfirmDialogOptions["action"] | null = null;

  function open(opts: ConfirmDialogOptions): void {
    title.value = opts.title;
    text.value = opts.text;
    pendingAction = opts.action;
    visible.value = true;
  }

  async function confirm(): Promise<void> {
    visible.value = false;
    const action = pendingAction;
    pendingAction = null;
    if (action) {
      await action();
    }
  }

  function cancel(): void {
    visible.value = false;
    pendingAction = null;
  }

  return { visible, title, text, open, confirm, cancel };
}
