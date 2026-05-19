<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { aiBridge } from "@/services/ai";
import {
  AI_PRESETS,
  DEFAULT_PUBLIC_AI_SETTINGS,
  DEFAULT_REPORT_AI_SETTINGS,
  type AiSettings,
  type ReportAiSettings,
} from "../../../shared/ai/types";

const { t } = useI18n();

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "saved"): void;
}>();

const baseUrl = ref(DEFAULT_PUBLIC_AI_SETTINGS.baseUrl);
const apiKey = ref("");
const apiKeyVisible = ref(false);
const apiKeyExisting = ref(false);
const model = ref(DEFAULT_PUBLIC_AI_SETTINGS.model);
const commitStyle = ref<AiSettings["commitStyle"]>("cc");
const lang = ref<AiSettings["lang"]>("auto");
const timeout = ref(DEFAULT_PUBLIC_AI_SETTINGS.timeout);
const maxDiffChars = ref(DEFAULT_PUBLIC_AI_SETTINGS.maxDiffChars);

/**
 * 日报润色专属配置。复用 commit 同一份 baseUrl/apiKey/model/timeout（顶层），
 * 仅风格 / 语言 / 输入截断阈值在此独立保留。
 *
 * UI 暂不暴露这三项（保持设置面板简洁），实际配置入口由 Wave 4 的 ReportPanel 提供；
 * 此处仅作 round-trip 透传，避免重写时把已有 report 配置覆盖为默认值。
 */
const reportConfig = ref<ReportAiSettings>({ ...DEFAULT_REPORT_AI_SETTINGS });

const presetId = ref("custom");
const advancedOpen = ref(false);
const saving = ref(false);
const testing = ref(false);
const testToast = ref<{ ok: boolean; text: string } | null>(null);
const loadError = ref<string | null>(null);

const apiKeyPlaceholder = computed(() =>
  apiKeyExisting.value
    ? t("ai.settings.apikey_placeholder_existing")
    : t("ai.settings.apikey_placeholder_new")
);

function pickPresetById(id: string) {
  presetId.value = id;
  if (id === "custom") return;
  const p = AI_PRESETS.find((x) => x.id === id);
  if (!p) return;
  baseUrl.value = p.baseUrl;
  model.value = p.model;
}

function detectPresetFromUrl(url: string): string {
  const match = AI_PRESETS.find((p) => p.baseUrl && url.startsWith(p.baseUrl));
  return match?.id ?? "custom";
}

async function loadSettings() {
  loadError.value = null;
  try {
    const view = await aiBridge.getSettings();
    baseUrl.value = view.baseUrl;
    model.value = view.model;
    commitStyle.value = view.commitStyle;
    lang.value = view.lang;
    timeout.value = view.timeout;
    maxDiffChars.value = view.maxDiffChars;
    reportConfig.value = { ...DEFAULT_REPORT_AI_SETTINGS, ...(view.report ?? {}) };
    apiKeyExisting.value = view.hasApiKey;
    apiKey.value = "";
    presetId.value = detectPresetFromUrl(view.baseUrl);
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    loadError.value = t("ai.settings.load_failed", { reason });
  }
}

function buildSettings(): AiSettings {
  return {
    baseUrl: baseUrl.value.trim(),
    apiKey: apiKey.value,
    model: model.value.trim(),
    commitStyle: commitStyle.value,
    lang: lang.value,
    timeout: Math.max(3000, Number(timeout.value) || DEFAULT_PUBLIC_AI_SETTINGS.timeout),
    maxDiffChars: Math.max(
      500,
      Number(maxDiffChars.value) || DEFAULT_PUBLIC_AI_SETTINGS.maxDiffChars
    ),
    report: { ...reportConfig.value },
  };
}

async function handleSave() {
  if (!baseUrl.value.trim()) {
    testToast.value = { ok: false, text: t("ai.settings.baseurl_required") };
    return;
  }
  saving.value = true;
  testToast.value = null;
  try {
    await aiBridge.saveSettings(buildSettings());
    emit("saved");
    emit("close");
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    testToast.value = { ok: false, text: t("ai.settings.save_failed", { reason }) };
  } finally {
    saving.value = false;
  }
}

