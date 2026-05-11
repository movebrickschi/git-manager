<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useRepoStore } from "@/stores/repoStore";
import { commands } from "@/utils/commands";
import type * as MonacoNS from "monaco-editor";

let monaco: typeof MonacoNS | null = null;
let monacoLoadPromise: Promise<typeof MonacoNS> | null = null;

async function loadMonaco(): Promise<typeof MonacoNS> {
  if (monaco) return monaco;
  if (monacoLoadPromise) return monacoLoadPromise;
  monacoLoadPromise = (async () => {
    if (typeof self !== "undefined" && !(self as any).MonacoEnvironment) {
      (self as any).MonacoEnvironment = {
        getWorkerUrl: () =>
          `data:text/javascript;charset=utf-8,${encodeURIComponent("self.onmessage=function(){}")}`,
      };
    }
    const mod = await import("monaco-editor");
    monaco = mod;
    return mod;
  })();
  return monacoLoadPromise;
}

// ---------------------------------------------------------------------------
// Props / Emits
// ---------------------------------------------------------------------------
const props = defineProps<{
  filePath: string;
  conflictFiles?: string[];
}>();

const emit = defineEmits<{
  resolved: [];
}>();

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------
const repoStore = useRepoStore();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const currentFile = ref(props.filePath);
const conflict = ref<{ path: string; oursContent: string; theirsContent: string; baseContent: string } | null>(null);
const rawContent = ref("");        // working-tree file with conflict markers
const resultContent = ref("");     // editable merged result
const loading = ref(false);
const saving = ref(false);
const resolvedFiles = ref<string[]>([]);

// Conflict hunks parsed from rawContent
interface ConflictHunk {
  index: number;
  oursLines: string[];
  theirsLines: string[];
  resultStartLine: number; // 1-based line number in resultContent where hunk starts
}
const hunks = ref<ConflictHunk[]>([]);
const currentHunkIndex = ref(0);

// Segments for rendering side panels
interface ContextSegment {
  type: "context";
  lines: string[];
  startLineNo: number;
}
interface HunkSegment {
  type: "hunk";
  index: number;
  oursLines: string[];
  theirsLines: string[];
}
type MergeSegment = ContextSegment | HunkSegment;

const editorContainer = ref<HTMLElement | null>(null);
let monacoEditor: MonacoNS.editor.IStandaloneCodeEditor | null = null;
let decorations: string[] = [];

// Panel refs for synchronized scrolling (reserved for future use)
const leftPanel = ref<HTMLElement | null>(null);
const rightPanel = ref<HTMLElement | null>(null);

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

// Parse rawContent into context + hunk segments for side-panel rendering
const segments = computed<MergeSegment[]>(() => {
  const raw = rawContent.value;
  if (!raw) return [];
  const lines = raw.split("\n");
  const result: MergeSegment[] = [];
  let i = 0;
  let hunkIdx = 0;
  let ctxLines: string[] = [];
  let ctxStartLineNo = 1;
  let lineNo = 1;

  const flushContext = () => {
    if (ctxLines.length > 0) {
      result.push({ type: "context", lines: [...ctxLines], startLineNo: ctxStartLineNo });
      ctxLines = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("<<<<<<<")) {
      flushContext();
      const oursLines: string[] = [];
      const theirsLines: string[] = [];
      i++; lineNo++;
      while (i < lines.length && !lines[i]!.startsWith("=======")) {
        oursLines.push(lines[i]!);
        i++; lineNo++;
      }
      i++; lineNo++; // skip =======
      while (i < lines.length && !lines[i]!.startsWith(">>>>>>>")) {
        theirsLines.push(lines[i]!);
        i++; lineNo++;
      }
      i++; lineNo++; // skip >>>>>>>
      result.push({ type: "hunk", index: hunkIdx++, oursLines, theirsLines });
      ctxStartLineNo = lineNo;
    } else {
      if (ctxLines.length === 0) ctxStartLineNo = lineNo;
      ctxLines.push(line);
      i++; lineNo++;
    }
  }
  flushContext();
  return result;
});

const allFiles = computed(() => {
  if (props.conflictFiles && props.conflictFiles.length > 0) {
    return props.conflictFiles;
  }
  return [props.filePath];
});

