<script setup lang="ts">
import { ref, watch, computed, defineAsyncComponent } from "vue";
import { commands } from "@/utils/commands";
import { translateGitError } from "@/utils/git-error";
import { useBranchStore } from "@/stores/branchStore";
import type { CommitInfo, FileStatus, PushOptions } from "@/utils/commands";
import { formatTimestamp } from "@/utils/format";
import { isAuthError } from "../../../shared/git/auth-error";
import { resolveHost } from "../../../shared/git/host";
import { useRepoChangeEvents } from "@/composables/useRepoWatcher";
import DivergenceDialog from "./DivergenceDialog.vue";
import GitCredentialDialog from "./GitCredentialDialog.vue";

const ThreeWayMerge = defineAsyncComponent(() => import("@/components/merge/ThreeWayMerge.vue"));

const props = defineProps<{
  visible: boolean;
  repoPath: string;
  repoName?: string;
  remote?: string;
  branch?: string;
  targetBranch?: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
  busy: [value: boolean];
}>();

const branchStore = useBranchStore();

const loading = ref(false);
const pushing = ref(false);
const commits = ref<CommitInfo[]>([]);
const selectedCommit = ref<CommitInfo | null>(null);
const commitFiles = ref<FileStatus[]>([]);
const filesLoading = ref(false);

// Push options
const optForceWithLease = ref(false);
const optForce = ref(false);
const optSetUpstream = ref(false);
const optPushTags = ref(false);

// Divergence state
const showDivergence = ref(false);
const divergenceBehind = ref(0);
const divergenceAhead = ref(0);

// Error display
const pushError = ref("");

// Git 凭据登录（联网鉴权失败时反应式弹出，保存后自动重试）
const showCredentialDialog = ref(false);
const credHost = ref("");
const credUsername = ref("");
let pendingAuthRetry: (() => Promise<void>) | null = null;
let commitsLoadSeq = 0;
let filesLoadSeq = 0;

// Conflict resolution state
const showConflictResolver = ref(false);
const conflictFiles = ref<string[]>([]);
const conflictFirstFile = ref("");
const pendingPushAfterResolve = ref(false);

// force 与 force-with-lease 互斥
watch(optForce, (v) => {
  if (v) optForceWithLease.value = false;
});
watch(optForceWithLease, (v) => {
  if (v) optForce.value = false;
});

// 推送进行中状态回传父组件，用于在对应分支条目显示 spinner
watch(pushing, (v) => emit("busy", v));

const headBranch = computed(() => branchStore.localBranches.find((b) => b.isHead) ?? null);
const upstreamTarget = computed(() => {
  const upstream = headBranch.value?.upstream;
  const slash = upstream?.indexOf("/") ?? -1;
  if (!upstream || slash <= 0 || slash === upstream.length - 1) return null;
  return {
    remote: upstream.slice(0, slash),
    branch: upstream.slice(slash + 1),
  };
});
const remoteName = computed(() => props.remote ?? upstreamTarget.value?.remote ?? "origin");
const branchName = computed(() => props.branch ?? props.targetBranch ?? headBranch.value?.name ?? "");
const remoteBranchName = computed(
  () => props.branch ?? props.targetBranch ?? upstreamTarget.value?.branch ?? branchName.value
);
const destination = computed(() =>
  remoteBranchName.value ? `${remoteName.value}/${remoteBranchName.value}` : remoteName.value
);
const repoLabel = computed(
  () => props.repoName ?? props.repoPath.split(/[\\/]/).pop() ?? props.repoPath
);

async function loadCommits(preserveSelection = false) {
  if (!props.repoPath) return;
  const repoPath = props.repoPath;
  const selectedId = preserveSelection ? selectedCommit.value?.id : undefined;
  const seq = ++commitsLoadSeq;
  filesLoadSeq += 1;
  filesLoading.value = false;
  loading.value = true;
  if (!preserveSelection) {
    commits.value = [];
    selectedCommit.value = null;
    commitFiles.value = [];
  }
  try {
    const next = await commands.getUnpushedCommits(repoPath, props.remote, props.branch);
    if (seq !== commitsLoadSeq || props.repoPath !== repoPath || !props.visible) return;
    commits.value = next;
    const nextSelected = next.find((commit) => commit.id === selectedId) ?? next[0] ?? null;
    if (nextSelected) {
      await selectCommit(nextSelected);
    } else {
      selectedCommit.value = null;
      commitFiles.value = [];
      filesLoading.value = false;
    }
  } finally {
    if (seq === commitsLoadSeq && props.repoPath === repoPath) loading.value = false;
  }
}

