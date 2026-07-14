<script setup lang="ts">
/**
 * 系统设置弹窗 · 集中管理所有应用级配置项
 *
 * 设计要点：
 * - 左侧分类导航（外观 / 编辑器 / 自动刷新 / 抓取 / AI / 关于）
 * - 右侧表单内容，每项设置带说明文字
 * - 所有改动即时生效，无需"保存"按钮（settingsStore 内部 localStorage 持久化）
 * - AI 设置独立弹窗，本弹窗内提供入口按钮
 *
 * 用法：在 StatusBar 用 v-model:visible 控制显示。
 */
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRepoStore } from "@/stores/repoStore";
import { commands } from "@/utils/commands";
import { useRepoChangeEvents } from "@/composables/useRepoWatcher";
import { parseRemoteUrl, type RemoteMeta } from "../../../shared/remote-host";
import type { GitCredentialInfo } from "../../../shared/types";
import GitCredentialDialog from "./GitCredentialDialog.vue";

const AiSettingsDialog = defineAsyncComponent(
  () => import("@/components/commit/AiSettingsDialog.vue")
);

const WorktreeDialog = defineAsyncComponent(
  () => import("@/components/worktree/WorktreeDialog.vue")
);
const CompareBranchesDialog = defineAsyncComponent(
  () => import("@/components/compare/CompareBranchesDialog.vue")
);
const HooksDialog = defineAsyncComponent(() => import("@/components/hooks/HooksDialog.vue"));

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "update:visible", v: boolean): void }>();

const settings = useSettingsStore();
const repoStore = useRepoStore();

type Section =
  | "appearance"
  | "editor"
  | "watcher"
  | "fetch"
  | "worktree"
  | "compare"
  | "hooks"
  | "ai"
  | "integrations"
  | "credentials"
  | "about";

const activeSection = ref<Section>("appearance");
const showAiDialog = ref(false);
const showWorktreeDialog = ref(false);
const showCompareDialog = ref(false);
const showHooksDialog = ref(false);
const remoteMeta = ref<RemoteMeta | null>(null);
const remoteLoading = ref(false);
let remoteLoadSeq = 0;

// Git 凭据管理
const credentials = ref<GitCredentialInfo[]>([]);
const credLoading = ref(false);
const credError = ref("");
const showCredDialog = ref(false);

async function loadCredentials() {
  credLoading.value = true;
  credError.value = "";
  try {
    credentials.value = await commands.listGitCredentials();
  } catch (e) {
    credError.value = e instanceof Error ? e.message : String(e);
  } finally {
    credLoading.value = false;
  }
}

async function deleteCredential(host: string) {
  if (!window.confirm(`确定要清除主机「${host}」的凭据吗？此操作不可撤销。`)) return;
  try {
    await commands.deleteGitCredential(host);
    await loadCredentials();
  } catch (e) {
    credError.value = e instanceof Error ? e.message : String(e);
  }
}

function onCredentialSaved() {
  showCredDialog.value = false;
  void loadCredentials();
}

const sections: { id: Section; label: string; icon: string }[] = [
  { id: "appearance", label: "外观", icon: "🎨" },
  { id: "editor", label: "编辑器", icon: "📝" },
  { id: "watcher", label: "自动刷新", icon: "🔄" },
  { id: "fetch", label: "自动抓取", icon: "📡" },
  { id: "worktree", label: "工作树", icon: "🌳" },
  { id: "compare", label: "分支比较", icon: "🔍" },
  { id: "hooks", label: "Git 钩子", icon: "🪝" },
  { id: "ai", label: "AI", icon: "✨" },
  { id: "integrations", label: "集成", icon: "🔗" },
  { id: "credentials", label: "Git 凭据", icon: "🔑" },
  { id: "about", label: "关于", icon: "ℹ️" },
];

async function loadRemoteMeta() {
  const seq = ++remoteLoadSeq;
  remoteMeta.value = null;
  remoteLoading.value = false;
  if (!repoStore.activeRepo) return;
  const repoPath = repoStore.activeRepo.path;
  remoteLoading.value = true;
  try {
    const remotes = await commands.getRemotes(repoPath);
    if (seq !== remoteLoadSeq || repoStore.activeRepo?.path !== repoPath) return;
    const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
    if (origin?.url) remoteMeta.value = parseRemoteUrl(origin.url);
  } catch (e) {
    console.warn("[settings] getRemotes failed:", e);
  } finally {
    if (seq === remoteLoadSeq) remoteLoading.value = false;
  }
}

