import { defineStore } from "pinia";
import { ref, watch } from "vue";

/**
 * 所有设置项的 localStorage key 集中管理。
 * 改名前先确认 grep 项目内引用，避免遗留旧 key 残值。
 */
const LS = {
  theme: "gm.theme",
  diffMode: "gm.diffMode",
  showCommitDetails: "gm.showCommitDetails",
  showDiffPreview: "gm.showDiffPreview",
  compactReferences: "gm.compactReferences",
  showTagNames: "gm.showTagNames",
  highlightMyCommits: "gm.highlightMyCommits",
  highlightCurrentBranch: "gm.highlightCurrentBranch",
  autoFetchEnabled: "gm.autoFetchEnabled",
  autoFetchIntervalMinutes: "gm.autoFetchIntervalMinutes",
  fetchOnOpen: "gm.fetchOnOpen",
  autoRefreshOnFsChange: "gm.autoRefreshOnFsChange",
} as const;

function readBool(key: string, defaultValue: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return raw === "1";
  } catch {
    return defaultValue;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore quota */
  }
}

function readString<T extends string>(key: string, defaultValue: T, allowed: readonly T[]): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null && (allowed as readonly string[]).includes(raw)) return raw as T;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota */
  }
}

function readInt(key: string, defaultValue: number, min: number, max: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    if (Number.isFinite(v) && v >= min && v <= max) return Math.floor(v);
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

export const useSettingsStore = defineStore("settings", () => {
  // 启动时从 localStorage 读取，未存过则用默认值
  const theme = ref<"dark" | "light">(readString(LS.theme, "dark", ["dark", "light"] as const));
  const diffMode = ref<"side-by-side" | "unified">(
    readString(LS.diffMode, "side-by-side", ["side-by-side", "unified"] as const)
  );
  const showCommitDetails = ref(readBool(LS.showCommitDetails, true));
  const showDiffPreview = ref(readBool(LS.showDiffPreview, true));
  const compactReferences = ref(readBool(LS.compactReferences, true));
  const showTagNames = ref(readBool(LS.showTagNames, true));
  const highlightMyCommits = ref(readBool(LS.highlightMyCommits, true));
  const highlightCurrentBranch = ref(readBool(LS.highlightCurrentBranch, true));
  const autoFetchEnabled = ref(readBool(LS.autoFetchEnabled, false));
  const autoFetchIntervalMinutes = ref(readInt(LS.autoFetchIntervalMinutes, 5, 1, 120));
  const fetchOnOpen = ref(readBool(LS.fetchOnOpen, true));
  const autoRefreshOnFsChange = ref(readBool(LS.autoRefreshOnFsChange, true));

  // 所有 ref 自动持久化（watch 监听 ref 变化 → localStorage 写）。
  // 即便外部直接 mutate（如 v-model），也能保证落盘。
  watch(theme, (v) => writeString(LS.theme, v));
  watch(diffMode, (v) => writeString(LS.diffMode, v));
  watch(showCommitDetails, (v) => writeBool(LS.showCommitDetails, v));
  watch(showDiffPreview, (v) => writeBool(LS.showDiffPreview, v));
  watch(compactReferences, (v) => writeBool(LS.compactReferences, v));
  watch(showTagNames, (v) => writeBool(LS.showTagNames, v));
  watch(highlightMyCommits, (v) => writeBool(LS.highlightMyCommits, v));
  watch(highlightCurrentBranch, (v) => writeBool(LS.highlightCurrentBranch, v));

  function toggleTheme() {
    theme.value = theme.value === "dark" ? "light" : "dark";
  }

  function setTheme(v: "dark" | "light") {
    theme.value = v;
  }

  function setDiffMode(v: "side-by-side" | "unified") {
    diffMode.value = v;
  }

  function setAutoFetchEnabled(v: boolean) {
    autoFetchEnabled.value = v;
    writeBool(LS.autoFetchEnabled, v);
  }

  function setAutoFetchIntervalMinutes(v: number) {
    const clamped = Math.max(1, Math.min(120, Math.floor(v)));
    autoFetchIntervalMinutes.value = clamped;
    try {
      localStorage.setItem(LS.autoFetchIntervalMinutes, String(clamped));
    } catch {
      /* ignore quota */
    }
  }

  function setFetchOnOpen(v: boolean) {
    fetchOnOpen.value = v;
    writeBool(LS.fetchOnOpen, v);
  }

  function setAutoRefreshOnFsChange(v: boolean) {
    autoRefreshOnFsChange.value = v;
    writeBool(LS.autoRefreshOnFsChange, v);
  }

  return {
    theme,
    diffMode,
    showCommitDetails,
    showDiffPreview,
    compactReferences,
    showTagNames,
    highlightMyCommits,
    highlightCurrentBranch,
    autoFetchEnabled,
    autoFetchIntervalMinutes,
    fetchOnOpen,
    autoRefreshOnFsChange,
    toggleTheme,
    setTheme,
    setDiffMode,
    setAutoFetchEnabled,
    setAutoFetchIntervalMinutes,
    setFetchOnOpen,
    setAutoRefreshOnFsChange,
  };
});