async function selectCommit(commit: CommitInfo) {
  const repoPath = props.repoPath;
  const seq = ++filesLoadSeq;
  selectedCommit.value = commit;
  filesLoading.value = true;
  try {
    const files = await commands.getCommitFiles(repoPath, commit.id);
    if (seq === filesLoadSeq && props.repoPath === repoPath) commitFiles.value = files;
  } catch {
    if (seq === filesLoadSeq && props.repoPath === repoPath) commitFiles.value = [];
  } finally {
    if (seq === filesLoadSeq && props.repoPath === repoPath) filesLoading.value = false;
  }
}

async function doPush() {
  const options: PushOptions = {};
  if (optForceWithLease.value) options.forceWithLease = true;
  if (optForce.value) options.force = true;
  if (optSetUpstream.value) options.setUpstream = true;
  if (optPushTags.value) options.pushTags = true;

  pushing.value = true;
  pushError.value = "";
  try {
    await commands.push(
      props.repoPath,
      remoteName.value,
      branchName.value || undefined,
      Object.keys(options).length > 0 ? options : undefined
    );
    emit("confirm");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    pushing.value = false;
    if (await maybePromptCredential(msg, doPush)) return;
    pushError.value = isCancelled(msg) ? "" : translateGitError(msg);
    return;
  } finally {
    pushing.value = false;
  }
}

/** 中止正在进行的联网命令（push/pull/fetch）——请求后端杀掉对应 git 子进程。 */
async function cancelInflight() {
  try {
    await commands.cancelNetworkOps(props.repoPath);
  } catch {
    /* 取消本身失败无需再打扰用户 */
  }
}

/** 用户主动取消导致的错误（信息含「已取消/cancel」）不当作红色错误条展示。 */
function isCancelled(msg: string): boolean {
  return /已取消|cancel/i.test(msg);
}

function pushErrText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return isCancelled(msg) ? "" : translateGitError(msg);
}

/** 解析当前远端 HTTPS 主机键，用于预填登录对话框；SSH / 无 remote → ""。 */
async function resolveRepoHostFrontend(): Promise<string> {
  try {
    const remotes = await commands.getRemotes(props.repoPath);
    const origin =
      remotes.find((r) => r.name === remoteName.value) ??
      remotes.find((r) => r.name === "origin") ??
      remotes[0];
    return resolveHost(origin?.url || origin?.fetchUrl || "") ?? "";
  } catch {
    return "";
  }
}

/**
 * 若错误信息是鉴权失败，弹 Git 登录对话框并暂存「保存后重试」动作，返回 true（调用方应 return，
 * 不再以红条展示原始错误）；否则返回 false。
 */
async function maybePromptCredential(msg: string, retry: () => Promise<void>): Promise<boolean> {
  if (!isAuthError(msg)) return false;
  const host = await resolveRepoHostFrontend();
  // SSH / 无法解析 host：走密钥体系，应用内 HTTPS 凭据帮不上忙，按普通错误展示。
  if (!host) return false;
  let username = "";
  try {
    const list = await commands.listGitCredentials();
    username = list.find((c) => c.host === host)?.username ?? "";
  } catch {
    /* 列表失败不阻断登录 */
  }
  credHost.value = host;
  credUsername.value = username;
  pendingAuthRetry = retry;
  showCredentialDialog.value = true;
  return true;
}

async function onCredentialSaved() {
  showCredentialDialog.value = false;
  const retry = pendingAuthRetry;
  pendingAuthRetry = null;
  if (retry) await retry();
}

function onCredentialClose() {
  showCredentialDialog.value = false;
  pendingAuthRetry = null;
}

