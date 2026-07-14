<script setup lang="ts">
import { ref, watch } from "vue";
import { commands } from "@/utils/commands";

/**
 * 应用内 Git HTTPS 凭据登录对话框。
 *
 * 触发：联网操作（push/pull/fetch/clone）鉴权失败时由调用方打开（反应式）；也可在
 * 设置「Git 凭据」里主动新增。保存即 safeStorage 加密落盘（Electron）/ 明文（Web）。
 * 安全：令牌输入框**绝不预填**已存值；保存成功后清空本地令牌，不在内存久留。
 */
const props = defineProps<{
  visible: boolean;
  /** 预填主机（如从当前远端解析出的 github.com）。 */
  host?: string;
  /** 预填用户名（已有缓存时）。 */
  username?: string;
  /** 顶部提示语，例如「鉴权失败，请输入账号 / 令牌后重试」。 */
  hint?: string;
}>();

const emit = defineEmits<{
  close: [];
  /** 保存成功；payload 为归一化前的 host / username，供调用方重试联网操作。 */
  saved: [payload: { host: string; username: string }];
}>();

const hostInput = ref("");
const usernameInput = ref("");
const token = ref("");
const showToken = ref(false);
const saving = ref(false);
const error = ref("");

watch(
  () => props.visible,
  (v) => {
    if (v) {
      hostInput.value = props.host ?? "";
      usernameInput.value = props.username ?? "";
      token.value = ""; // 绝不预填令牌
      showToken.value = false;
      error.value = "";
      saving.value = false;
    }
  },
  { immediate: true }
);

async function handleSave() {
  error.value = "";
  const h = hostInput.value.trim();
  if (!h) {
    error.value = "请填写主机，例如 github.com";
    return;
  }
  if (!token.value) {
    error.value = "请填写密码 / 访问令牌";
    return;
  }
  saving.value = true;
  try {
    await commands.saveGitCredential(h, usernameInput.value.trim(), token.value);
    const payload = { host: h, username: usernameInput.value.trim() };
    token.value = "";
    emit("saved", payload);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}

function handleClose() {
  emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !saving.value) {
    e.preventDefault();
    handleSave();
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="cred-overlay" @click.self="handleClose">
      <div class="cred-dialog" @keydown="onKeydown">
        <div class="cred-header">
          <span class="cred-title">Git 登录（HTTPS）</span>
          <button class="cred-close" @click="handleClose">✕</button>
        </div>

        <div class="cred-body">
          <p v-if="hint" class="cred-hint">{{ hint }}</p>
          <p class="cred-desc">
            私有仓库的推送、拉取、抓取和克隆需要 HTTPS 凭据。建议使用
            <strong>个人访问令牌（PAT）</strong> 而非账户密码。令牌仅加密保存在本机，绝不回显。
          </p>

          <label class="cred-field">
            <span class="cred-label">主机</span>
            <input
              v-model="hostInput"
              class="cred-input"
              type="text"
              placeholder="github.com"
              spellcheck="false"
              autocomplete="off"
            />
          </label>

          <label class="cred-field">
            <span class="cred-label">用户名</span>
            <input
              v-model="usernameInput"
              class="cred-input"
              type="text"
              placeholder="你的用户名（GitHub 可填任意非空值）"
              spellcheck="false"
              autocomplete="off"
            />
          </label>

          <label class="cred-field">
            <span class="cred-label">密码 / 令牌</span>
            <div class="cred-token-row">
              <input
                v-model="token"
                class="cred-input"
                :type="showToken ? 'text' : 'password'"
                placeholder="粘贴个人访问令牌"
                spellcheck="false"
                autocomplete="off"
              />
              <button
                type="button"
                class="cred-eye"
                :title="showToken ? '隐藏' : '显示'"
                @click="showToken = !showToken"
              >
                {{ showToken ? "🙈" : "👁" }}
              </button>
            </div>
          </label>

          <div v-if="error" class="cred-error">{{ error }}</div>
        </div>

        <div class="cred-footer">
          <button class="cred-btn" @click="handleClose">取消</button>
          <button class="cred-btn primary" :disabled="saving" @click="handleSave">
            {{ saving ? "保存中…" : "保存并重试" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cred-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9300;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cred-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  width: 440px;
  max-width: 95vw;
}

.cred-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--color-surface-emphasis);
}

.cred-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-foreground);
}

.cred-close {
  background: none;
  border: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
  line-height: 1;
}

.cred-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.cred-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cred-hint {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  border-radius: 4px;
  color: var(--color-error, #e05252);
  background: color-mix(in srgb, var(--color-error, #e05252) 12%, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-error, #e05252) 30%, transparent);
}

.cred-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-foreground-muted);
}

.cred-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cred-label {
  font-size: 12px;
  color: var(--color-foreground);
  font-weight: 500;
}

.cred-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  color: var(--color-foreground);
}

.cred-input:focus {
  outline: none;
  border-color: var(--color-primary, #4a9eff);
}

.cred-token-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
}

.cred-token-row .cred-input {
  flex: 1;
}

.cred-eye {
  flex-shrink: 0;
  width: 34px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface-active);
  cursor: pointer;
  font-size: 13px;
}

.cred-eye:hover {
  background: var(--color-surface-hover);
}

.cred-error {
  font-size: 12px;
  color: var(--color-error, #e05252);
}

.cred-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
}

.cred-btn {
  padding: 5px 16px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-surface-active);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
}

.cred-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.cred-btn.primary {
  background: var(--color-primary, #4a9eff);
  color: white;
  border-color: var(--color-primary, #4a9eff);
}

.cred-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.cred-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