watch(
  () => [activeSection.value, repoStore.activeRepo?.path].join("|"),
  () => {
    if (activeSection.value === "integrations") void loadRemoteMeta();
    if (activeSection.value === "credentials") void loadCredentials();
  }
);

useRepoChangeEvents({
  repoPath: () => repoStore.activeRepo?.path,
  kinds: ["config"],
  onEvent: () => {
    if (!props.visible || activeSection.value !== "integrations") return;
    void loadRemoteMeta();
  },
});

function openExternal(url: string) {
  // Electron 主进程 setWindowOpenHandler 会把 http(s) URL 转给 shell.openExternal
  window.open(url, "_blank", "noopener,noreferrer");
}

const fetchIntervalInput = ref(String(settings.autoFetchIntervalMinutes));
watch(
  () => settings.autoFetchIntervalMinutes,
  (v) => {
    fetchIntervalInput.value = String(v);
  }
);

function commitFetchInterval() {
  const n = Number(fetchIntervalInput.value);
  if (!Number.isFinite(n) || n < 1) {
    fetchIntervalInput.value = String(settings.autoFetchIntervalMinutes);
    return;
  }
  settings.setAutoFetchIntervalMinutes(n);
}

function close() {
  emit("update:visible", false);
}

// Esc 关闭弹窗，但任一子弹窗打开时把 Esc 交给子弹窗自己处理，避免父面板被一起关掉。
function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (!props.visible) return;
  if (
    showAiDialog.value ||
    showWorktreeDialog.value ||
    showCompareDialog.value ||
    showHooksDialog.value
  )
    return;
  e.preventDefault();
  close();
}

watch(
  () => props.visible,
  (v) => {
    if (v) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});

const appVersion = computed(() => __APP_VERSION__);
</script>