async function handleTest() {
  testing.value = true;
  testToast.value = null;
  try {
    const r = await aiBridge.testConnection(buildSettings());
    if (r.ok) {
      const hint = r.models?.length
        ? t("ai.settings.test_models_hint", { count: r.models.length })
        : "";
      testToast.value = { ok: true, text: t("ai.settings.test_success") + hint };
    } else {
      testToast.value = { ok: false, text: `${r.code}：${r.reason}` };
    }
  } catch (e: unknown) {
    testToast.value = { ok: false, text: e instanceof Error ? e.message : String(e) };
  } finally {
    testing.value = false;
  }
}

function handleCancel() {
  emit("close");
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      testToast.value = null;
      void loadSettings();
    }
  },
  { immediate: true }
);
</script>

<template>
  <div v-if="visible" class="ai-dialog-backdrop" @click.self="handleCancel">
    <div class="ai-dialog" role="dialog" aria-labelledby="ai-dlg-title">
      <header class="ai-dialog-header">
        <h3 id="ai-dlg-title">{{ $t("ai.settings.title") }}</h3>
        <button
          class="ai-dialog-x"
          @click="handleCancel"
          :title="$t('ai.settings.close')"
          :aria-label="$t('ai.settings.close')"
        >
          ×
        </button>
      </header>

      <div v-if="loadError" class="ai-row ai-error-row">{{ loadError }}</div>

      <div class="ai-dialog-body">
        <label class="ai-row">
          <span class="ai-label">{{ $t("ai.settings.provider") }}</span>
          <select v-model="presetId" @change="pickPresetById(presetId)">
            <option v-for="p in AI_PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </label>

        <label class="ai-row">
          <span class="ai-label">{{ $t("ai.settings.baseurl") }}</span>
          <input v-model="baseUrl" type="text" placeholder="https://api.deepseek.com/v1" />
        </label>

        <label class="ai-row">
          <span class="ai-label">{{ $t("ai.settings.apikey") }}</span>
          <div class="ai-row-inline">
            <input
              v-model="apiKey"
              :type="apiKeyVisible ? 'text' : 'password'"
              :placeholder="apiKeyPlaceholder"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              type="button"
              class="ai-toggle"
              @click="apiKeyVisible = !apiKeyVisible"
              :title="
                apiKeyVisible ? $t('ai.settings.apikey_hide') : $t('ai.settings.apikey_show')
              "
            >
              {{ apiKeyVisible ? "🙈" : "👁" }}
            </button>
          </div>
        </label>

        <label class="ai-row">
          <span class="ai-label">{{ $t("ai.settings.model") }}</span>
          <input v-model="model" type="text" placeholder="deepseek-chat" />
        </label>

        <div class="ai-row">
          <span class="ai-label">{{ $t("ai.settings.commit_style") }}</span>
          <div class="ai-radio-group">
            <label>
              <input type="radio" v-model="commitStyle" value="cc" />
              {{ $t("ai.settings.style_cc") }}
            </label>
            <label>
              <input type="radio" v-model="commitStyle" value="plain" />
              {{ $t("ai.settings.style_plain") }}
            </label>
            <label>
              <input type="radio" v-model="commitStyle" value="gitmoji" />
              {{ $t("ai.settings.style_gitmoji") }}
            </label>
          </div>
        </div>

        <div class="ai-row">
          <span class="ai-label">{{ $t("ai.settings.lang") }}</span>
          <div class="ai-radio-group">
            <label>
              <input type="radio" v-model="lang" value="zh" />
              {{ $t("ai.settings.lang_zh") }}
            </label>
            <label>
              <input type="radio" v-model="lang" value="en" />
              {{ $t("ai.settings.lang_en") }}
            </label>
            <label>
              <input type="radio" v-model="lang" value="auto" />
              {{ $t("ai.settings.lang_auto") }}
            </label>
          </div>
        </div>

        <details class="ai-advanced" :open="advancedOpen" @toggle="advancedOpen = !advancedOpen">
          <summary>{{ $t("ai.settings.advanced") }}</summary>
          <label class="ai-row">
            <span class="ai-label">{{ $t("ai.settings.timeout") }}</span>
            <input v-model.number="timeout" type="number" min="3000" step="1000" />
          </label>
          <label class="ai-row">
            <span class="ai-label">{{ $t("ai.settings.max_diff_chars") }}</span>
            <input v-model.number="maxDiffChars" type="number" min="500" step="500" />
          </label>
        </details>

        <div
          v-if="testToast"
          class="ai-test-toast"
          :class="{ ok: testToast.ok, err: !testToast.ok }"
        >
          {{ testToast.text }}
        </div>
      </div>

      <footer class="ai-dialog-footer">
        <button class="ai-btn-secondary" :disabled="testing || saving" @click="handleTest">
          <span v-if="testing" class="ai-mini-spinner" />
          {{ testing ? $t("ai.settings.testing") : $t("ai.settings.test_btn") }}
        </button>
        <div style="flex: 1" />
        <button class="ai-btn-secondary" :disabled="saving" @click="handleCancel">
          {{ $t("ai.settings.cancel") }}
        </button>
        <button class="ai-btn-primary" :disabled="saving" @click="handleSave">
          {{ saving ? $t("ai.settings.saving") : $t("ai.settings.save") }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ai-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
}