const showFileList = computed(() => allFiles.value.length > 1);

const hasConflicts = computed(() => hunks.value.length > 0);

const currentHunk = computed(() =>
  hunks.value[currentHunkIndex.value] ?? null
);

const totalUnresolved = computed(() => {
  if (!resultContent.value) return 0;
  return (resultContent.value.match(/^<{7}/m) ?? []).length;
});

// ---------------------------------------------------------------------------
// Conflict marker parsing
// ---------------------------------------------------------------------------
function parseConflictHunks(raw: string): ConflictHunk[] {
  const lines = raw.split("\n");
  const result: ConflictHunk[] = [];
  let i = 0;
  let hunkIdx = 0;
  let resultLine = 1;

  while (i < lines.length) {
    if (lines[i]!.startsWith("<<<<<<<")) {
      const oursLines: string[] = [];
      const theirsLines: string[] = [];
      const hunkStartResultLine = resultLine;
      i++;
      // collect ours
      while (i < lines.length && !lines[i]!.startsWith("=======")) {
        oursLines.push(lines[i]!);
        i++;
      }
      i++; // skip =======
      // collect theirs
      while (i < lines.length && !lines[i]!.startsWith(">>>>>>>")) {
        theirsLines.push(lines[i]!);
        i++;
      }
      i++; // skip >>>>>>>
      result.push({
        index: hunkIdx++,
        oursLines,
        theirsLines,
        resultStartLine: hunkStartResultLine,
      });
      // The hunk occupies: 1 (<<<) + ours + 1 (===) + theirs + 1 (>>>) lines in raw
      resultLine += 1 + oursLines.length + 1 + theirsLines.length + 1;
    } else {
      i++;
      resultLine++;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Load file data
// ---------------------------------------------------------------------------
async function loadFile(filePath: string) {
  if (!repoStore.activeRepo) return;
  loading.value = true;
  hunks.value = [];
  currentHunkIndex.value = 0;
  try {
    const [conflictData, raw] = await Promise.all([
      commands.getConflictContent(repoStore.activeRepo.path, filePath),
      commands.getWorkingFileContent(repoStore.activeRepo.path, filePath),
    ]);
    conflict.value = conflictData;
    rawContent.value = raw;
    resultContent.value = raw;
    hunks.value = parseConflictHunks(raw);
    currentHunkIndex.value = 0;

    await nextTick();
    if (monacoEditor) {
      monacoEditor.setValue(raw);
      updateDecorations();
      if (hunks.value.length > 0) {
        scrollEditorToHunk(0);
      }
    }
  } catch (e) {
    console.error("Failed to load conflict:", e);
  } finally {
    loading.value = false;
  }
}

// ---------------------------------------------------------------------------
// Monaco Editor setup
// ---------------------------------------------------------------------------
function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    vue: "html", html: "html", htm: "html",
    css: "css", scss: "scss", less: "less",
    json: "json", md: "markdown",
    py: "python", rs: "rust", go: "go",
    java: "java", kt: "kotlin",
    cs: "csharp", cpp: "cpp", c: "c", h: "c",
    sh: "shell", bash: "shell",
    yaml: "yaml", yml: "yaml", toml: "ini",
    xml: "xml", svg: "xml",
  };
  return map[ext] ?? "plaintext";
}

async function initMonaco() {
  if (!editorContainer.value) return;
  const m = await loadMonaco();
  if (!editorContainer.value) return;
  monacoEditor = m.editor.create(editorContainer.value, {
    value: resultContent.value,
    language: detectLanguage(currentFile.value),
    theme: "vs-dark",
    fontSize: 12,
    lineHeight: 20,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: "off",
    automaticLayout: true,
    renderLineHighlight: "all",
    glyphMargin: true,
    folding: false,
  });

  monacoEditor.onDidChangeModelContent(() => {
    resultContent.value = monacoEditor!.getValue();
    hunks.value = parseConflictHunks(resultContent.value);
  });

  updateDecorations();
}

function updateDecorations() {
  if (!monacoEditor || !monaco) return;
  const m = monaco;
  const model = monacoEditor.getModel();
  if (!model) return;

  const newDecorations: MonacoNS.editor.IModelDeltaDecoration[] = [];
  const lines = monacoEditor.getValue().split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    if (line.startsWith("<<<<<<<")) {
      newDecorations.push({
        range: new m.Range(lineNo, 1, lineNo, 1),
        options: {
          isWholeLine: true,
          className: "conflict-ours-marker",
          glyphMarginClassName: "conflict-glyph-ours",
          overviewRuler: { color: "#2d9a2d", position: m.editor.OverviewRulerLane.Left },
        },
      });
    } else if (line.startsWith("=======")) {
      newDecorations.push({
        range: new m.Range(lineNo, 1, lineNo, 1),
        options: {
          isWholeLine: true,
          className: "conflict-sep-marker",
        },
      });
    } else if (line.startsWith(">>>>>>>")) {
      newDecorations.push({
        range: new m.Range(lineNo, 1, lineNo, 1),
        options: {
          isWholeLine: true,
          className: "conflict-theirs-marker",
          glyphMarginClassName: "conflict-glyph-theirs",
          overviewRuler: { color: "#1e6fcc", position: m.editor.OverviewRulerLane.Right },
        },
      });
    }
  }

  decorations = monacoEditor.deltaDecorations(decorations, newDecorations);
}

