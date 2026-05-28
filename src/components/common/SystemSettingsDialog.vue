<script setup lang="ts">
/**
 * 系统设置弹窗 · 集中管理所有应用级配置项
 *
 * 设计要点：
 * - 左侧分类导航（外观 / 编辑器 / 自动刷新 / Fetch / AI / 关于）
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
import { parseRemoteUrl, type RemoteMeta } from "../../../shared/remote-host";

const AiSettingsDialog = defineAsyncComponent(
  () => import("@/components/commit/AiSettingsDialog.vue")
);

const WorktreeDialog = defineAsyncComponent(
  () => import("@/components/worktree/WorktreeDialog.vue")
);
const CompareBranchesDialog = defineAsyncComponent(
  () => import("@/components/compare/CompareBranchesDialog.vue")
);

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
  | "ai"
  | "integrations"
  | "about";

const activeSection = ref<Section>("appearance");
const showAiDialog = ref(false);
const showWorktreeDialog = ref(false);
const showCompareDialog = ref(false);
const remoteMeta = ref<RemoteMeta | null>(null);
const remoteLoading = ref(false);

const sections: { id: Section; label: string; icon: string }[] = [
  { id: "appearance", label: "外观", icon: "🎨" },
  { id: "editor", label: "编辑器", icon: "📝" },
  { id: "watcher", label: "自动刷新", icon: "🔄" },
  { id: "fetch", label: "Auto-fetch", icon: "📡" },
  { id: "worktree", label: "Worktree", icon: "🌳" },
  { id: "compare", label: "Compare Branches", icon: "🔍" },
  { id: "ai", label: "AI", icon: "✨" },
  { id: "integrations", label: "集成", icon: "🔗" },
  { id: "about", label: "关于", icon: "ℹ️" },
];

async function loadRemoteMeta() {
  remoteMeta.value = null;
  if (!repoStore.activeRepo) return;
  remoteLoading.value = true;
  try {
    const remotes = await commands.getRemotes(repoStore.activeRepo.path);
    const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
    if (origin?.url) remoteMeta.value = parseRemoteUrl(origin.url);
  } catch (e) {
    console.warn("[settings] getRemotes failed:", e);
  } finally {
    remoteLoading.value = false;
  }
}

watch(
  () => [activeSection.value, repoStore.activeRepo?.path].join("|"),
  () => {
    if (activeSection.value === "integrations") void loadRemoteMeta();
  }
);

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

// Esc 关闭弹窗，但只在系统设置弹窗本身可见且 AI 子弹窗未打开时生效
function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (!props.visible) return;
  if (showAiDialog.value) return; // 让 AI 子弹窗自己处理 Esc
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

const appVersion = computed(() => "0.2.0-dev"); // TODO: 接入 package.json
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
                  <option value="dark">深色（dark）</option>
                  <option value="light">浅色（light）</option>
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
                <span>Diff 显示模式</span>
                <select v-model="settings.diffMode">
                  <option value="side-by-side">Side-by-Side（左右两屏）</option>
                  <option value="unified">Unified（统一视图）</option>
                </select>
              </label>
              <p class="field-desc">影响 DiffViewer 默认布局。</p>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input type="checkbox" v-model="settings.showCommitDetails" />
                <span>显示 commit 详情面板</span>
              </label>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input type="checkbox" v-model="settings.showDiffPreview" />
                <span>commit 详情面板内显示 diff 预览</span>
              </label>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input type="checkbox" v-model="settings.compactReferences" />
                <span>分支/Tag 标签紧凑模式</span>
              </label>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input type="checkbox" v-model="settings.showTagNames" />
                <span>显示 Tag 名称</span>
              </label>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input type="checkbox" v-model="settings.highlightMyCommits" />
                <span>高亮我的 commit</span>
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

          <!-- 自动刷新（watcher） -->
          <div v-if="activeSection === 'watcher'" class="section">
            <h3>文件系统 watcher</h3>
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
                外部 IDE / 资源管理器修改文件后，500ms 内自动更新 Changes / Branches / Log。
                超大仓库（10万+ 文件）可关闭以节省 inotify 句柄和内存。
              </p>
            </div>
            <p class="section-tip">
              💡 状态栏右下角的圆环按钮也能切换此开关。
            </p>
          </div>

          <!-- Auto-fetch -->
          <div v-if="activeSection === 'fetch'" class="section">
            <h3>后台 Fetch</h3>
            <div class="field">
              <label class="field-toggle">
                <input
                  type="checkbox"
                  :checked="settings.autoFetchEnabled"
                  @change="(e: any) => settings.setAutoFetchEnabled(e.target.checked)"
                />
                <span>启用 Auto-fetch</span>
              </label>
              <p class="field-desc">按设定间隔后台拉取远端引用，不会自动 merge/pull。</p>
            </div>
            <div class="field" :class="{ disabled: !settings.autoFetchEnabled }">
              <label class="field-label">
                <span>Fetch 间隔（分钟）</span>
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
              <p class="field-desc">1-120 分钟之间，按 Enter 或失焦保存。</p>
            </div>
            <div class="field">
              <label class="field-toggle">
                <input
                  type="checkbox"
                  :checked="settings.fetchOnOpen"
                  @change="(e: any) => settings.setFetchOnOpen(e.target.checked)"
                />
                <span>打开仓库时立即 fetch 一次</span>
              </label>
            </div>
          </div>

          <!-- Worktree -->
          <div v-if="activeSection === 'worktree'" class="section">
            <h3>Git Worktree</h3>
            <p>
              管理多工作树（IDEA "Checkout in New Worktree" 同款）。
              一个仓库可以有多个工作树同时检出不同分支，互不影响 staging / 编辑。
            </p>
            <button
              class="ai-open-btn"
              :disabled="!repoStore.activeRepo"
              @click="showWorktreeDialog = true"
            >
              🌳 打开 Worktree 管理
            </button>
            <p class="field-desc" v-if="!repoStore.activeRepo">需要先打开一个仓库。</p>
            <p class="field-desc" v-else>
              当前仓库：<code>{{ repoStore.activeRepo.path }}</code>
            </p>
          </div>

          <!-- Compare Branches -->
          <div v-if="activeSection === 'compare'" class="section">
            <h3>Compare Branches</h3>
            <p>
              对比任意两个分支之间的 commit 范围与文件变更（IDEA "Compare with Branch" 同款）。
              支持 base..target 视角：target 上有但 base 没有的 commit。
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

          <!-- 集成 -->
          <div v-if="activeSection === 'integrations'" class="section">
            <h3>外部集成</h3>
            <p>
              根据当前仓库的 origin remote 自动识别平台（GitHub / GitLab / Bitbucket / Gitea），
              在系统浏览器打开对应页面。完整 PR / Issue 内嵌面板暂未实现（后续会补）。
            </p>
            <div v-if="!repoStore.activeRepo" class="field-desc">需要先打开一个仓库。</div>
            <div v-else-if="remoteLoading" class="field-desc">读取 remote 中…</div>
            <div v-else-if="!remoteMeta" class="field-desc">
              未检测到可识别的 origin remote（仓库无 remote，或 url 格式无法解析）。
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

          <!-- AI -->
          <div v-if="activeSection === 'ai'" class="section">
            <h3>AI 设置</h3>
            <p>
              AI commit message 生成 / 日报润色 的连接配置（baseUrl / apiKey / model）
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
  </div>
</template>

<style scoped>
.settings-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 比 AiSettingsDialog 的 z-index: 9000 略低；
     AI 子弹窗本身用 fixed + 9000 会自然盖在系统设置之上。 */
  z-index: 8500;
}

