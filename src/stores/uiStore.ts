import { defineStore } from "pinia";
import { ref } from "vue";

export const useUiStore = defineStore("ui", () => {
  const toastMessage = ref("");
  const toastVisible = ref(false);
  const progressActive = ref(false);
  const progressLabel = ref("");
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showToast(msg: string, durationMs = 3000) {
    toastMessage.value = msg;
    toastVisible.value = true;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastVisible.value = false;
    }, durationMs);
  }

  function startProgress(label = "") {
    progressActive.value = true;
    progressLabel.value = label;
  }

  function stopProgress() {
    progressActive.value = false;
    progressLabel.value = "";
  }

  return { toastMessage, toastVisible, progressActive, progressLabel, showToast, startProgress, stopProgress };
});