function scrollEditorToHunk(index: number) {
  if (!monacoEditor || !hunks.value[index]) return;
  const hunk = hunks.value[index]!;
  monacoEditor.revealLineInCenter(hunk.resultStartLine);
}

// ---------------------------------------------------------------------------
// Hunk navigation
// ---------------------------------------------------------------------------
function prevHunk() {
  if (currentHunkIndex.value > 0) {
    currentHunkIndex.value--;
    scrollEditorToHunk(currentHunkIndex.value);
  }
}

function nextHunk() {
  if (currentHunkIndex.value < hunks.value.length - 1) {
    currentHunkIndex.value++;
    scrollEditorToHunk(currentHunkIndex.value);
  }
}

// ---------------------------------------------------------------------------
// Accept hunk helpers
// ---------------------------------------------------------------------------
function replaceHunkInEditor(hunk: ConflictHunk, replacement: string[]) {
  if (!monacoEditor) return;
  const model = monacoEditor.getModel();
  if (!model) return;

  const lines = monacoEditor.getValue().split("\n");
  let hunkStart = -1;
  let hunkEnd = -1;
  let inOurs = false;
  let inTheirs = false;
  let foundHunkCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("<<<<<<<")) {
      if (foundHunkCount === hunk.index) {
        hunkStart = i;
        inOurs = true;
      }
      foundHunkCount++;
    } else if (line.startsWith("=======") && inOurs) {
      inOurs = false;
      inTheirs = true;
    } else if (line.startsWith(">>>>>>>") && inTheirs) {
      inTheirs = false;
      hunkEnd = i;
      break;
    }
  }

  if (hunkStart === -1 || hunkEnd === -1) return;

  const startLine = hunkStart + 1; // 1-based
  const endLine = hunkEnd + 1;
  const endCol = (lines[hunkEnd] ?? "").length + 1;

  if (!monaco) return;
  monacoEditor.executeEdits("accept-hunk", [
    {
      range: new monaco.Range(startLine, 1, endLine, endCol),
      text: replacement.join("\n"),
    },
  ]);

  resultContent.value = monacoEditor.getValue();
  hunks.value = parseConflictHunks(resultContent.value);
  // stay at same index or clamp
  if (currentHunkIndex.value >= hunks.value.length) {
    currentHunkIndex.value = Math.max(0, hunks.value.length - 1);
  }
  updateDecorations();
}

function acceptOurs() {
  if (!currentHunk.value) return;
  replaceHunkInEditor(currentHunk.value, currentHunk.value.oursLines);
}

function acceptTheirs() {
  if (!currentHunk.value) return;
  replaceHunkInEditor(currentHunk.value, currentHunk.value.theirsLines);
}

function acceptBoth() {
  if (!currentHunk.value) return;
  replaceHunkInEditor(currentHunk.value, [
    ...currentHunk.value.oursLines,
    ...currentHunk.value.theirsLines,
  ]);
}