async function handlePush() {
  pushError.value = "";
  pushing.value = true;
  try {
    await branchStore.loadBranches();
  } catch {
    // 分支刷新失败不阻断推送；后续 fetch / push 会给出更具体的错误。
  }
  if (optForce.value) {
    const ok = window.confirm(
      `⚠ 你勾选了 --force（强制推送）。\n\n` +
        `这会**强行覆盖远端历史**，如果其他协作者已经基于旧引用提交，\n` +
        `他们的工作可能会被你覆盖、不可撤销。\n\n` +
        `推荐改用 --force-with-lease（远端被他人改动时会安全失败）。\n\n` +
        `仍要使用 --force 推送 ${branchName.value || "(当前分支)"} 到 ${remoteName.value} ？`
    );
    if (!ok) {
      pushing.value = false;
      return;
    }
    await doPush();
    return;
  }

  if (optForceWithLease.value) {
    await doPush();
    return;
  }

  pushing.value = true;
  try {
    await commands.fetch(props.repoPath, remoteName.value);
    const branch = remoteBranchName.value;
    if (!branch) {
      pushing.value = false;
      await doPush();
      return;
    }
    const { ahead, behind } = await commands.getBehindCount(
      props.repoPath,
      remoteName.value,
      branch
    );

    if (behind > 0) {
      divergenceAhead.value = ahead;
      divergenceBehind.value = behind;
      pushing.value = false;
      showDivergence.value = true;
      return;
    }

    pushing.value = false;
    await doPush();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    pushing.value = false;
    if (await maybePromptCredential(msg, handlePush)) return;
    pushError.value = isCancelled(msg) ? "" : translateGitError(msg);
  }
}

async function handleDivergenceRebase() {
  showDivergence.value = false;
  pushing.value = true;
  pushError.value = "";
  try {
    const result = await branchStore.smartPullCurrentBranch({
      repoPath: props.repoPath,
      remote: remoteName.value,
      rebase: true,
    });
    if (result === null) {
      pushing.value = false;
      return;
    }
    if (result.conflicts && result.conflicts.length > 0) {
      pushing.value = false;
      openConflictResolver(result.conflicts);
      return;
    }
    if (!result.success) {
      pushing.value = false;
      if (await maybePromptCredential(result.message, handleDivergenceRebase)) return;
      pushError.value = isCancelled(result.message)
        ? ""
        : result.message
          ? translateGitError(result.message)
          : "拉取失败";
      return;
    }
    pushing.value = false;
    await doPush();
  } catch (e: unknown) {
    pushing.value = false;
    pushError.value = pushErrText(e);
  }
}

async function handleDivergenceMerge() {
  showDivergence.value = false;
  pushing.value = true;
  pushError.value = "";
  try {
    const result = await branchStore.smartPullCurrentBranch({
      repoPath: props.repoPath,
      remote: remoteName.value,
      rebase: false,
    });
    if (result === null) {
      pushing.value = false;
      return;
    }
    if (result.conflicts && result.conflicts.length > 0) {
      pushing.value = false;
      openConflictResolver(result.conflicts);
      return;
    }
    if (!result.success) {
      pushing.value = false;
      if (await maybePromptCredential(result.message, handleDivergenceMerge)) return;
      pushError.value = isCancelled(result.message)
        ? ""
        : result.message
          ? translateGitError(result.message)
          : "拉取失败";
      return;
    }
    pushing.value = false;
    await doPush();
  } catch (e: unknown) {
    pushing.value = false;
    pushError.value = pushErrText(e);
  }
}

async function handleDivergenceForce() {
  showDivergence.value = false;
  optForceWithLease.value = true;
  await doPush();
}

function handleDivergenceCancel() {
  showDivergence.value = false;
}

function openConflictResolver(files: string[]) {
  if (files.length === 0) return;
  conflictFiles.value = files;
  conflictFirstFile.value = files[0]!;
  pendingPushAfterResolve.value = true;
  showConflictResolver.value = true;
}

async function onConflictResolved() {
  showConflictResolver.value = false;
  if (!pendingPushAfterResolve.value) return;
  pushing.value = true;
  pushError.value = "";
  try {
    const mergeState = await commands.getMergeState(props.repoPath);
    if (mergeState.state !== "none") {
      // continueOperation 不会抛错——它按 git 状态机返回 MergeResult。
      // 旧实现忽略返回值直接 doPush，会在「continue 后仍有下一批冲突 / 停在 edit」
      // 等 rebase 半成态下执行 push（推送的是变基中途的错误 ref）。必须先判定：
      const result = await commands.continueOperation(props.repoPath, mergeState.state);
      if (!result.success) {
        pushing.value = false;
        if (result.conflicts.length > 0) {
          // 多 commit rebase 常见：continue 推进到下一个 commit 又冲突。
          // 重开三栏继续解决（openConflictResolver 会保持 pendingPushAfterResolve=true），
          // 解决完会再次回到这里——绝不在半成态下推送。
          openConflictResolver(result.conflicts);
        } else {
          // 停在 edit 步骤或其它未完成：放弃自动推送，交回底部 Rebase 状态栏处理。
          pendingPushAfterResolve.value = false;
          pushError.value = result.message
            ? translateGitError(result.message)
            : "变基尚未完成（可能停在编辑步骤），请在底部变基状态栏继续或中止后再推送";
        }
        return;
      }
    }
    // 到这里：merge/rebase 半成态已彻底结束 → 安全推送
    pendingPushAfterResolve.value = false;
    pushing.value = false;
    await doPush();
  } catch (e: unknown) {
    pendingPushAfterResolve.value = false;
    pushing.value = false;
    pushError.value = pushErrText(e);
  }
}

