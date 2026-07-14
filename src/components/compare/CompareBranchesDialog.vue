<script setup lang="ts">
/**
 * Compare Branches 弹窗 · IDEA "Compare with Branch" 同款 MVP
 *
 * 选择 base 与 target 两个分支：
 *   - 左侧 commit 列表：base..target 之间的 commits（target 新增的）
 *   - 中部文件列表：两分支 tip 之间的 name-status 变化
 *   - 右侧：选中文件后显示 commit diff
 *
 * 用 commands.getLog + commands.compareCommits 组合实现，不新增后端服务。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { commands } from "@/utils/commands";
import type {
  BranchInfo,
  CommitInfo,
  DiffResult,
  FileStatus,
  LogFilter,
} from "@/utils/commands";
import DiffViewer from "@/components/diff/DiffViewer.vue";
import { errText } from "@/utils/error";
import { useRepoChangeEvents } from "@/composables/useRepoWatcher";

const props = defineProps<{
  visible: boolean;
  repoPath: string;
}>();

const emit = defineEmits<{ (e: "update:visible", v: boolean): void }>();

const branches = ref<BranchInfo[]>([]);
const baseBranch = ref<string>("");
const targetBranch = ref<string>("");

const commits = ref<CommitInfo[]>([]);
const files = ref<FileStatus[]>([]);
const selectedFile = ref<FileStatus | null>(null);
const diff = ref<DiffResult | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const diffLoading = ref(false);
let reloadSeq = 0;
let diffLoadSeq = 0;
let branchesLoadSeq = 0;

const branchOptions = computed(() => branches.value.map((b) => b.name).filter(Boolean));

async function loadBranches() {
  if (!props.repoPath) return;
  const repoPath = props.repoPath;
  const seq = ++branchesLoadSeq;
  try {
    const result = await commands.getBranches(repoPath);
    if (seq !== branchesLoadSeq || props.repoPath !== repoPath || !props.visible) return;
    branches.value = result.local ?? [];
    const available = new Set(branches.value.map((branch) => branch.name));
    if (!targetBranch.value || !available.has(targetBranch.value)) {
      targetBranch.value = branches.value.find((branch) => branch.isHead)?.name ?? "";
    }
    if (!baseBranch.value || !available.has(baseBranch.value)) {
      const main = branches.value.find((b) => /^(main|master|develop|trunk)$/.test(b.name));
      baseBranch.value =
        (main?.name !== targetBranch.value ? main?.name : undefined) ??
        branches.value.find((branch) => branch.name !== targetBranch.value)?.name ??
        "";
    }
  } catch (e) {
    if (seq === branchesLoadSeq && props.repoPath === repoPath) error.value = errText(e);
  }
}

async function reload() {
  if (!baseBranch.value || !targetBranch.value || baseBranch.value === targetBranch.value) {
    commits.value = [];
    files.value = [];
    return;
  }
  const repoPath = props.repoPath;
  const base = baseBranch.value;
  const target = targetBranch.value;
  const selectedPath = selectedFile.value?.path;
  const seq = ++reloadSeq;
  loading.value = true;
  error.value = null;
  try {
    // base..target 表示 target 上有但 base 上没有的 commit
    const range = `${base}..${target}`;
    const filter: LogFilter = {
      skip: 0,
      limit: 500,
      branch: range,
      author: null,
      dateFrom: null,
      dateTo: null,
      path: null,
      searchText: "",
      useRegex: false,
      matchCase: false,
    };
    const [logResult, fileDiff] = await Promise.all([
      commands.getLog(repoPath, filter),
      commands.compareCommits(repoPath, base, target),
    ]);
    if (
      seq !== reloadSeq ||
      !props.visible ||
      props.repoPath !== repoPath ||
      baseBranch.value !== base ||
      targetBranch.value !== target
    ) {
      return;
    }
    commits.value = logResult.commits ?? [];
    files.value = fileDiff ?? [];
    selectedFile.value =
      files.value.find((file) => file.path === selectedPath) ?? files.value[0] ?? null;
  } catch (e) {
    if (seq === reloadSeq) error.value = errText(e);
  } finally {
    if (seq === reloadSeq) loading.value = false;
  }
}

async function loadDiff(file: FileStatus | null) {
  const seq = ++diffLoadSeq;
  if (!file) {
    diff.value = null;
    diffLoading.value = false;
    return;
  }
  const repoPath = props.repoPath;
  const target = targetBranch.value;
  diffLoading.value = true;
  try {
    const result = await commands.getFileDiff(
      repoPath,
      file.path,
      false
    );
    // 工作区 diff 对 "已 commit 但分支间不同" 的场景不准；改用 compareCommits 视角下
    // 的 git diff，借用 getCommitDiff 用 targetBranch tip
    if (target) {
      try {
        const next = await commands.getCommitDiff(repoPath, target, file.path);
        if (seq === diffLoadSeq && props.repoPath === repoPath) diff.value = next;
      } catch {
        if (seq === diffLoadSeq && props.repoPath === repoPath) diff.value = result;
      }
    } else if (seq === diffLoadSeq && props.repoPath === repoPath) {
      diff.value = result;
    }
  } catch (e) {
    if (seq === diffLoadSeq && props.repoPath === repoPath) {
      error.value = errText(e);
      diff.value = null;
    }
  } finally {
    if (seq === diffLoadSeq) diffLoading.value = false;
  }
}

async function refreshSnapshot(): Promise<void> {
  if (!props.visible) return;
  const previousBase = baseBranch.value;
  const previousTarget = targetBranch.value;
  await loadBranches();
  if (baseBranch.value === previousBase && targetBranch.value === previousTarget) {
    await reload();
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      void loadBranches();
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true }
);

watch(
  () => props.repoPath,
  () => {
    branchesLoadSeq += 1;
    reloadSeq += 1;
    diffLoadSeq += 1;
    loading.value = false;
    diffLoading.value = false;
    branches.value = [];
    baseBranch.value = "";
    targetBranch.value = "";
    commits.value = [];
    files.value = [];
    selectedFile.value = null;
    diff.value = null;
    if (props.visible) void loadBranches();
  }
);

watch([baseBranch, targetBranch], () => {
  selectedFile.value = null;
  diff.value = null;
  void reload();
});

watch(selectedFile, (f) => void loadDiff(f));

useRepoChangeEvents({
  repoPath: () => props.repoPath,
  kinds: ["head", "refs"],
  onEvent: () => {
    void refreshSnapshot();
  },
});

function close() {
  emit("update:visible", false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.visible) {
    e.preventDefault();
    close();
  }
}

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function statusBadge(s: string): string {
  switch (s) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "modified":
    default:
      return "M";
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.visible" class="cb-mask" @click.self="close">
      <div class="cb-dialog">
        <header class="cb-header">
          <div class="cb-selectors">
            <label>
              <span>基准</span>
              <select v-model="baseBranch">
                <option v-for="b in branchOptions" :key="`base-${b}`" :value="b">{{ b }}</option>
              </select>
            </label>
            <span class="cb-arrow">→</span>
            <label>
              <span>目标</span>
              <select v-model="targetBranch">
                <option v-for="b in branchOptions" :key="`tgt-${b}`" :value="b">{{ b }}</option>
              </select>
            </label>
            <span class="cb-summary" v-if="commits.length">
              {{ commits.length }} 个提交 · {{ files.length }} 个文件
            </span>
          </div>
          <button class="cb-close" @click="close">✕</button>
        </header>

        <div v-if="error" class="cb-error">{{ error }}</div>

        <div class="cb-body">
          <aside class="cb-commits">
            <div class="cb-pane-title">提交（基准..目标）</div>
            <div v-if="loading" class="cb-empty">加载中…</div>
            <div v-else-if="!commits.length" class="cb-empty">
              {{
                baseBranch === targetBranch
                  ? "两边相同分支，无可对比"
                  : "无提交差异"
              }}
            </div>
            <ul v-else class="cb-list">
              <li v-for="c in commits" :key="c.id" class="cb-commit">
                <span class="cb-sha">{{ (c.shortId || c.id).substring(0, 7) }}</span>
                <span class="cb-subject">{{ c.summary }}</span>
                <span class="cb-author">{{ c.author }}</span>
              </li>
            </ul>
          </aside>

          <aside class="cb-files">
            <div class="cb-pane-title">变更文件</div>
            <div v-if="loading" class="cb-empty">加载中…</div>
            <div v-else-if="!files.length" class="cb-empty">无文件变更</div>
            <ul v-else class="cb-list">
              <li
                v-for="f in files"
                :key="f.path"
                class="cb-file"
                :class="{ active: selectedFile?.path === f.path, [`status-${f.status}`]: true }"
                @click="selectedFile = f"
              >
                <span class="cb-file-status">{{ statusBadge(f.status) }}</span>
                <span class="cb-file-path" :title="f.path">{{ f.path }}</span>
              </li>
            </ul>
          </aside>

          <section class="cb-diff">
            <div v-if="!selectedFile" class="cb-empty">选择左侧文件查看差异</div>
            <div v-else-if="diffLoading" class="cb-empty">读取差异…</div>
            <div v-else-if="diff?.binary" class="cb-empty">二进制文件</div>
            <div v-else-if="diff && diff.hunks && diff.hunks.length" class="cb-diff-content">
              <DiffViewer :diff="diff" />
            </div>
            <div v-else class="cb-empty">无可显示的差异</div>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cb-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8600;
}
.cb-dialog {
  width: min(1400px, 97vw);
  height: min(880px, 92vh);
  background: var(--color-surface);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg, 10px);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--color-surface-emphasis);
}
.cb-selectors {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
.cb-selectors label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cb-selectors select {
  background: var(--color-surface);
  color: var(--color-foreground);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm, 4px);
  padding: 3px 6px;
  font-size: 12px;
  min-width: 160px;
}
.cb-arrow {
  color: var(--color-foreground-muted);
}
.cb-summary {
  margin-left: 12px;
  font-size: 11px;
  color: var(--color-foreground-muted);
}
.cb-close {
  background: transparent;
  border: none;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
}
.cb-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.cb-commits,
.cb-files {
  width: 300px;
  border-right: 1px solid var(--color-border);
  background: var(--color-background);
  display: flex;
  flex-direction: column;
}
.cb-pane-title {
  padding: 6px 12px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-foreground-muted);
  background: var(--color-surface-active);
  border-bottom: 1px solid var(--color-border);
}
.cb-list {
  flex: 1;
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
}
.cb-commit,
.cb-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  border-left: 3px solid transparent;
}
.cb-commit:hover,
.cb-file:hover {
  background: var(--color-surface-hover);
}
.cb-file.active {
  background: var(--color-surface-active);
  border-left-color: var(--color-primary);
}
.cb-sha {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-foreground-muted);
  flex-shrink: 0;
  width: 56px;
}
.cb-subject {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cb-author {
  font-size: 10px;
  color: var(--color-foreground-muted);
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.cb-file-status {
  width: 18px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10px;
  border-radius: 2px;
  padding: 1px 2px;
  background: var(--color-surface-active);
  flex-shrink: 0;
}
.cb-file.status-added .cb-file-status {
  background: var(--color-git-added);
  color: white;
}
.cb-file.status-deleted .cb-file-status {
  background: var(--color-git-deleted);
  color: white;
}
.cb-file.status-modified .cb-file-status {
  background: var(--color-git-modified);
  color: white;
}
.cb-file.status-renamed .cb-file-status {
  background: var(--color-git-renamed);
  color: white;
}
.cb-file-path {
  font-family: var(--font-mono);
  font-size: 11px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cb-diff {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-surface);
}
.cb-diff-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.cb-empty {
  padding: 24px;
  text-align: center;
  color: var(--color-foreground-muted);
  font-size: 13px;
}
.cb-error {
  padding: 8px 16px;
  background: var(--color-diff-removed-bg);
  color: var(--color-error);
  font-size: 12px;
}
</style>