function resolveHunk(index: number, action: "ours" | "theirs" | "both" | "discard") {
  const hunk = hunks.value[index];
  if (!hunk) return;
  // Temporarily set currentHunkIndex so replaceHunkInEditor targets correct hunk
  currentHunkIndex.value = index;
  const replacement =
    action === "ours"    ? hunk.oursLines :
    action === "theirs"  ? hunk.theirsLines :
    action === "both"    ? [...hunk.oursLines, ...hunk.theirsLines] :
    []; // discard → empty
  replaceHunkInEditor(hunk, replacement);
}

// Toolbar-level shortcuts (accept all hunks at once)
function acceptAllOurs() {
  if (!conflict.value) return;
  const val = conflict.value.oursContent;
  resultContent.value = val;
  monacoEditor?.setValue(val);
  hunks.value = parseConflictHunks(val);
  updateDecorations();
}

function acceptAllTheirs() {
  if (!conflict.value) return;
  const val = conflict.value.theirsContent;
  resultContent.value = val;
  monacoEditor?.setValue(val);
  hunks.value = parseConflictHunks(val);
  updateDecorations();
}

// ---------------------------------------------------------------------------
// Save / apply resolution
// ---------------------------------------------------------------------------
async function applyResolution() {
  if (!repoStore.activeRepo) return;
  saving.value = true;
  try {
    await commands.resolveConflict(
      repoStore.activeRepo.path,
      currentFile.value,
      resultContent.value
    );
    resolvedFiles.value.push(currentFile.value);

    const remaining = allFiles.value.filter((f) => !resolvedFiles.value.includes(f));
    if (remaining.length > 0) {
      await switchFile(remaining[0]!);
    } else {
      emit("resolved");
    }
  } catch (e: any) {
    console.error("Failed to resolve conflict:", e);
  } finally {
    saving.value = false;
  }
}

