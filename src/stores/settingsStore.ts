import { defineStore } from "pinia";
import { ref } from "vue";

const LS_AUTO_FETCH = "gm.autoFetchEnabled";
const LS_AUTO_FETCH_INTERVAL = "gm.autoFetchIntervalMinutes";

function loadAutoFetchEnabled(): boolean {
  try {
    return localStorage.getItem(LS_AUTO_FETCH) === "1";
  } catch {
    return false;
  }
}
function loadAutoFetchInterval(): number {
  try {
    const v = Number(localStorage.getItem(LS_AUTO_FETCH_INTERVAL));
    return Number.isFinite(v) && v >= 1 ? v : 5;
  } catch {
    return 5;
  }
}

export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<"dark" | "light">("dark");
  const diffMode = ref<"side-by-side" | "unified">("side-by-side");
  const showCommitDetails = ref(true);
  const showDiffPreview = ref(true);
  const compactReferences = ref(true);
  const showTagNames = ref(true);
  const highlightMyCommits = ref(true);
  const highlightCurrentBranch = ref(true);
  const autoFetchEnabled = ref(loadAutoFetchEnabled());
  const autoFetchIntervalMinutes = ref(loadAutoFetchInterval());

  function toggleTheme() {
    theme.value = theme.value === "dark" ? "light" : "dark";
  }

  function setAutoFetchEnabled(v: boolean) {
    autoFetchEnabled.value = v;
    try {
      localStorage.setItem(LS_AUTO_FETCH, v ? "1" : "0");
    } catch {
      /* ignore quota */
    }
  }

  function setAutoFetchIntervalMinutes(v: number) {
    const clamped = Math.max(1, Math.min(120, Math.floor(v)));
    autoFetchIntervalMinutes.value = clamped;
    try {
      localStorage.setItem(LS_AUTO_FETCH_INTERVAL, String(clamped));
    } catch {
      /* ignore quota */
    }
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
    toggleTheme,
    setAutoFetchEnabled,
    setAutoFetchIntervalMinutes,
  };
});
