import { onMounted, onUnmounted } from "vue";

export interface KeyBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

export function useKeyboardShortcuts(bindings: KeyBinding[]) {
  function handler(e: KeyboardEvent) {
    for (const binding of bindings) {
      const ctrlMatch = binding.ctrl ? e.ctrlKey || e.metaKey : !(e.ctrlKey || e.metaKey);
      const shiftMatch = binding.shift ? e.shiftKey : !e.shiftKey;
      const altMatch = binding.alt ? e.altKey : !e.altKey;

      if (
        e.key.toLowerCase() === binding.key.toLowerCase() &&
        ctrlMatch &&
        shiftMatch &&
        altMatch
      ) {
        const target = e.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          if (!binding.ctrl) continue;
        }

        e.preventDefault();
        e.stopPropagation();
        binding.action();
        return;
      }
    }
  }

  onMounted(() => {
    window.addEventListener("keydown", handler);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", handler);
  });
}

export const SHORTCUTS = {
  COMMIT: { key: "k", ctrl: true, description: "提交" },
  PUSH: { key: "k", ctrl: true, shift: true, description: "推送" },
  PULL: { key: "t", ctrl: true, description: "拉取 / 更新" },
  REFRESH: { key: "F5", ctrl: true, description: "刷新" },
  SEARCH: { key: "l", ctrl: true, description: "在日志中搜索" },
  FIND: { key: "f", ctrl: true, description: "查找" },
  TOGGLE_DIFF: { key: "d", ctrl: true, description: "显示差异" },
  NEW_BRANCH: { key: "b", ctrl: true, alt: true, description: "新建分支" },
};