// ---------------------------------------------------------------------------
// File switching
// ---------------------------------------------------------------------------
async function switchFile(filePath: string) {
  if (filePath === currentFile.value) return;
  currentFile.value = filePath;
  await loadFile(filePath);
  if (monacoEditor && monaco) {
    const lang = detectLanguage(filePath);
    monaco.editor.setModelLanguage(monacoEditor.getModel()!, lang);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
onMounted(async () => {
  await loadFile(props.filePath);
  await nextTick();
  await initMonaco();
});

watch(
  () => props.filePath,
  async (newPath) => {
    currentFile.value = newPath;
    await loadFile(newPath);
  }
);

watch(
  () => resultContent.value,
  () => {
    if (monacoEditor) updateDecorations();
  }
);

onBeforeUnmount(() => {
  monacoEditor?.dispose();
  monacoEditor = null;
});
</script>

<template>
  <div class="three-way-merge">
    <!-- Sidebar: file list (only shown when multiple conflict files) -->
    <div v-if="showFileList" class="file-sidebar">
      <div class="sidebar-header">冲突文件</div>
      <div
        v-for="f in allFiles"
        :key="f"
        class="sidebar-file"
        :class="{
          active: f === currentFile,
          resolved: resolvedFiles.includes(f),
        }"
        :title="f"
        @click="switchFile(f)"
      >
        <span class="file-status-icon">
          <svg v-if="resolvedFiles.includes(f)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span v-else class="conflict-dot">!</span>
        </span>
        <span class="file-name">{{ f.split("/").pop() }}</span>
      </div>
    </div>

    <!-- Main content -->
    <div class="merge-main">
      <!-- Loading -->
      <div v-if="loading" class="loading-overlay">
        <span>加载冲突内容...</span>
      </div>

      <template v-else-if="conflict">
        <!-- Toolbar -->
        <div class="merge-toolbar">
          <!-- File path -->
          <span class="file-path" :title="currentFile">{{ currentFile }}</span>
          <div class="toolbar-sep" />

          <!-- Accept all shortcuts -->
          <button class="tbtn tbtn-green" title="接受所有 Ours（本地）" @click="acceptAllOurs">
            全部接受左侧
          </button>
          <button class="tbtn tbtn-blue" title="接受所有 Theirs（传入）" @click="acceptAllTheirs">
            全部接受右侧
          </button>
          <div class="toolbar-sep" />

          <!-- Hunk navigation -->
          <template v-if="hasConflicts">
            <button class="tbtn" :disabled="currentHunkIndex === 0" @click="prevHunk">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              上一处
            </button>
            <span class="hunk-counter">{{ currentHunkIndex + 1 }} / {{ hunks.length }}</span>
            <button class="tbtn" :disabled="currentHunkIndex >= hunks.length - 1" @click="nextHunk">
              下一处
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <div class="toolbar-sep" />
            <!-- Per-hunk accept -->
            <button class="tbtn tbtn-green" @click="acceptOurs">
              ← 接受左侧
            </button>
            <button class="tbtn" @click="acceptBoth">
              接受两者
            </button>
            <button class="tbtn tbtn-blue" @click="acceptTheirs">
              接受右侧 →
            </button>
            <div class="toolbar-sep" />
          </template>

          <!-- Unresolved count badge -->
          <span v-if="totalUnresolved > 0" class="unresolved-badge">
            {{ totalUnresolved }} 处未解决
          </span>
          <span v-else-if="!loading" class="resolved-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            已解决
          </span>
          <div style="flex: 1" />

          <button
            class="tbtn tbtn-primary"
            :disabled="saving || totalUnresolved > 0"
            :title="totalUnresolved > 0 ? '还有未解决的冲突块' : '保存并标记为已解决'"
            @click="applyResolution"
          >
            {{ saving ? "保存中..." : "应用并标记为已解决" }}
          </button>
        </div>

        <!-- Column headers -->
        <div class="panel-headers">
          <div class="panel-head yours">
            <span>Yours（本地）</span>
            <span class="head-lines">{{ hunks.length }} 处冲突</span>
          </div>
          <div class="panel-head result">
            <span>合并结果（可编辑）</span>
          </div>
          <div class="panel-head theirs">
            <span>Theirs（传入）</span>
            <span class="head-lines">{{ hunks.length }} 处冲突</span>
          </div>
        </div>

        <!-- Three panels -->
        <div class="merge-panels">
          <!-- Left: Yours (read-only, segment-based) -->
          <div ref="leftPanel" class="side-panel">
            <template v-for="seg in segments" :key="seg.type === 'hunk' ? 'lh' + seg.index : 'lc' + seg.startLineNo">
              <!-- Context lines -->
              <template v-if="seg.type === 'context'">
                <div
                  v-for="(line, i) in seg.lines"
                  :key="'lc' + (seg.startLineNo + i)"
                  class="code-line"
                >
                  <span class="line-no">{{ seg.startLineNo + i }}</span>
                  <span class="line-text">{{ line }}</span>
                </div>
              </template>
              <!-- Hunk: ours lines with action buttons -->
              <template v-else-if="seg.type === 'hunk'">
                <div class="hunk-action-bar hunk-action-bar--ours">
                  <button class="hunk-btn hunk-btn--ours" @click="resolveHunk(seg.index, 'ours')">
                    ← 接受此处
                  </button>
                  <button class="hunk-btn hunk-btn--discard" @click="resolveHunk(seg.index, 'discard')">
                    丢弃
                  </button>
                </div>
                <div
                  v-for="(line, i) in seg.oursLines"
                  :key="'lo' + seg.index + '_' + i"
                  class="code-line ours-line"
                >
                  <span class="line-no">{{ i + 1 }}</span>
                  <span class="line-text">{{ line }}</span>
                </div>
                <div v-if="seg.oursLines.length === 0" class="code-line ours-line empty-hunk-line">
                  <span class="line-no" />
                  <span class="line-text empty-hint">（无内容）</span>
                </div>
              </template>
            </template>
          </div>

          <!-- Center: Monaco Editor -->
          <div class="editor-panel">
            <div ref="editorContainer" class="monaco-container" />
          </div>

          <!-- Right: Theirs (read-only, segment-based) -->
          <div ref="rightPanel" class="side-panel">
            <template v-for="seg in segments" :key="seg.type === 'hunk' ? 'rh' + seg.index : 'rc' + seg.startLineNo">
              <!-- Context lines -->
              <template v-if="seg.type === 'context'">
                <div
                  v-for="(line, i) in seg.lines"
                  :key="'rc' + (seg.startLineNo + i)"
                  class="code-line"
                >
                  <span class="line-no">{{ seg.startLineNo + i }}</span>
                  <span class="line-text">{{ line }}</span>
                </div>
              </template>
              <!-- Hunk: theirs lines with action buttons -->
              <template v-else-if="seg.type === 'hunk'">
                <div class="hunk-action-bar hunk-action-bar--theirs">
                  <button class="hunk-btn hunk-btn--theirs" @click="resolveHunk(seg.index, 'theirs')">
                    接受此处 →
                  </button>
                  <button class="hunk-btn hunk-btn--discard" @click="resolveHunk(seg.index, 'discard')">
                    丢弃
                  </button>
                </div>
                <div
                  v-for="(line, i) in seg.theirsLines"
                  :key="'rt' + seg.index + '_' + i"
                  class="code-line theirs-line"
                >
                  <span class="line-no">{{ i + 1 }}</span>
                  <span class="line-text">{{ line }}</span>
                </div>
                <div v-if="seg.theirsLines.length === 0" class="code-line theirs-line empty-hunk-line">
                  <span class="line-no" />
                  <span class="line-text empty-hint">（无内容）</span>
                </div>
              </template>
            </template>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
<style>
/* Monaco conflict highlight classes (global - not scoped) */
.conflict-ours-marker {
  background: rgba(45, 154, 45, 0.15) !important;
  border-left: 3px solid #2d9a2d !important;
}
.conflict-sep-marker {
  background: rgba(200, 200, 50, 0.1) !important;
  border-left: 3px solid #c8c832 !important;
}
.conflict-theirs-marker {
  background: rgba(30, 111, 204, 0.15) !important;
  border-left: 3px solid #1e6fcc !important;
}
.conflict-glyph-ours::before {
  content: "◀";
  color: #2d9a2d;
  font-size: 10px;
}
.conflict-glyph-theirs::before {
  content: "▶";
  color: #1e6fcc;
  font-size: 10px;
}
</style>

<style scoped>
.three-way-merge {
  display: flex;
  flex-direction: row;
  height: 100%;
  background: var(--color-background);
  overflow: hidden;
}

/* ---- Sidebar ---- */
.file-sidebar {
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
}

.sidebar-header {
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-foreground-muted);
  border-bottom: 1px solid var(--color-border);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sidebar-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-foreground);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 40%, transparent);
}

