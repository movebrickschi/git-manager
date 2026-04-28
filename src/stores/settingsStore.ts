import { defineStore } from "pinia";
import { ref } from "vue";

export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<"dark" | "light">("dark");
  const diffMode = ref<"side-by-side" | "unified">("side-by-side");
  const showCommitDetails = ref(true);
  const showDiffPreview = ref(true);
  const compactReferences = ref(true);
  const showTagNames = ref(true);
  const highlightMyCommits = ref(true);
  const highlightCurrentBranch = ref(true);

  function toggleTheme() {
    theme.value = theme.value === "dark" ? "light" : "dark";
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
    toggleTheme,
  };
});
