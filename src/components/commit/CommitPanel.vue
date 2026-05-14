<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { onClickOutside } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { useCommitStore } from "@/stores/commitStore";
import { useRepoStore } from "@/stores/repoStore";
import { useToast } from "@/composables/useToast";
import Toolbar from "@/components/common/Toolbar.vue";
import ToolbarButton from "@/components/common/ToolbarButton.vue";
import FileTree from "@/components/common/FileTree.vue";
import PushDialog from "@/components/common/PushDialog.vue";
import AiSettingsDialog from "@/components/commit/AiSettingsDialog.vue";
import type { FileStatus } from "@/utils/commands";
import type { AiErrorCode } from "../../../shared/ai/types";

const { t } = useI18n();

const props = defineProps<{
  mode?: "full";
}>();

const commitStore = useCommitStore();
const repoStore = useRepoStore();
const { toastMessage, toastVisible, show: showToast } = useToast(3500);

const selectedFile = ref<FileStatus | null>(null);
const showPushDialog = ref(false);
const showAiMenu = ref(false);
const showAiSettings = ref(false);
const showAiOverwriteConfirm = ref(false);
const aiGroupRef = ref<HTMLElement | null>(null);

onClickOutside(aiGroupRef, () => {
  showAiMenu.value = false;
});

const AI_ERROR_I18N_KEY: Record<AiErrorCode, string> = {
  NO_API_KEY: "ai.err.no_api_key",
  NO_STAGED: "ai.err.no_staged",
  NETWORK: "ai.err.network",
  AUTH: "ai.err.auth",
  RATE_LIMIT: "ai.err.rate_limit",
  SERVER: "ai.err.server",
  TIMEOUT: "ai.err.timeout",
  EMPTY: "ai.err.empty",
  ABORT: "ai.err.abort",
  UNKNOWN: "ai.err.unknown",
};

function formatAiError(e: { code: AiErrorCode; reason: string }): string {
  const prefix = t(AI_ERROR_I18N_KEY[e.code] ?? "ai.err.unknown");
  return `${prefix}：${e.reason}`;
}

async function runAiGenerate(mode: "replace" | "append") {
  showAiOverwriteConfirm.value = false;
  showAiMenu.value = false;
  await commitStore.generateMessage(mode);
  if (commitStore.aiError && commitStore.aiError.code !== "ABORT") {
    showToast(formatAiError(commitStore.aiError));
  }
}

async function handleAiMainAction() {
  if (commitStore.isGeneratingAI) {
    await commitStore.cancelGenerate();
    return;
  }
  showAiMenu.value = false;
  if (commitStore.commitMessage.trim().length > 0) {
    showAiOverwriteConfirm.value = true;
    return;
  }
  await runAiGenerate("replace");
}

function handleRegenerateFromMenu() {
  showAiMenu.value = false;
  if (commitStore.commitMessage.trim().length > 0) {
    showAiOverwriteConfirm.value = true;
    return;
  }
  void runAiGenerate("replace");
}

function openAiSettings() {
  showAiMenu.value = false;
  showAiSettings.value = true;
}

function onAiSettingsSaved() {
  showToast(t("ai.settings.saved_toast"));
}

function useHistoryMessage(msg: string) {
  showAiMenu.value = false;
  commitStore.commitMessage = msg;
}

function onTextareaKeydown(e: KeyboardEvent) {
  const isPrimary = e.ctrlKey || e.metaKey;
  if (isPrimary && e.shiftKey && e.key.toLowerCase() === "g") {
    e.preventDefault();
    void handleAiMainAction();
  }
}

onMounted(() => {
  if (repoStore.activeRepo) {
    commitStore.loadStatus();
  }
});

watch(
  () => repoStore.activeRepo?.path,
  () => {
    if (repoStore.activeRepo) {
      commitStore.loadStatus();
    }
  }
);

function onSelectFile(file: FileStatus) {
  selectedFile.value = file;
}

async function handleCommit() {
  try {
    await commitStore.commit();
    await commitStore.loadStatus();
  } catch (e: any) {
    console.error("Commit failed:", e);
  }
}

async function handleCommitAndPush() {
  try {
    await commitStore.commit();
    await commitStore.loadStatus();
    showPushDialog.value = true;
  } catch (e: any) {
    console.error("Commit failed:", e);
  }
}

async function onPushConfirmed() {
  showPushDialog.value = false;
  await commitStore.loadStatus();
}

function onPushCancelled() {
  showPushDialog.value = false;
}
</script>