function handleClose() {
  if (showConflictResolver.value) {
    showConflictResolver.value = false;
    pendingPushAfterResolve.value = false;
    return;
  }
  emit("close");
}

function fileStatusLabel(status: FileStatus["status"]) {
  const map: Record<string, string> = {
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    copied: "C",
    untracked: "?",
    conflicted: "!",
    ignored: "I",
  };
  return map[status] ?? "?";
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      showDivergence.value = false;
      showConflictResolver.value = false;
      pendingPushAfterResolve.value = false;
      pushError.value = "";
      loadCommits();
    }
  },
  { immediate: true }
);

watch(
  () => [props.repoPath, props.remote, props.branch, props.targetBranch] as const,
  () => {
    commitsLoadSeq += 1;
    filesLoadSeq += 1;
    loading.value = false;
    filesLoading.value = false;
    commits.value = [];
    selectedCommit.value = null;
    commitFiles.value = [];
    optForce.value = false;
    optForceWithLease.value = false;
    optSetUpstream.value = false;
    optPushTags.value = false;
    if (props.visible) void loadCommits();
  }
);

useRepoChangeEvents({
  repoPath: () => props.repoPath,
  kinds: ["head", "refs", "config"],
  onEvent: () => {
    if (!props.visible || pushing.value || showConflictResolver.value) return;
    void loadCommits(true);
  },
});
</script>

