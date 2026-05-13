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
  COMMIT: { key: "k", ctrl: true, description: "Commit" },
  PUSH: { key: "k", ctrl: true, shift: true, description: "Push" },
  PULL: { key: "t", ctrl: true, description: "Pull / Update" },
  REFRESH: { key: "F5", ctrl: true, description: "Refresh" },
  SEARCH: { key: "l", ctrl: true, description: "Search in Log" },
  FIND: { key: "f", ctrl: true, description: "Find" },
  TOGGLE_DIFF: { key: "d", ctrl: true, description: "Show Diff" },
  NEW_BRANCH: { key: "b", ctrl: true, alt: true, description: "New Branch" },
};