.sidebar-file:hover {
  background: var(--color-surface-hover);
}

.sidebar-file.active {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

.sidebar-file.resolved {
  opacity: 0.5;
  text-decoration: line-through;
}

.file-status-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  color: var(--color-git-added);
}

.conflict-dot {
  color: var(--color-error);
  font-weight: 700;
  font-size: 13px;
  line-height: 1;
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- Main ---- */
.merge-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.loading-overlay {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-foreground-muted);
  font-size: 13px;
}

/* ---- Toolbar ---- */
.merge-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  flex-wrap: wrap;
  min-height: 34px;
}

.file-path {
  font-size: 11px;
  color: var(--color-foreground-muted);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

.toolbar-sep {
  width: 1px;
  height: 16px;
  background: var(--color-border);
  margin: 0 3px;
  flex-shrink: 0;
}

.tbtn {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  background: var(--color-surface-hover);
  color: var(--color-foreground);
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.tbtn:hover:not(:disabled) {
  background: var(--color-surface-active);
}

.tbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tbtn-green {
  background: color-mix(in srgb, #2d9a2d 20%, transparent);
  color: #5aba5a;
}

.tbtn-green:hover:not(:disabled) {
  background: color-mix(in srgb, #2d9a2d 35%, transparent);
}

.tbtn-blue {
  background: color-mix(in srgb, #1e6fcc 20%, transparent);
  color: #5598e8;
}

.tbtn-blue:hover:not(:disabled) {
  background: color-mix(in srgb, #1e6fcc 35%, transparent);
}

.tbtn-primary {
  background: var(--color-primary);
  color: #fff;
  padding: 3px 12px;
}

.tbtn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.hunk-counter {
  font-size: 11px;
  color: var(--color-foreground-muted);
  padding: 0 4px;
  white-space: nowrap;
}

.unresolved-badge {
  font-size: 11px;
  color: var(--color-error);
  background: color-mix(in srgb, var(--color-error) 15%, transparent);
  padding: 1px 7px;
  border-radius: 8px;
  font-weight: 600;
}

.resolved-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-git-added);
  background: color-mix(in srgb, var(--color-git-added) 15%, transparent);
  padding: 1px 7px;
  border-radius: 8px;
  font-weight: 600;
}

/* ---- Column headers ---- */
.panel-headers {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
}

.panel-head {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-right: 1px solid var(--color-border);
}

.panel-head:last-child {
  border-right: none;
}

.panel-head.yours {
  background: color-mix(in srgb, #2d9a2d 12%, var(--color-surface));
  color: #5aba5a;
}

.panel-head.result {
  background: var(--color-surface);
  color: var(--color-foreground);
}

.panel-head.theirs {
  background: color-mix(in srgb, #1e6fcc 12%, var(--color-surface));
  color: #5598e8;
}

.head-lines {
  font-size: 10px;
  opacity: 0.7;
  font-weight: 400;
}

/* ---- Panels ---- */
.merge-panels {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.side-panel {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  border-right: 1px solid var(--color-border);
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 20px;
  background: var(--color-background);
}

.editor-panel {
  flex: 1.4;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--color-border);
}

.monaco-container {
  flex: 1;
  height: 100%;
}

.code-line {
  display: flex;
  min-height: 20px;
  line-height: 20px;
}

.code-line.ours-line {
  background: color-mix(in srgb, #2d9a2d 18%, transparent);
}

.code-line.theirs-line {
  background: color-mix(in srgb, #1e6fcc 18%, transparent);
}

.empty-hunk-line {
  opacity: 0.45;
  font-style: italic;
}

.empty-hint {
  color: var(--color-foreground-muted);
  font-size: 11px;
}

/* ---- Hunk action bar ---- */
.hunk-action-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  height: 22px;
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.hunk-action-bar--ours {
  background: color-mix(in srgb, #2d9a2d 10%, var(--color-surface));
  border-left: 2px solid #2d9a2d;
}

.hunk-action-bar--theirs {
  background: color-mix(in srgb, #1e6fcc 10%, var(--color-surface));
  border-left: 2px solid #1e6fcc;
}

.hunk-btn {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s;
}

.hunk-btn--ours {
  background: color-mix(in srgb, #2d9a2d 25%, transparent);
  color: #7dd87d;
  border: 1px solid color-mix(in srgb, #2d9a2d 50%, transparent);
}

.hunk-btn--ours:hover {
  background: color-mix(in srgb, #2d9a2d 42%, transparent);
}

.hunk-btn--theirs {
  background: color-mix(in srgb, #1e6fcc 25%, transparent);
  color: #7ab4f5;
  border: 1px solid color-mix(in srgb, #1e6fcc 50%, transparent);
}

.hunk-btn--theirs:hover {
  background: color-mix(in srgb, #1e6fcc 42%, transparent);
}

.hunk-btn--discard {
  background: color-mix(in srgb, var(--color-error, #cc3333) 18%, transparent);
  color: color-mix(in srgb, var(--color-error, #cc3333) 80%, #fff);
  border: 1px solid color-mix(in srgb, var(--color-error, #cc3333) 40%, transparent);
}

.hunk-btn--discard:hover {
  background: color-mix(in srgb, var(--color-error, #cc3333) 32%, transparent);
}

.line-no {
  width: 44px;
  flex-shrink: 0;
  text-align: right;
  padding-right: 10px;
  color: var(--color-foreground-muted);
  font-size: 11px;
  opacity: 0.5;
  user-select: none;
}

.line-text {
  flex: 1;
  white-space: pre;
  overflow-x: visible;
  tab-size: 4;
  padding-right: 12px;
}
</style>