<template>
  <!-- Divergence Dialog -->
  <DivergenceDialog
    :visible="showDivergence"
    :behind="divergenceBehind"
    :ahead="divergenceAhead"
    :remote="remoteName"
    :branch="remoteBranchName"
    @rebase="handleDivergenceRebase"
    @merge="handleDivergenceMerge"
    @force="handleDivergenceForce"
    @cancel="handleDivergenceCancel"
  />

  <!-- Git 凭据登录（鉴权失败时弹出，保存后自动重试） -->
  <GitCredentialDialog
    :visible="showCredentialDialog"
    :host="credHost"
    :username="credUsername"
    hint="鉴权失败：请输入该主机的用户名与密码 / 访问令牌后重试。"
    @saved="onCredentialSaved"
    @close="onCredentialClose"
  />

  <!-- Conflict Resolver -->
  <Teleport to="body">
    <div v-if="showConflictResolver" class="conflict-modal-overlay">
      <div class="conflict-modal-panel">
        <div class="conflict-modal-header">
          <span>解决合并冲突后将自动推送</span>
          <button class="conflict-close-btn" @click="handleClose">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="conflict-modal-body">
          <ThreeWayMerge
            :file-path="conflictFirstFile"
            :conflict-files="conflictFiles"
            @resolved="onConflictResolved"
          />
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="visible && !showConflictResolver" class="push-overlay" @click.self="handleClose">
      <div class="push-dialog">
        <!-- Header -->
        <div class="push-header">
          <span class="push-title">推送提交</span>
          <button class="push-close" @click="handleClose">✕</button>
        </div>

        <!-- Body -->
        <div class="push-body">
          <!-- Left: commit list -->
          <div class="push-left">
            <!-- Repo / branch row -->
            <div class="repo-row">
              <svg
                class="repo-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"
                />
              </svg>
              <span class="repo-name">{{ repoLabel }}</span>
              <svg
                class="arrow-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
              <span class="dest-name">{{ destination }}</span>
              <span v-if="commits.length > 0" class="commit-count"
                >{{ commits.length }} 个提交</span
              >
            </div>

            <!-- Commit list -->
            <div class="commit-list-area">
              <div v-if="loading" class="list-empty">加载中...</div>
              <div v-else-if="commits.length === 0" class="list-empty">无待推送的提交</div>
              <div
                v-for="commit in commits"
                :key="commit.id"
                class="commit-row"
                :class="{ selected: selectedCommit?.id === commit.id }"
                @click="selectCommit(commit)"
              >
                <span class="commit-hash">{{ commit.shortId }}</span>
                <span class="commit-summary">{{ commit.summary }}</span>
                <span class="commit-meta"
                  >{{ commit.author }} · {{ formatTimestamp(commit.authorTime) }}</span
                >
              </div>
            </div>
          </div>

          <!-- Divider -->
          <div class="push-divider" />

          <!-- Right: files of selected commit -->
          <div class="push-right">
            <div class="files-header">
              <span v-if="selectedCommit">
                {{ selectedCommit.shortId }}
                <span class="files-count">&nbsp;{{ commitFiles.length }} 个文件</span>
              </span>
              <span v-else class="files-placeholder">选择提交以查看变更文件</span>
            </div>
            <div class="files-area">
              <div v-if="filesLoading" class="list-empty">加载中...</div>
              <div v-for="file in commitFiles" :key="file.path" class="file-row">
                <span class="file-status" :class="'status-' + file.status">{{
                  fileStatusLabel(file.status)
                }}</span>
                <span class="file-path">{{ file.path }}</span>
              </div>
              <div
                v-if="!filesLoading && selectedCommit && commitFiles.length === 0"
                class="list-empty"
              >
                无变更文件
              </div>
            </div>
          </div>
        </div>

        <!-- Error display -->
        <div v-if="pushError" class="push-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span>{{ pushError }}</span>
          <button class="push-error-close" @click="pushError = ''">✕</button>
        </div>

        <!-- Push options -->
        <div class="push-options">
          <label class="opt-row" title="远端被他人改动时安全失败（推荐的强推方式）">
            <input v-model="optForceWithLease" type="checkbox" :disabled="optForce" />
            <span>强制推送（--force-with-lease 安全）</span>
          </label>
          <label class="opt-row opt-danger" title="无视远端历史，可能覆盖他人提交">
            <input v-model="optForce" type="checkbox" :disabled="optForceWithLease" />
            <span>强制推送（--force 危险）</span>
          </label>
          <label class="opt-row" title="同时推送本地所有标签">
            <input v-model="optPushTags" type="checkbox" />
            <span>推送标签（--tags）</span>
          </label>
          <label class="opt-row" title="同时建立上游跟踪（首次推送新分支时需要）">
            <input v-model="optSetUpstream" type="checkbox" />
            <span>设置上游（-u / --set-upstream）</span>
          </label>
        </div>

        <!-- Footer -->
        <div class="push-footer">
          <button v-if="pushing" class="push-btn" @click="cancelInflight">中止</button>
          <button v-else class="push-btn" @click="handleClose">取消</button>
          <button
            class="push-btn primary"
            :class="{ 'push-btn-danger': optForce }"
            :disabled="pushing || (commits.length === 0 && !optForce && !optForceWithLease)"
            @click="handlePush"
          >
            <span v-if="pushing" class="push-btn-loading">
              <svg
                class="push-spinner"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              推送中…
            </span>
            <span v-else-if="optForce">⚠ 强制推送</span>
            <span v-else-if="optForceWithLease">安全强推</span>
            <span v-else>推送</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.push-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-backdrop);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.push-dialog {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-overlay);
  overflow: hidden;
  width: 720px;
  max-width: 95vw;
  height: 460px;
  max-height: 90vh;
}

/* Header */
.push-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--panel-header-height);
  padding: 4px 14px;
  background: var(--color-surface-emphasis);
  flex-shrink: 0;
}

.push-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-foreground);
}

.push-close {
  background: none;
  border: 1px solid transparent;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: var(--radius-md);
  line-height: 1;
}

.push-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

/* Body */
.push-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  background: var(--color-background);
}

/* Left panel */
.push-left {
  width: 55%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--color-divider);
}

.repo-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: var(--panel-header-height);
  padding: 4px 12px;
  flex-shrink: 0;
  font-size: 12px;
  background: var(--color-surface-muted);
}

.repo-icon {
  color: var(--color-foreground-muted);
  flex-shrink: 0;
}

.arrow-icon {
  color: var(--color-foreground-muted);
  flex-shrink: 0;
}