.ai-dialog {
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  background: var(--color-surface);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.35);
}

.ai-dialog-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}

.ai-dialog-header h3 {
  margin: 0;
  font-size: 14px;
  flex: 1;
}

.ai-dialog-x {
  border: none;
  background: transparent;
  color: var(--color-foreground-muted);
  font-size: 18px;
  cursor: pointer;
  width: 24px;
  height: 24px;
  line-height: 1;
}

.ai-dialog-x:hover {
  color: var(--color-foreground);
}

.ai-dialog-body {
  padding: 12px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12px;
}

.ai-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ai-error-row {
  background: rgba(255, 80, 80, 0.1);
  color: var(--color-error);
  padding: 6px 8px;
  border-radius: 3px;
  margin: 8px 16px 0;
}

.ai-label {
  font-size: 11px;
  color: var(--color-foreground-muted);
}

.ai-row-inline {
  display: flex;
  gap: 4px;
}

.ai-row-inline input {
  flex: 1;
}

.ai-toggle {
  width: 32px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-active);
  border-radius: 3px;
  cursor: pointer;
}

.ai-radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.ai-radio-group label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}

.ai-advanced {
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 6px 8px;
}

.ai-advanced summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--color-foreground-muted);
  user-select: none;
}

.ai-advanced .ai-row {
  margin-top: 8px;
}

.ai-test-toast {
  padding: 6px 8px;
  border-radius: 3px;
  font-size: 11px;
  border: 1px solid var(--color-border);
  border-left-width: 3px;
}

.ai-test-toast.ok {
  border-left-color: var(--color-git-added);
  color: var(--color-git-added);
}

.ai-test-toast.err {
  border-left-color: var(--color-error);
  color: var(--color-error);
}

input[type="text"],
input[type="password"],
input[type="number"],
select {
  width: 100%;
  padding: 5px 7px;
  font-size: 12px;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-family: inherit;
}

input:focus,
select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.ai-dialog-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border);
}

.ai-btn-primary,
.ai-btn-secondary {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 3px;
  cursor: pointer;
  border: 1px solid var(--color-border);
}

.ai-btn-primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.ai-btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.ai-btn-secondary {
  background: var(--color-surface-active);
  color: var(--color-foreground);
}

.ai-btn-secondary:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.ai-btn-primary:disabled,
.ai-btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.ai-mini-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 4px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ai-mini-spin 0.8s linear infinite;
  vertical-align: -1px;
}

@keyframes ai-mini-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