<template>
  <div class="commit-panel">
    <!-- Staged files -->
    <div class="file-section">
      <Toolbar compact>
        <span class="section-title">Staged</span>
        <span class="file-count">{{ commitStore.stagedFiles.length }}</span>
        <div style="flex: 1" />
        <ToolbarButton title="Unstage All" @click="commitStore.unstageAll">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="17 11 12 6 7 11" />
            <line x1="12" y1="18" x2="12" y2="6" />
          </svg>
        </ToolbarButton>
      </Toolbar>
      <div class="file-list">
        <div
          v-for="file in commitStore.stagedFiles"
          :key="'s-' + file.path"
          class="file-item"
          :class="{ selected: selectedFile?.path === file.path }"
          @click="onSelectFile(file)"
          @dblclick="commitStore.unstageFile(file.path)"
        >
          <span class="file-name">{{ file.path }}</span>
          <span class="file-status" :class="'status-' + file.status">
            {{
              file.status === "added"
                ? "A"
                : file.status === "modified"
                  ? "M"
                  : file.status === "deleted"
                    ? "D"
                    : file.status === "renamed"
                      ? "R"
                      : "?"
            }}
          </span>
        </div>
        <div v-if="commitStore.stagedFiles.length === 0" class="empty-hint">
          双击文件或使用 Stage All 暂存变更
        </div>
      </div>
    </div>

    <!-- Unstaged files -->
    <div class="file-section">
      <Toolbar compact>
        <span class="section-title">Changes</span>
        <span class="file-count">{{
          commitStore.unstagedFiles.length + commitStore.untrackedFiles.length
        }}</span>
        <div style="flex: 1" />
        <ToolbarButton title="Stage All" @click="commitStore.stageAll">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="7 13 12 18 17 13" />
            <line x1="12" y1="6" x2="12" y2="18" />
          </svg>
        </ToolbarButton>
      </Toolbar>
      <div class="file-list">
        <div
          v-for="file in [...commitStore.unstagedFiles, ...commitStore.untrackedFiles]"
          :key="'u-' + file.path"
          class="file-item"
          :class="{ selected: selectedFile?.path === file.path }"
          @click="onSelectFile(file)"
          @dblclick="commitStore.stageFile(file.path)"
        >
          <span class="file-name">{{ file.path }}</span>
          <span class="file-status" :class="'status-' + file.status">
            {{
              file.status === "added"
                ? "A"
                : file.status === "modified"
                  ? "M"
                  : file.status === "deleted"
                    ? "D"
                    : file.status === "untracked"
                      ? "U"
                      : file.status === "conflicted"
                        ? "!"
                        : "?"
            }}
          </span>
        </div>
        <div
          v-if="commitStore.unstagedFiles.length === 0 && commitStore.untrackedFiles.length === 0"
          class="empty-hint"
        >
          工作区无变更
        </div>
      </div>
    </div>

    <!-- Commit message -->
    <div class="commit-message-section">
      <textarea
        v-model="commitStore.commitMessage"
        class="commit-textarea"
        :placeholder="$t('ai.textarea_placeholder')"
        rows="4"
        @keydown="onTextareaKeydown"
      />
      <div class="commit-options">
        <label class="amend-checkbox">
          <input type="checkbox" v-model="commitStore.isAmend" />
          <span>Amend</span>
        </label>
      </div>
      <div
        v-if="showAiOverwriteConfirm"
        class="ai-confirm-bar"
        role="alertdialog"
        aria-live="polite"
      >
        <span class="ai-confirm-text">{{ $t("ai.confirm.overwrite_text") }}</span>
        <button class="ai-confirm-btn primary" @click="runAiGenerate('replace')">
          {{ $t("ai.confirm.replace") }}
        </button>
        <button class="ai-confirm-btn" @click="runAiGenerate('append')">
          {{ $t("ai.confirm.append") }}
        </button>
        <button class="ai-confirm-btn muted" @click="showAiOverwriteConfirm = false">
          {{ $t("ai.confirm.cancel") }}
        </button>
      </div>
      <div class="commit-actions">
        <div ref="aiGroupRef" class="ai-btn-group">
          <button
            class="ai-btn ai-btn-main"
            :class="{ 'ai-btn-cancel': commitStore.isGeneratingAI }"
            :disabled="!commitStore.isGeneratingAI && commitStore.stagedFiles.length === 0"
            :title="
              commitStore.isGeneratingAI
                ? $t('ai.tip_cancel')
                : commitStore.stagedFiles.length === 0
                  ? $t('ai.tip_need_stage')
                  : $t('ai.tip_generate')
            "
            @click="handleAiMainAction"
          >
            <span v-if="commitStore.isGeneratingAI" class="ai-spinner" />
            <span v-else aria-hidden="true">✨</span>
            <span class="ai-btn-text">{{
              commitStore.isGeneratingAI ? $t("ai.cancel_btn") : $t("ai.generate_btn")
            }}</span>
          </button>
          <button
            class="ai-btn ai-btn-chevron"
            :disabled="commitStore.isGeneratingAI"
            :aria-label="$t('ai.tip_more')"
            :title="$t('ai.tip_more')"
            @click="showAiMenu = !showAiMenu"
          >
            ▾
          </button>
          <div v-if="showAiMenu" class="ai-menu" role="menu">
            <button
              :disabled="commitStore.stagedFiles.length === 0 || commitStore.isGeneratingAI"
              @click="handleRegenerateFromMenu"
            >
              {{ $t("ai.menu.regenerate") }}
            </button>
            <button @click="openAiSettings">{{ $t("ai.menu.settings") }}</button>
            <div
              v-if="commitStore.messageHistory.length > 0"
              class="ai-menu-divider"
              aria-hidden="true"
            />
            <div v-if="commitStore.messageHistory.length > 0" class="ai-menu-section">
              {{ $t("ai.menu.history_section") }}
            </div>
            <button
              v-for="(m, idx) in commitStore.messageHistory.slice(0, 5)"
              :key="`mh-${idx}`"
              class="ai-menu-item-history"
              :title="m"
              @click="useHistoryMessage(m)"
            >
              {{ m.split("\n")[0] }}
            </button>
          </div>
        </div>
        <button
          class="commit-btn"
          :disabled="!commitStore.commitMessage.trim() || commitStore.stagedFiles.length === 0"
          @click="handleCommit"
        >
          Commit
        </button>
        <button
          class="commit-btn push"
          :disabled="!commitStore.commitMessage.trim() || commitStore.stagedFiles.length === 0"
          @click="handleCommitAndPush"
        >
          Commit and Push
        </button>
      </div>
      <div v-if="toastVisible" class="ai-toast" role="status">{{ toastMessage }}</div>
    </div>

    <AiSettingsDialog
      :visible="showAiSettings"
      @close="showAiSettings = false"
      @saved="onAiSettingsSaved"
    />

    <PushDialog
      :visible="showPushDialog"
      :repo-path="repoStore.activeRepo?.path ?? ''"
      :repo-name="repoStore.activeRepo?.name"
      @confirm="onPushConfirmed"
      @close="onPushCancelled"
    />
  </div>