.repo-name {
  font-weight: 600;
  color: var(--color-foreground);
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dest-name {
  color: var(--color-primary, #4a9eff);
  font-weight: 500;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-count {
  margin-left: auto;
  color: var(--color-foreground-muted);
  flex-shrink: 0;
  padding: 0 6px;
  background: var(--color-surface-emphasis);
  border-radius: 999px;
}

.commit-list-area {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.list-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--color-foreground-muted);
}

.commit-row {
  display: flex;
  flex-direction: column;
  padding: 5px 8px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  gap: 2px;
}

.commit-row:hover {
  background: var(--color-surface-hover);
}

.commit-row.selected {
  background: color-mix(in srgb, var(--color-primary) 14%, var(--color-background));
  box-shadow: inset 2px 0 0 var(--color-primary);
}

.commit-hash {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-foreground-muted);
  flex-shrink: 0;
}

.commit-summary {
  font-size: 12px;
  color: var(--color-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-meta {
  font-size: 11px;
  color: var(--color-foreground-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Divider */
.push-divider {
  width: 0;
  flex-shrink: 0;
}

/* Right panel */
.push-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.files-header {
  display: flex;
  align-items: center;
  min-height: var(--panel-header-height);
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-foreground);
  background: var(--color-surface-muted);
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-count {
  font-weight: normal;
  color: var(--color-foreground-muted);
}

.files-placeholder {
  color: var(--color-foreground-muted);
  font-weight: normal;
}

.files-area {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  margin: 0 4px;
  padding: 3px 8px;
  font-size: 12px;
  border-radius: var(--radius-sm);
}

.file-row:hover {
  background: var(--color-surface-hover);
}

.file-status {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}

.file-status.status-added {
  color: var(--color-git-added);
}
.file-status.status-modified {
  color: var(--color-git-modified);
}
.file-status.status-deleted {
  color: var(--color-git-deleted);
}
.file-status.status-renamed {
  color: var(--color-git-renamed);
}
.file-status.status-copied {
  color: var(--color-git-renamed);
}

.file-path {
  font-size: 12px;
  color: var(--color-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Push options */
.push-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--color-divider);
  background: var(--color-surface-muted);
  flex-shrink: 0;
}

.opt-row {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--color-foreground);
  cursor: pointer;
  user-select: none;
}

.opt-row input[type="checkbox"] {
  width: 12px;
  height: 12px;
  margin: 0;
  accent-color: var(--color-primary);
}

.opt-row input[type="checkbox"]:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.opt-danger {
  color: var(--color-error, #e05252);
}

.opt-danger input[type="checkbox"] {
  accent-color: var(--color-error, #e05252);
}

/* Footer */
.push-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 4px 14px 10px;
  background: var(--color-surface-muted);
  flex-shrink: 0;
}

.push-btn.push-btn-danger {
  background: var(--color-error, #e05252);
  border-color: var(--color-error, #e05252);
  color: white;
}

.push-btn.push-btn-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-error, #e05252) 85%, black);
  border-color: color-mix(in srgb, var(--color-error, #e05252) 85%, black);
}

.push-btn {
  min-height: var(--control-height-regular);
  padding: 4px 16px;
  font-size: 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  background: var(--color-surface-emphasis);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
}

.push-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.push-btn.primary {
  background: var(--color-primary, #4a9eff);
  color: white;
  border-color: var(--color-primary, #4a9eff);
}

.push-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.push-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 推送中 loading：与分支条目（BranchesPane .branch-spinner）一致的旋转动画 */
.push-btn-loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.push-spinner {
  flex-shrink: 0;
  transform-origin: center;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Error display */
.push-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--color-surface-error);
  border-top: 1px solid color-mix(in srgb, var(--color-error) 28%, transparent);
  color: var(--color-error);
  font-size: 12px;
  flex-shrink: 0;
}

.push-error span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.push-error-close {
  background: none;
  border: 1px solid transparent;
  color: var(--color-error);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  opacity: 0.7;
}

.push-error-close:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--color-error, #e05252) 20%, transparent);
}

/* Conflict modal */
.conflict-modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-backdrop);
  z-index: 9200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.conflict-modal-panel {
  width: 95vw;
  height: 85vh;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-overlay);
}

.conflict-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--panel-header-height);
  padding: 4px 16px;
  background: var(--color-surface-emphasis);
  border-bottom: 1px solid var(--color-divider);
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-foreground);
}

.conflict-close-btn {
  background: none;
  border: 1px solid transparent;
  color: var(--color-foreground-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
}

.conflict-close-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-foreground);
}

.conflict-modal-body {
  flex: 1;
  overflow: hidden;
}
</style>