<template>
  <div v-if="props.visible" class="settings-mask" @click.self="close">
    <div class="settings-dialog" role="dialog" aria-label="系统设置">
      <header class="settings-header">
        <span class="settings-title">系统设置</span>
        <button class="settings-close" @click="close" title="关闭 (Esc)">✕</button>
      </header>

      <div class="settings-body">
        <nav class="settings-nav">
          <button
            v-for="s in sections"
            :key="s.id"
            class="nav-item"
            :class="{ active: activeSection === s.id }"
            @click="activeSection = s.id"
          >
            <span class="nav-icon">{{ s.icon }}</span>
            <span class="nav-label">{{ s.label }}</span>
          </button>
        </nav>

        <section class="settings-content">
          <!-- 外观 -->
          <div v-if="activeSection === 'appearance'" class="section">
            <h3>外观</h3>
            <div class="field">
              <label class="field-label">
                <span>主题</span>
                <select
                  :value="settings.theme"
                  @change="(e: any) => settings.setTheme(e.target.value as 'dark' | 'light')"
                >
                  <option value="dark">深色</option>
                  <option value="light">浅色</option>
                </select>
              </label>
              <p class="field-desc">应用启动时立即生效，下次启动保持。</p>
            </div>
          </div>

          <!-- 编辑器 -->
          <div v-if="activeSection === 'editor'" class="section">
            <h3>编辑器</h3>
            <div class="field">
              <label class="field-label">
                <span>差异显示模式</span>
                <select v-model="settings.diffMode">
                  <option value="side-by-side">左右对比</option>
                  <option value="unified">统一视图</option>
                </select>
              </label>
              <p class="field-desc">影响差异查看器的默认布局。</p>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input type="checkbox" v-model="settings.showCommitDetails" />
                <span>显示提交详情面板</span>
              </label>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input type="checkbox" v-model="settings.showDiffPreview" />
                <span>提交详情面板内显示差异预览</span>
              </label>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input type="checkbox" v-model="settings.compactReferences" />
                <span>分支/标签紧凑模式</span>
              </label>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input type="checkbox" v-model="settings.showTagNames" />
                <span>显示标签名称</span>
              </label>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input type="checkbox" v-model="settings.highlightMyCommits" />
                <span>高亮我的提交</span>
              </label>
              <p class="field-desc">按 git config user.email 匹配。</p>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input type="checkbox" v-model="settings.highlightCurrentBranch" />
                <span>高亮当前分支</span>
              </label>
            </div>
          </div>

          <!-- 自动刷新 -->
          <div v-if="activeSection === 'watcher'" class="section">
            <h3>文件系统监听器</h3>
            <div class="field">
              <label class="field-toggle">
                <input
                  type="checkbox"
                  :checked="settings.autoRefreshOnFsChange"
                  @change="(e: any) => settings.setAutoRefreshOnFsChange(e.target.checked)"
                />
                <span>启用文件系统监听 + 自动刷新</span>
              </label>
              <p class="field-desc">
                外部 IDE / 资源管理器修改文件后，500ms 内自动更新变更、分支和日志。
                超大仓库（10万+ 文件）可关闭以节省 inotify 句柄和内存。
              </p>
            </div>
            <p class="section-tip">
              💡 状态栏右下角的圆环按钮也能切换此开关。
            </p>
          </div>

          <!-- 自动抓取 -->
          <div v-if="activeSection === 'fetch'" class="section">
            <h3>后台抓取</h3>
            <div class="field">
              <label class="field-toggle">
                <input
                  type="checkbox"
                  :checked="settings.autoFetchEnabled"
                  @change="(e: any) => settings.setAutoFetchEnabled(e.target.checked)"
                />
                <span>启用自动抓取</span>
              </label>
              <p class="field-desc">按设定间隔后台抓取远端引用，不会自动合并或拉取。</p>
            </div>
            <div class="field" :class="{ disabled: !settings.autoFetchEnabled }">
              <label class="field-label">
                <span>抓取间隔（分钟）</span>
                <input
                  type="number"
                  min="1"
                  max="120"
                  v-model="fetchIntervalInput"
                  @blur="commitFetchInterval"
                  @keydown.enter="commitFetchInterval"
                  :disabled="!settings.autoFetchEnabled"
                />
              </label>
              <p class="field-desc">1-120 分钟之间，按回车或失焦保存。</p>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input
                  type="checkbox"
                  :checked="settings.fetchOnOpen"
                  @change="(e: any) => settings.setFetchOnOpen(e.target.checked)"
                />
                <span>打开仓库时立即抓取一次</span>
              </label>
            </div>
          </div>

          <!-- 工作树 -->
          <div v-if="activeSection === 'worktree'" class="section">
            <h3>工作树</h3>
            <p>
              管理多工作树（类似 IDEA 的「签出到新工作树」）。
              一个仓库可以有多个工作树同时检出不同分支，互不影响暂存和编辑。
            </p>
            <button
              class="ai-open-btn"
              :disabled="!repoStore.activeRepo"
              @click="showWorktreeDialog = true"
            >
              🌳 打开工作树管理
            </button>
            <p class="field-desc" v-if="!repoStore.activeRepo">需要先打开一个仓库。</p>
            <p class="field-desc" v-else>
              当前仓库：<code>{{ repoStore.activeRepo.path }}</code>
            </p>
          </div>

          <!-- 分支对比 -->
          <div v-if="activeSection === 'compare'" class="section">
            <h3>分支对比</h3>
            <p>
              对比任意两个分支之间的提交范围与文件变更。
              支持 base..target 视角：目标分支上有但基准分支没有的提交。
            </p>
            <button
              class="ai-open-btn"
              :disabled="!repoStore.activeRepo"
              @click="showCompareDialog = true"
            >
              🔍 打开分支对比
            </button>
            <p class="field-desc" v-if="!repoStore.activeRepo">需要先打开一个仓库。</p>
          </div>

          <!-- Git 钩子 -->
          <div v-if="activeSection === 'hooks'" class="section">
            <h3>Git 钩子</h3>
            <p>
              管理当前仓库 <code>.git/hooks</code> 下的钩子脚本：查看状态、启用 / 禁用、
              新建与编辑内容（pre-commit / commit-msg / pre-push 等）。
            </p>
            <button
              class="ai-open-btn"
              :disabled="!repoStore.activeRepo"
              @click="showHooksDialog = true"
            >
              🪝 打开钩子管理
            </button>
            <p class="field-desc" v-if="!repoStore.activeRepo">需要先打开一个仓库。</p>
          </div>

          <!-- 集成 -->
          <div v-if="activeSection === 'integrations'" class="section">
            <h3>外部集成</h3>
            <p>
              根据当前仓库的 origin 远端自动识别平台（GitHub / GitLab / Bitbucket / Gitea），
              在系统浏览器打开对应页面。完整 PR / Issue 内嵌面板暂未实现（后续会补）。
            </p>
            <div v-if="!repoStore.activeRepo" class="field-desc">需要先打开一个仓库。</div>
            <div v-else-if="remoteLoading" class="field-desc">读取远端中…</div>
            <div v-else-if="!remoteMeta" class="field-desc">
              未检测到可识别的 origin 远端（仓库无远端，或 URL 格式无法解析）。
            </div>
            <div v-else class="integrations-block">
              <div class="about-row">
                <span>平台</span>
                <span>{{ remoteMeta.host }} · {{ remoteMeta.domain }}</span>
              </div>
              <div class="about-row">
                <span>仓库</span>
                <span>{{ remoteMeta.owner }} / {{ remoteMeta.repo }}</span>
              </div>
              <div class="integrations-actions">
                <button class="ai-open-btn" @click="openExternal(remoteMeta.pullRequestsUrl)">
                  🔗 打开 PR / MR 列表
                </button>
                <button class="ai-open-btn" @click="openExternal(remoteMeta.issuesUrl)">
                  🐛 打开 Issue 列表
                </button>
                <button class="ai-open-btn" @click="openExternal(remoteMeta.homeUrl)">
                  🏠 打开仓库主页
                </button>
              </div>
            </div>
          </div>

          <!-- Git 凭据 -->
          <div v-if="activeSection === 'credentials'" class="section">
            <h3>Git 凭据（HTTPS）</h3>
            <p>
              按主机缓存 HTTPS 用户名 + 密码 / 访问令牌，供推送、拉取、抓取和克隆透明鉴权。
              Electron 下经 safeStorage 加密保存；列表只显示用户名，<strong>绝不回显令牌</strong>。
              也可在联网鉴权失败时由弹窗自动引导登录。
            </p>
            <div class="cred-actions">
              <button class="ai-open-btn" @click="showCredDialog = true">➕ 添加凭据</button>
              <button class="ai-open-btn" :disabled="credLoading" @click="loadCredentials">
                ↻ 刷新
              </button>
            </div>
            <div v-if="credError" class="field-desc cred-err">{{ credError }}</div>
            <div v-if="credLoading" class="field-desc">读取凭据中…</div>
            <div v-else-if="credentials.length === 0" class="field-desc">
              尚未保存任何凭据。
            </div>
            <div v-else class="cred-list">
              <div v-for="c in credentials" :key="c.host" class="cred-item">
                <div class="cred-item-info">
                  <span class="cred-item-host">{{ c.host }}</span>
                  <span class="cred-item-user">{{ c.username || "(无用户名)" }}</span>
                  <span class="cred-item-badge" :class="{ ok: c.hasToken }">
                    {{ c.hasToken ? "已配置令牌" : "无令牌" }}
                  </span>
                </div>
                <button class="cred-del-btn" @click="deleteCredential(c.host)">清除</button>
              </div>
            </div>
          </div>

          <!-- AI -->
          <div v-if="activeSection === 'ai'" class="section">
            <h3>AI 设置</h3>
            <p>
              AI 提交信息生成 / 日报润色的连接配置（基础 URL / API 密钥 / 模型）
              在独立的 AI 设置弹窗里管理，避免敏感信息混在普通设置面板里。
            </p>
            <button class="ai-open-btn" @click="showAiDialog = true">
              ✨ 打开 AI 设置弹窗
            </button>
            <p class="field-desc">
              支持 OpenAI / DeepSeek / 通义千问 / 智谱 / Moonshot / Ollama 等任意 OpenAI 兼容协议。
            </p>
          </div>

          <!-- 关于 -->
          <div v-if="activeSection === 'about'" class="section">
            <h3>关于</h3>
            <div class="about-block">
              <div class="about-row"><span>应用</span><span>Git Manager</span></div>
              <div class="about-row"><span>版本</span><span>{{ appVersion }}</span></div>
              <div class="about-row">
                <span>仓库</span>
                <a href="https://github.com/movebrickschi/git-manager" target="_blank" rel="noopener">
                  github.com/movebrickschi/git-manager
                </a>
              </div>
              <div class="about-row"><span>引擎</span><span>Electron + Vue 3 + Vite</span></div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <AiSettingsDialog
      v-if="showAiDialog"
      :visible="showAiDialog"
      @close="showAiDialog = false"
      @saved="showAiDialog = false"
    />

    <WorktreeDialog
      v-if="showWorktreeDialog && repoStore.activeRepo"
      :visible="showWorktreeDialog"
      :repo-path="repoStore.activeRepo.path"
      @update:visible="(v: boolean) => (showWorktreeDialog = v)"
    />

    <CompareBranchesDialog
      v-if="showCompareDialog && repoStore.activeRepo"
      :visible="showCompareDialog"
      :repo-path="repoStore.activeRepo.path"
      @update:visible="(v: boolean) => (showCompareDialog = v)"
    />

    <HooksDialog
      v-if="showHooksDialog && repoStore.activeRepo"
      :visible="showHooksDialog"
      :repo-path="repoStore.activeRepo.path"
      @update:visible="(v: boolean) => (showHooksDialog = v)"
    />

    <GitCredentialDialog
      :visible="showCredDialog"
      hint="新增 / 更新某主机的 HTTPS 凭据；保存后用于联网 Git 透明鉴权。"
      @saved="onCredentialSaved"
      @close="showCredDialog = false"
    />
  </div>