</template>

<style scoped>
.commit-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface);
}

.file-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid var(--color-border);
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-foreground-muted);
}

.file-count {
  font-size: 10px;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  padding: 0 6px;
  border-radius: 8px;
  margin-left: 4px;
}

.file-list {
  flex: 1;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 12px;
}

.file-item:hover {
  background: var(--color-surface-hover);
}

.file-item.selected {
  background: var(--color-surface-active);
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-status {
  flex-shrink: 0;
  font-weight: 600;
  font-size: 11px;
  min-width: 14px;
  text-align: center;
}

.status-added {
  color: var(--color-git-added);
}
.status-modified {
  color: var(--color-git-modified);
}
.status-deleted {
  color: var(--color-git-deleted);
}
.status-renamed {
  color: var(--color-git-renamed);
}
.status-untracked {
  color: var(--color-git-untracked);
}
.status-conflicted {
  color: var(--color-error);
}

.empty-hint {
  padding: 12px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 11px;
}

.commit-message-section {
  flex-shrink: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.commit-textarea {
  width: 100%;
  resize: vertical;
  padding: 6px 8px;
  font-size: 12px;
  font-family: var(--font-sans);
  border-radius: 3px;
  min-height: 60px;
}

.commit-options {
  display: flex;
  align-items: center;
  gap: 12px;
}

.amend-checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
  color: var(--color-foreground-muted);
}

.amend-checkbox input {
  margin: 0;
}

.commit-actions {
  display: flex;
  gap: 6px;
}

.commit-btn {
  flex: 1;
  padding: 6px 12px;
  background: var(--color-primary);
  color: white;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 500;
}

.commit-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.commit-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.commit-btn.push {
  background: var(--color-surface-active);
  color: var(--color-foreground);
}

.commit-btn.push:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.ai-btn-group {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}

.ai-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border-radius: 3px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--color-border);
  cursor: pointer;
}

.ai-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.ai-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.ai-btn-main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
}

.ai-btn-chevron {
  padding: 6px 6px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  min-width: 22px;
  font-size: 10px;
  line-height: 1;
  justify-content: center;
}

.ai-btn-text {
  font-size: 12px;
}

.ai-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  min-width: 200px;
  max-width: 320px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  padding: 4px 0;
  z-index: 50;
}

.ai-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: var(--color-foreground);
  font-size: 12px;
  cursor: pointer;
}

.ai-menu button:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.ai-menu button:disabled {
  opacity: 0.5;
  cursor: default;
}

.ai-menu-divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 0;
}

.ai-menu-section {
  padding: 4px 12px;
  font-size: 10px;
  color: var(--color-foreground-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ai-menu-item-history {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-btn-cancel {
  background: var(--color-error, #c0392b);
  color: white;
  border-color: var(--color-error, #c0392b);
}

.ai-btn-cancel:hover {
  opacity: 0.85;
}

.ai-confirm-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-primary);
  border-radius: 3px;
}

.ai-confirm-text {
  flex: 1;
  font-size: 11px;
  color: var(--color-foreground);
}

.ai-confirm-btn {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 3px;
  cursor: pointer;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-foreground);
}

.ai-confirm-btn:hover {
  background: var(--color-surface-hover);
}

.ai-confirm-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.ai-confirm-btn.primary:hover {
  background: var(--color-primary-hover);
}

.ai-confirm-btn.muted {
  color: var(--color-foreground-muted);
}

.ai-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-foreground-muted);
  border-top-color: transparent;
  border-radius: 50%;
  animation: ai-spin 0.8s linear infinite;
}

@keyframes ai-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-toast {
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--color-surface-active);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-primary);
  border-radius: 3px;
  font-size: 11px;
  color: var(--color-foreground);
  word-break: break-all;
}
</style>