.settings-dialog {
  background: var(--color-surface);
  color: var(--color-foreground);
  width: min(960px, 92vw);
  height: min(620px, 86vh);
  border-radius: var(--radius-lg, 10px);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
}

.settings-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-foreground-bright);
}

.settings-close {
  background: transparent;
  border: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
  border-radius: var(--radius-sm, 4px);
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
  padding: 12px 8px;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  background: var(--color-background);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-md, 6px);
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
  background: var(--color-surface-active);
  color: var(--color-foreground-bright);
}

.nav-icon {
  font-size: 14px;
}

.settings-content {
  flex: 1;
  padding: 18px 24px;
  overflow-y: auto;
  background: var(--color-surface);
}

.section h3 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-foreground-bright);
}

.field {
  margin-bottom: 18px;
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
  background: var(--color-background);
  color: var(--color-foreground);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm, 4px);
  padding: 4px 8px;
  font-size: 13px;
  min-width: 160px;
  font-family: inherit;
}

.field-label select:focus,
.field-label input[type="number"]:focus {
  outline: none;
  border-color: var(--color-primary);
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
  background: var(--color-surface-active);
  padding: 8px 12px;
  border-radius: var(--radius-sm, 4px);
  border-left: 3px solid var(--color-primary);
}

.ai-open-btn {
  margin-top: 10px;
  padding: 8px 16px;
  font-size: 13px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--radius-md, 6px);
  cursor: pointer;
  transition: background var(--transition-fast, 100ms ease);
}

.ai-open-btn:hover {
  background: var(--color-primary-hover);
}

.about-block {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 6px);
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
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 6px);
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
</style>