</template>

<style scoped>
.settings-mask {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 比 AiSettingsDialog 的 z-index: 9000 略低；
     AI 子弹窗本身用 fixed + 9000 会自然盖在系统设置之上。 */
  z-index: 8500;
}

.settings-dialog {
  background: var(--color-surface-raised);
  color: var(--color-foreground);
  width: min(960px, 92vw);
  height: min(620px, 86vh);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border-strong);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--color-divider);
  background: var(--color-surface-emphasis);
}

.settings-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-foreground-bright);
}

.settings-close {
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-size: 16px;
  min-width: 26px;
  min-height: 26px;
  padding: 2px 6px;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast, 100ms ease);
}

.settings-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.settings-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.settings-nav {
  width: 180px;
  padding: 8px 6px;
  border-right: 1px solid var(--color-divider);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  background: var(--color-surface-muted);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--control-height-regular);
  padding: 5px 10px;
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  color: var(--color-foreground);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background var(--transition-fast, 100ms ease);
}

.nav-item:hover {
  background: var(--color-surface-hover);
}

.nav-item.active {
  background: color-mix(in srgb, var(--color-primary) 13%, var(--color-surface-muted));
  color: var(--color-primary);
  box-shadow: inset 2px 0 0 var(--color-primary);
}

.nav-icon {
  font-size: 14px;
}

.settings-content {
  flex: 1;
  padding: 16px 20px;
  overflow-y: auto;
  background: var(--color-surface-raised);
}

.section h3 {
  margin: 0 0 14px;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-foreground-bright);
}

.field {
  margin-bottom: 14px;
}

.field.disabled {
  opacity: 0.55;
  pointer-events: none;
}

.field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-size: 13px;
  color: var(--color-foreground);
}

.field-label > span:first-child {
  flex: 1;
}

.field-label select,
.field-label input[type="number"] {
  min-height: var(--control-height-regular);
  background: var(--color-surface-emphasis);
  color: var(--color-foreground);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  padding: 4px 8px;
  font-size: 13px;
  min-width: 160px;
  font-family: inherit;
}

.field-label select:focus,
.field-label input[type="number"]:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: var(--focus-ring);
}

.field-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-foreground);
}

.field-toggle input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--color-primary);
}

.field-desc {
  margin: 6px 0 0 0;
  font-size: 12px;
  color: var(--color-foreground-muted);
  line-height: 1.5;
}

.section-tip {
  margin-top: 12px;
  font-size: 12px;
  color: var(--color-foreground-muted);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface-emphasis));
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border-left: 3px solid var(--color-primary);
}

.ai-open-btn {
  margin-top: 10px;
  min-height: var(--control-height-regular);
  padding: 4px 14px;
  font-size: 12px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast, 100ms ease);
}

.ai-open-btn:hover {
  background: var(--color-primary-hover);
}

.about-block {
  background: var(--color-surface-emphasis);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: var(--color-foreground);
}

.about-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.about-row > span:first-child {
  color: var(--color-foreground-muted);
  min-width: 80px;
}

.integrations-block {
  margin-top: 12px;
  background: var(--color-surface-emphasis);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.integrations-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.integrations-actions .ai-open-btn {
  flex: 1 1 200px;
  margin-top: 0;
}

.about-row a {
  color: var(--color-primary);
  text-decoration: none;
}

.about-row a:hover {
  text-decoration: underline;
}

/* Git 凭据 */
.cred-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0;
}

.cred-err {
  color: var(--color-error, #e05252);
}

.cred-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.cred-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-md);
  background: var(--color-surface-emphasis);
}

.cred-item-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}

.cred-item-host {
  font-weight: 600;
  font-size: 13px;
  color: var(--color-foreground);
}

.cred-item-user {
  font-size: 12px;
  color: var(--color-foreground-muted);
}

.cred-item-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-foreground-muted) 20%, transparent);
  color: var(--color-foreground-muted);
}

.cred-item-badge.ok {
  background: color-mix(in srgb, #4caf50 18%, transparent);
  color: #4caf50;
}

.cred-del-btn {
  flex-shrink: 0;
  min-height: var(--control-height-compact);
  padding: 3px 12px;
  font-size: 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  background: var(--color-surface-raised);
  color: var(--color-error, #e05252);
  border: 1px solid color-mix(in srgb, var(--color-error, #e05252) 40%, var(--color-border));
}

.cred-del-btn:hover {
  background: color-mix(in srgb, var(--color-error, #e05252) 12%, transparent);
}
</style>
