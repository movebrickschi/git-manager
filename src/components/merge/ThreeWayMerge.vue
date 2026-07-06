<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { Splitpanes, Pane } from "splitpanes";
import "splitpanes/dist/splitpanes.css";
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
const conflict = ref<{
  path: string;
  oursContent: string;
  theirsContent: string;
  baseContent: string;
} | null>(null);

// IDEA-style 3-way merge model:
// - originalRaw: the raw conflict file as written by git (immutable for the lifetime of one file)
//                Source of truth for left/right panels — never mutated by accept/discard actions.
// - hunkStates:  per-hunk decision — TWO independent booleans (one per side).
//                Acting on the left side never mutates the right side and vice versa.
// - resultContent: the editable merge result for the Monaco editor.
//                  Recomputed whenever hunkStates changes; user may also edit it freely.
//
// State combinations and what the center pane shows:
//   ours=F, theirs=F → unresolved (keep original <<<<<<<...>>>>>>> markers)
//   ours=T, theirs=F → only the ours block
//   ours=F, theirs=T → only the theirs block
//   ours=T, theirs=T → ours + theirs concatenated (Accept Both)
interface HunkSideState {
  ours: boolean;
  theirs: boolean;
}

// Git rewrites ours/theirs semantics depending on the operation. This struct
// captures what the markers actually mean for the user, so the UI can label
// the panels accurately and tell them which side holds *their own* code.
type MergeScenario =
  | "merge"
  | "rebase"
  | "stash-pop"
  | "cherry-pick"
  | "revert"
  | "unknown";

interface MergeContext {
  scenario: MergeScenario;
  scenarioLabel: string; // user-facing description
  oursLabel: string;
  theirsLabel: string;
  oursTooltip: string;
  theirsTooltip: string;
  yoursOn: "ours" | "theirs" | "unknown"; // which side holds the user's local code
  headerTag: string; // raw text after the first '<<<<<<<'
  footerTag: string; // raw text after the last '>>>>>>>'
}

const originalRaw = ref(""); // raw git conflict content; immutable for current file
const resultContent = ref(""); // editable merged result shown in Monaco
const hunkStates = ref<HunkSideState[]>([]); // index-aligned with hunks
const loading = ref(false);
const saving = ref(false);
const resolvedFiles = ref<string[]>([]);

// Conflict hunks parsed from originalRaw (the immutable source).
// resultStartLine is the 1-based line number inside originalRaw.
interface ConflictHunk {
  index: number;
  oursLines: string[];
  theirsLines: string[];
  resultStartLine: number;
}
const hunks = ref<ConflictHunk[]>([]);
const currentHunkIndex = ref(0);

// Segments for rendering side panels (always derived from originalRaw → constant view).
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
let monacoDisposables: MonacoNS.IDisposable[] = [];
let decorations: string[] = [];

// Panel refs used by prev/next navigation to keep left/center/right panes
// scrolled to the same hunk (IDEA-style).
const leftPanel = ref<HTMLElement | null>(null);
const rightPanel = ref<HTMLElement | null>(null);
const mergePanelsFrame = ref<HTMLElement | null>(null);
const connectorOverlay = ref({
  width: 0,
  height: 0,
  leftPath: "",
  rightPath: "",
});
let scrollSyncRaf = 0;
let connectorRaf = 0;

const MERGE_LINE_HEIGHT = 20;

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

// IDEA-style: segments are always derived from originalRaw, so resolving/accepting
// a hunk never causes the left/right panels to lose rows.
const segments = computed<MergeSegment[]>(() => {
  const raw = originalRaw.value;
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
      i++;
      lineNo++;
      while (i < lines.length && !lines[i]!.startsWith("=======")) {
        oursLines.push(lines[i]!);
        i++;
        lineNo++;
      }
      i++;
      lineNo++;
      while (i < lines.length && !lines[i]!.startsWith(">>>>>>>")) {
        theirsLines.push(lines[i]!);
        i++;
        lineNo++;
      }
      i++;
      lineNo++;
      result.push({ type: "hunk", index: hunkIdx++, oursLines, theirsLines });
      ctxStartLineNo = lineNo;
    } else {
      if (ctxLines.length === 0) ctxStartLineNo = lineNo;
      ctxLines.push(line);
      i++;
      lineNo++;
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

const currentHunk = computed(() => hunks.value[currentHunkIndex.value] ?? null);

// Unresolved count = max(hunks where neither side was accepted,
//                        raw '<<<<<<<' markers in resultContent).
// The first reflects button-driven decisions; the second catches manual edits in
// Monaco where the user may have added/removed conflict markers by hand.
const totalUnresolved = computed(() => {
  const fromStates = hunkStates.value.filter((s) => !s.ours && !s.theirs).length;
  const fromRaw = resultContent.value
    ? (resultContent.value.match(/^<{7}/gm) ?? []).length
    : 0;
  return Math.max(fromStates, fromRaw);
});

function stateOf(index: number): HunkSideState {
  return hunkStates.value[index] ?? { ours: false, theirs: false };
}

// Inspect originalRaw to figure out what git operation produced this conflict
// and which side holds the user's own (local, unstaged or stashed) code.
// See https://git-scm.com/docs/git-merge#_how_conflicts_are_presented for
// canonical ours/theirs semantics across operations.
function detectMergeContext(raw: string): MergeContext {
  const firstHeader = raw.match(/^<{7}\s*(.*)$/m);
  const allFooters = [...raw.matchAll(/^>{7}\s*(.*)$/gm)];
  const lastFooter = allFooters.length > 0 ? allFooters[allFooters.length - 1] : null;
  const headerTag = (firstHeader?.[1] ?? "").trim();
  const footerTag = (lastFooter?.[1] ?? "").trim();

  // Helper: is a string a git SHA (7+ hex chars)?
  const isSha = (s: string) => /^[0-9a-f]{7,40}$/i.test(s);

  // Pattern matching (order matters: more specific first)
  // 1) stash pop / apply: Updated upstream + Stashed changes
  if (/^Updated upstream$/i.test(headerTag) && /^Stashed changes$/i.test(footerTag)) {
    return {
      scenario: "stash-pop",
      scenarioLabel: "Git 搁置弹出 / 应用",
      oursLabel: "左侧 · 当前工作树（拉取后的远端）",
      theirsLabel: "右侧 · 你搁置起来的本地修改",
      oursTooltip:
        "搁置弹出场景：左侧 = 你工作树现有的内容（通常是拉取后的远端最新版）",
      theirsTooltip:
        "搁置弹出场景：右侧 = 你之前搁置起来的本地未提交修改（这就是你写的代码）",
      yoursOn: "theirs",
      headerTag,
      footerTag,
    };
  }

  // 2) merge / pull (non-rebase): <<<<<<< HEAD ... >>>>>>> <branch-or-sha>
  if (/^HEAD$/i.test(headerTag) || /^HEAD\b/.test(headerTag)) {
    const otherSide = footerTag || "incoming";
    return {
      scenario: "merge",
      scenarioLabel: "Git 合并 / 拉取（非变基）",
      oursLabel: `左侧 · HEAD（你当前的分支）`,
      theirsLabel: `右侧 · ${otherSide}（要合入的分支）`,
      oursTooltip: "合并 / 拉取场景：左侧 = 你当前分支已有的提交（这就是你写的代码）",
      theirsTooltip: `合并 / 拉取场景：右侧 = 要被合并进来的对方分支（${otherSide}）`,
      yoursOn: "ours",
      headerTag,
      footerTag,
    };
  }

  // 3) rebase: header is a commit SHA (the upstream tip), footer is your local
  //    branch / commit being replayed.
  if (isSha(headerTag)) {
    return {
      scenario: "rebase",
      scenarioLabel: "Git 变基 / 变基拉取",
      oursLabel: `左侧 · ${headerTag}（被变基到的目标分支）`,
      theirsLabel: `右侧 · ${footerTag || "你的本地提交"}（你的提交被重放到此处）`,
      oursTooltip:
        "变基场景：左侧 = 你被变基到的目标（远端上游）— 注意这不是你写的代码",
      theirsTooltip:
        "变基场景：右侧 = 你的本地提交（Git 把它重放到上游之上）— 这才是你写的代码",
      yoursOn: "theirs",
      headerTag,
      footerTag,
    };
  }

  // 4) cherry-pick: <<<<<<< HEAD ... >>>>>>> <message of cherry-picked commit>
  //    Handled by the merge branch above (header == HEAD). The literal "ours"/"theirs"
  //    convention here is the merge-tool style:
  if (/^ours$/i.test(headerTag) && /^theirs$/i.test(footerTag)) {
    return {
      scenario: "cherry-pick",
      scenarioLabel: "Git 拣选（或自定义合并驱动）",
      oursLabel: "左侧 · 当前分支",
      theirsLabel: "右侧 · 被引入的提交",
      oursTooltip: "拣选场景：左侧 = 你当前分支（你写的代码）",
      theirsTooltip: "拣选场景：右侧 = 被拣选进来的提交",
      yoursOn: "ours",
      headerTag,
      footerTag,
    };
  }

  // 5) Fallback — show raw markers so power-users can still figure it out.
  return {
    scenario: "unknown",
    scenarioLabel: "未知操作（无法识别冲突标记）",
    oursLabel: headerTag ? `左侧 · ${headerTag}` : "左侧",
    theirsLabel: footerTag ? `右侧 · ${footerTag}` : "右侧",
    oursTooltip: "无法识别 Git 操作类型，请根据冲突标记后缀自行判断",
    theirsTooltip: "无法识别 Git 操作类型，请根据冲突标记后缀自行判断",
    yoursOn: "unknown",
    headerTag,
    footerTag,
  };
}

const mergeContext = computed<MergeContext>(() => detectMergeContext(originalRaw.value));

// Build the merged file from originalRaw + hunkStates.
// Unresolved hunks keep their original <<<<<<<...>>>>>>> markers so git still
// recognizes the file as conflicted until everything is resolved.
function recomputeResult(): string {
  const raw = originalRaw.value;
  if (!raw) return "";
  const lines = raw.split("\n");
  const out: string[] = [];
  let i = 0;
  let hunkIdx = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("<<<<<<<")) {
      const headerLine = line;
      const oursStart = i + 1;
      let sep = oursStart;
      while (sep < lines.length && !lines[sep]!.startsWith("=======")) sep++;
      const theirsStart = sep + 1;
      let end = theirsStart;
      while (end < lines.length && !lines[end]!.startsWith(">>>>>>>")) end++;
      const oursLines = lines.slice(oursStart, sep);
      const theirsLines = lines.slice(theirsStart, end);
      const footerLine = end < lines.length ? lines[end]! : ">>>>>>>";

      const state = stateOf(hunkIdx);
      hunkIdx++;
      if (state.ours && state.theirs) {
        out.push(...oursLines, ...theirsLines);
      } else if (state.ours) {
        out.push(...oursLines);
      } else if (state.theirs) {
        out.push(...theirsLines);
      } else {
        // neither side accepted yet — keep original markers verbatim
        out.push(headerLine);
        out.push(...oursLines);
        if (sep < lines.length) out.push(lines[sep]!);
        out.push(...theirsLines);
        out.push(footerLine);
      }
      i = end + 1;
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join("\n");
}

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
  hunkStates.value = [];
  currentHunkIndex.value = 0;
  try {
    const [conflictData, raw] = await Promise.all([
      commands.getConflictContent(repoStore.activeRepo.path, filePath),
      commands.getWorkingFileContent(repoStore.activeRepo.path, filePath),
    ]);
    conflict.value = conflictData;
    originalRaw.value = raw;
    hunks.value = parseConflictHunks(raw);
    hunkStates.value = hunks.value.map(() => ({ ours: false, theirs: false }));
    resultContent.value = recomputeResult();
    currentHunkIndex.value = 0;

    await nextTick();
    if (monacoEditor) {
      monacoEditor.setValue(resultContent.value);
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
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    vue: "html",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    md: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
    sh: "shell",
    bash: "shell",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    xml: "xml",
    svg: "xml",
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

  // Manual edits in the center pane should NOT clobber hunkStates — but they DO
  // count for the "unresolved badge" via the regex fallback in totalUnresolved.
  // The left/right panels still read from originalRaw, so they remain stable.
  monacoDisposables.push(monacoEditor.onDidChangeModelContent(() => {
    resultContent.value = monacoEditor!.getValue();
    scheduleConnectorUpdate();
  }));

  monacoDisposables.push(monacoEditor.onDidScrollChange((e) => {
    if (e.scrollTopChanged || e.scrollHeightChanged) {
      scheduleEditorScrollSync();
    } else if (e.scrollLeftChanged) {
      scheduleConnectorUpdate();
    }
  }));

  updateDecorations();
  if (hunks.value.length > 0) {
    scrollEditorToHunk(currentHunkIndex.value);
  } else {
    scheduleEditorScrollSync();
  }
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

// Compute the 1-based line number of a hunk inside the *current* result content.
// Works regardless of hunk state — replays the same walk as recomputeResult()
// and stops at the requested hunk so we always know where to scroll the center
// pane, even for hunks that no longer carry '<<<<<<<' markers.
function findHunkLineInResult(targetIndex: number): number | null {
  const raw = originalRaw.value;
  if (!raw) return null;
  const lines = raw.split("\n");
  let i = 0;
  let hunkIdx = 0;
  let outLine = 1;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("<<<<<<<")) {
      if (hunkIdx === targetIndex) return outLine;
      const oursStart = i + 1;
      let sep = oursStart;
      while (sep < lines.length && !lines[sep]!.startsWith("=======")) sep++;
      const theirsStart = sep + 1;
      let end = theirsStart;
      while (end < lines.length && !lines[end]!.startsWith(">>>>>>>")) end++;
      const oursLen = sep - oursStart;
      const theirsLen = end - theirsStart;
      const state = stateOf(hunkIdx);
      let consumed: number;
      if (state.ours && state.theirs) consumed = oursLen + theirsLen;
      else if (state.ours) consumed = oursLen;
      else if (state.theirs) consumed = theirsLen;
      else consumed = 1 + oursLen + 1 + theirsLen + 1;
      outLine += consumed;
      hunkIdx++;
      i = end + 1;
    } else {
      outLine++;
      i++;
    }
  }
  return null;
}

// Scroll one side panel so the requested hunk's action-bar sits near the top.
// Side panels keep their full original content even after accept/discard, so
// every hunk is always present and addressable via `[data-hunk-index]`.
// Uses getBoundingClientRect so we don't depend on `.side-panel` being a
// positioned ancestor (`offsetTop` would otherwise resolve against `<body>`).
// Returns true when the hunk node was found and the scroll was applied —
// caller uses this to retry on the next animation frame when the v-for
// hasn't rendered the row yet (large files only).
function scrollSidePanelToHunk(panel: HTMLElement | null, index: number): boolean {
  if (!panel) return false;
  const node = panel.querySelector<HTMLElement>(`[data-hunk-index="${index}"]`);
  if (!node) return false;
  const panelRect = panel.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const top = panel.scrollTop + (nodeRect.top - panelRect.top) - 12;
  // Instant scroll keeps left/right in lockstep with Monaco's revealLineInCenter
  // (Monaco does not animate). Smooth here desyncs the three panes visually.
  panel.scrollTop = Math.max(0, top);
  return true;
}

function clampScrollTop(panel: HTMLElement, value: number): number {
  const max = Math.max(0, panel.scrollHeight - panel.clientHeight);
  return Math.min(max, Math.max(0, value));
}

function sideHunkTop(panel: HTMLElement, index: number): number | null {
  const node = panel.querySelector<HTMLElement>(`[data-hunk-index="${index}"]`);
  if (!node) return null;
  const panelRect = panel.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  return panel.scrollTop + (nodeRect.top - panelRect.top);
}

function resultHunkLineStarts(): number[] {
  return hunks.value.map((h) => findHunkLineInResult(h.index) ?? h.resultStartLine);
}

function hunkIndexForResultLine(line: number): number | null {
  const starts = resultHunkLineStarts();
  if (starts.length === 0) return null;
  let best = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! <= line) best = i;
    else break;
  }
  return best;
}

function nearestHunkIndexForResultLine(line: number): number | null {
  const starts = resultHunkLineStarts();
  if (starts.length === 0) return null;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < starts.length; i++) {
    const distance = Math.abs(starts[i]! - line);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

function syncSidePanelToResultLine(panel: HTMLElement | null, resultLine: number): void {
  if (!panel || hunks.value.length === 0) return;
  const starts = resultHunkLineStarts();
  const firstLine = starts[0] ?? 1;

  if (resultLine < firstLine) {
    panel.scrollTop = clampScrollTop(panel, (resultLine - 1) * MERGE_LINE_HEIGHT);
    return;
  }

  const beforeIdx = hunkIndexForResultLine(resultLine);
  if (beforeIdx == null) return;

  const beforeLine = starts[beforeIdx]!;
  const beforeTop = sideHunkTop(panel, beforeIdx);
  if (beforeTop == null) return;

  const afterIdx = beforeIdx + 1;
  const afterLine = starts[afterIdx];
  const afterTop = afterLine == null ? null : sideHunkTop(panel, afterIdx);

  let targetTop: number;
  if (afterLine != null && afterTop != null && afterLine > beforeLine) {
    const ratio = (resultLine - beforeLine) / (afterLine - beforeLine);
    targetTop = beforeTop + (afterTop - beforeTop) * ratio;
  } else {
    targetTop = beforeTop + (resultLine - beforeLine) * MERGE_LINE_HEIGHT;
  }

  panel.scrollTop = clampScrollTop(panel, targetTop - 12);
}

function syncSidePanelsToEditorScroll(): void {
  if (!monacoEditor) return;
  const topLine = Math.max(
    1,
    Math.floor(monacoEditor.getScrollTop() / MERGE_LINE_HEIGHT) + 1
  );
  syncSidePanelToResultLine(leftPanel.value, topLine);
  syncSidePanelToResultLine(rightPanel.value, topLine);

  const visibleLines = Math.max(1, Math.floor(monacoEditor.getLayoutInfo().height / MERGE_LINE_HEIGHT));
  const activeIndex = nearestHunkIndexForResultLine(topLine + Math.floor(visibleLines * 0.35));
  if (activeIndex != null && activeIndex !== currentHunkIndex.value) {
    currentHunkIndex.value = activeIndex;
  }
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const direction = x2 >= x1 ? 1 : -1;
  const dx = Math.max(28, Math.abs(x2 - x1) * 0.45);
  const c1x = x1 + direction * dx;
  const c2x = x2 - direction * dx;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${c1x.toFixed(1)} ${y1.toFixed(
    1
  )}, ${c2x.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function updateConnectorOverlay(): void {
  const frame = mergePanelsFrame.value;
  const editor = editorContainer.value;
  if (!frame || !editor || !monacoEditor || !hunks.value[currentHunkIndex.value]) {
    connectorOverlay.value = { width: 0, height: 0, leftPath: "", rightPath: "" };
    return;
  }

  const line = findHunkLineInResult(currentHunkIndex.value);
  if (line == null) {
    connectorOverlay.value = { width: 0, height: 0, leftPath: "", rightPath: "" };
    return;
  }

  const frameRect = frame.getBoundingClientRect();
  const editorRect = editor.getBoundingClientRect();
  const editorLineTop = monacoEditor.getTopForLineNumber(line) - monacoEditor.getScrollTop();
  const centerY = editorRect.top - frameRect.top + editorLineTop + MERGE_LINE_HEIGHT / 2;
  const centerLeftX = editorRect.left - frameRect.left + 8;
  const centerRightX = editorRect.right - frameRect.left - 8;

  const leftNode = leftPanel.value?.querySelector<HTMLElement>(
    `[data-hunk-index="${currentHunkIndex.value}"]`
  );
  const rightNode = rightPanel.value?.querySelector<HTMLElement>(
    `[data-hunk-index="${currentHunkIndex.value}"]`
  );
  const visiblePad = 80;
  const inVerticalRange = (y: number) => y > -visiblePad && y < frameRect.height + visiblePad;
  let leftPath = "";
  let rightPath = "";

  if (leftNode) {
    const rect = leftNode.getBoundingClientRect();
    const sideY = rect.top - frameRect.top + rect.height / 2;
    const sideX = rect.right - frameRect.left;
    if (inVerticalRange(sideY) && inVerticalRange(centerY)) {
      leftPath = curvePath(sideX, sideY, centerLeftX, centerY);
    }
  }

  if (rightNode) {
    const rect = rightNode.getBoundingClientRect();
    const sideY = rect.top - frameRect.top + rect.height / 2;
    const sideX = rect.left - frameRect.left;
    if (inVerticalRange(sideY) && inVerticalRange(centerY)) {
      rightPath = curvePath(sideX, sideY, centerRightX, centerY);
    }
  }

  connectorOverlay.value = {
    width: frameRect.width,
    height: frameRect.height,
    leftPath,
    rightPath,
  };
}

function scheduleConnectorUpdate(): void {
  if (connectorRaf) return;
  connectorRaf = requestAnimationFrame(() => {
    connectorRaf = 0;
    updateConnectorOverlay();
  });
}

function scheduleEditorScrollSync(): void {
  if (scrollSyncRaf) return;
  scrollSyncRaf = requestAnimationFrame(() => {
    scrollSyncRaf = 0;
    syncSidePanelsToEditorScroll();
    updateConnectorOverlay();
  });
}

// IDEA-style synchronized navigation: clicking prev/next moves left, center,
// and right panes to the same hunk so the user never has to hunt for it.
// The center pane follows even for already-accepted hunks (no '<<<' markers
// left) by mapping the hunk index to its line in the current result content.
//
// All three panes use *instant* positioning so they stay locked together —
// smooth scrolling caused desync between Monaco (instant) and side panels
// (animated), which read as "laggy / not aligned".
function scrollEditorToHunk(index: number) {
  if (!hunks.value[index]) return;
  if (monacoEditor) {
    const line = findHunkLineInResult(index);
    if (line != null) monacoEditor.revealLineInCenter(line);
  }
  // First attempt synchronously — fast path for files small enough that the
  // v-for has already laid out by the time the user clicks prev/next.
  const leftOk = scrollSidePanelToHunk(leftPanel.value, index);
  const rightOk = scrollSidePanelToHunk(rightPanel.value, index);
  if (leftOk && rightOk) {
    scheduleConnectorUpdate();
    return;
  }
  // Fallback for files where the hunk node hasn't been rendered yet (e.g. the
  // very first call right after loadFile completes on a 10k-line file).
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    scrollSidePanelToHunk(leftPanel.value, index);
    scrollSidePanelToHunk(rightPanel.value, index);
    updateConnectorOverlay();
  });
  scheduleConnectorUpdate();
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
// Accept / discard — IDEA model with INDEPENDENT side states.
// Actions on one side never touch the other side.
// ---------------------------------------------------------------------------
function setSideState(index: number, side: "ours" | "theirs", value: boolean) {
  if (index < 0 || index >= hunks.value.length) return;
  const arr = hunkStates.value.map((s, i) =>
    i === index ? { ...s, [side]: value } : s
  );
  hunkStates.value = arr;
  syncResultToEditor();
}

function syncResultToEditor() {
  const recomputed = recomputeResult();
  resultContent.value = recomputed;
  if (monacoEditor && monacoEditor.getValue() !== recomputed) {
    // Preserve cursor as best as we can; setValue resets selection but that's
    // acceptable for accept/discard actions.
    monacoEditor.setValue(recomputed);
  }
  updateDecorations();
}

// Per-side toggle button: clicking "accept this side" toggles only that side.
// Clicking again on the same side cancels just that side's acceptance.
function toggleSide(index: number, side: "ours" | "theirs") {
  if (!hunks.value[index]) return;
  currentHunkIndex.value = index;
  const current = stateOf(index)[side];
  setSideState(index, side, !current);
  scrollEditorToHunk(index);
}

// Explicit "discard this side" — clears that side's acceptance but never affects
// the opposite side. Equivalent to setSideState(index, side, false).
function discardSide(index: number, side: "ours" | "theirs") {
  if (!hunks.value[index]) return;
  currentHunkIndex.value = index;
  setSideState(index, side, false);
  scrollEditorToHunk(index);
}

function acceptOurs() {
  if (!currentHunk.value) return;
  toggleSide(currentHunk.value.index, "ours");
}

function acceptTheirs() {
  if (!currentHunk.value) return;
  toggleSide(currentHunk.value.index, "theirs");
}

// "Accept both" sets both sides to true; clicking again clears both.
function acceptBoth() {
  if (!currentHunk.value) return;
  const idx = currentHunk.value.index;
  const s = stateOf(idx);
  const both = s.ours && s.theirs;
  const arr = hunkStates.value.map((st, i) =>
    i === idx ? { ours: !both, theirs: !both } : st
  );
  hunkStates.value = arr;
  syncResultToEditor();
  scrollEditorToHunk(idx);
}

// Toolbar-level: bulk accept all hunks on one side (additive — does NOT clear
// the opposite side, so users that already accepted some on the other side
// effectively get an "accept both" outcome on those hunks).
function acceptAllOurs() {
  if (hunks.value.length === 0) return;
  hunkStates.value = hunkStates.value.map((s) => ({ ...s, ours: true }));
  syncResultToEditor();
}

function acceptAllTheirs() {
  if (hunks.value.length === 0) return;
  hunkStates.value = hunkStates.value.map((s) => ({ ...s, theirs: true }));
  syncResultToEditor();
}

function resetAll() {
  if (hunks.value.length === 0) return;
  hunkStates.value = hunks.value.map(() => ({ ours: false, theirs: false }));
  syncResultToEditor();
  scrollEditorToHunk(currentHunkIndex.value);
}

function sideBadgeText(index: number, side: "ours" | "theirs"): string {
  const s = stateOf(index)[side];
  return s ? "本侧已采用" : "本侧未采用";
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

function onPanelResize() {
  requestAnimationFrame(() => {
    monacoEditor?.layout();
    scheduleEditorScrollSync();
  });
}

function onWindowResize() {
  scheduleEditorScrollSync();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
onMounted(async () => {
  window.addEventListener("resize", onWindowResize);
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
  window.removeEventListener("resize", onWindowResize);
  if (scrollSyncRaf) cancelAnimationFrame(scrollSyncRaf);
  if (connectorRaf) cancelAnimationFrame(connectorRaf);
  monacoDisposables.forEach((d) => d.dispose());
  monacoDisposables = [];
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
          <svg
            v-if="resolvedFiles.includes(f)"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
          >
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
        <!-- Scenario banner: explains git operation + where the user's own code lives -->
        <div
          v-if="hasConflicts && mergeContext.scenario !== 'unknown'"
          class="scenario-banner"
          :class="`scenario-${mergeContext.scenario}`"
        >
          <span class="scenario-tag">{{ mergeContext.scenarioLabel }}</span>
          <span class="scenario-text">
            <template v-if="mergeContext.yoursOn === 'ours'">
              你写的代码在 <strong>左栏</strong>
            </template>
            <template v-else-if="mergeContext.yoursOn === 'theirs'">
              你写的代码在 <strong>右栏</strong>（{{ mergeContext.scenarioLabel }} 时 Git 会调整左右语义）
            </template>
            <template v-else>
              无法自动判定哪一侧是你的代码 — 请按冲突标记后缀自行判断
            </template>
          </span>
        </div>

        <!-- Toolbar -->
        <div class="merge-toolbar">
          <!-- File path -->
          <span class="file-path" :title="currentFile">{{ currentFile }}</span>
          <div class="toolbar-sep" />

          <!-- Accept all shortcuts -->
          <button
            class="tbtn tbtn-green"
            title="接受所有左侧（通常是 HEAD）— 拉取/合并时是你当前分支的版本；变基时是目标分支"
            @click="acceptAllOurs"
          >
            全部接受左侧
          </button>
          <button
            class="tbtn tbtn-blue"
            title="接受所有右侧（传入版本）— 拉取/合并时是远端要合入的版本；变基时是你的本地提交"
            @click="acceptAllTheirs"
          >
            全部接受右侧
          </button>
          <button
            class="tbtn"
            title="所有冲突块恢复到未解决状态（左右栏不会变化，只是中栏重新出现所有冲突标记）"
            :disabled="hunks.length === 0"
            @click="resetAll"
          >
            全部重置
          </button>
          <div class="toolbar-sep" />

          <!-- Hunk navigation -->
          <template v-if="hasConflicts">
            <button class="tbtn" :disabled="currentHunkIndex === 0" @click="prevHunk">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
              上一处
            </button>
            <span class="hunk-counter">{{ currentHunkIndex + 1 }} / {{ hunks.length }}</span>
            <button class="tbtn" :disabled="currentHunkIndex >= hunks.length - 1" @click="nextHunk">
              下一处
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <div class="toolbar-sep" />
            <!-- Per-hunk accept -->
            <button class="tbtn tbtn-green" @click="acceptOurs">← 接受左侧</button>
            <button class="tbtn" @click="acceptBoth">接受两者</button>
            <button class="tbtn tbtn-blue" @click="acceptTheirs">接受右侧 →</button>
            <div class="toolbar-sep" />
          </template>

          <!-- Unresolved count badge -->
          <span v-if="totalUnresolved > 0" class="unresolved-badge">
            {{ totalUnresolved }} 处未解决
          </span>
          <span v-else-if="!loading" class="resolved-badge">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
            >
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

        <!-- Three panels (resizable via Splitpanes) -->
        <div ref="mergePanelsFrame" class="merge-panels-frame">
        <Splitpanes class="default-theme merge-panels" @resize="onPanelResize">
          <!-- Left: Yours (read-only, segment-based) -->
          <Pane :size="33" :min-size="15">
          <div class="pane-wrapper">
            <div
              class="panel-head yours"
              :title="mergeContext.oursTooltip"
            >
              <span>← {{ mergeContext.oursLabel }}</span>
              <span
                v-if="mergeContext.yoursOn === 'ours'"
                class="yours-badge"
                title="你写的代码在这一栏"
              >你的代码</span>
              <span class="head-lines">{{ hunks.length }} 处冲突</span>
            </div>
            <div ref="leftPanel" class="side-panel" @scroll="scheduleConnectorUpdate">
            <div class="side-panel-inner">
            <template
              v-for="seg in segments"
              :key="seg.type === 'hunk' ? 'lh' + seg.index : 'lc' + seg.startLineNo"
            >
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
              <!-- Hunk: ours lines with action buttons + state badge -->
              <template v-else-if="seg.type === 'hunk'">
                <div
                  class="hunk-action-bar hunk-action-bar--ours"
                  :class="{ 'side-accepted': stateOf(seg.index).ours }"
                  :data-hunk-index="seg.index"
                >
                  <button
                    class="hunk-btn hunk-btn--ours"
                    :class="{ active: stateOf(seg.index).ours }"
                    :title="
                      stateOf(seg.index).ours
                        ? '本侧已采用 — 点击取消本侧采用（不影响右侧）'
                        : '采用左侧 → 把这段加入到中栏结果（不影响右侧）'
                    "
                    @click="toggleSide(seg.index, 'ours')"
                  >
                    {{ stateOf(seg.index).ours ? '✓ 本侧已采用' : '← 采用此处' }}
                  </button>
                  <button
                    class="hunk-btn hunk-btn--discard"
                    :disabled="!stateOf(seg.index).ours"
                    :title="
                      stateOf(seg.index).ours
                        ? '取消本侧采用 — 把这段从中栏结果移除（不影响右侧）'
                        : '本侧未被采用，无需丢弃'
                    "
                    @click="discardSide(seg.index, 'ours')"
                  >
                    丢弃本侧
                  </button>
                  <span class="hunk-state-badge">{{ sideBadgeText(seg.index, 'ours') }}</span>
                </div>
                <div
                  v-for="(line, i) in seg.oursLines"
                  :key="'lo' + seg.index + '_' + i"
                  class="code-line ours-line"
                  :class="{ 'line-accepted': stateOf(seg.index).ours }"
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
            </div>
          </div>
          </Pane>

          <!-- Center: Monaco Editor -->
          <Pane :size="34" :min-size="20">
          <div class="pane-wrapper">
            <div class="panel-head result">
              <span>合并结果（可编辑 · 支持复制粘贴）</span>
            </div>
            <div class="editor-panel">
              <div ref="editorContainer" class="monaco-container" />
            </div>
          </div>
          </Pane>

          <!-- Right: Theirs (read-only, segment-based) -->
          <Pane :size="33" :min-size="15">
          <div class="pane-wrapper">
            <div
              class="panel-head theirs"
              :title="mergeContext.theirsTooltip"
            >
              <span>{{ mergeContext.theirsLabel }} →</span>
              <span
                v-if="mergeContext.yoursOn === 'theirs'"
                class="yours-badge"
                title="你写的代码在这一栏"
              >你的代码</span>
              <span class="head-lines">{{ hunks.length }} 处冲突</span>
            </div>
            <div ref="rightPanel" class="side-panel" @scroll="scheduleConnectorUpdate">
            <div class="side-panel-inner">
            <template
              v-for="seg in segments"
              :key="seg.type === 'hunk' ? 'rh' + seg.index : 'rc' + seg.startLineNo"
            >
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
              <!-- Hunk: theirs lines with action buttons + state badge -->
              <template v-else-if="seg.type === 'hunk'">
                <div
                  class="hunk-action-bar hunk-action-bar--theirs"
                  :class="{ 'side-accepted': stateOf(seg.index).theirs }"
                  :data-hunk-index="seg.index"
                >
                  <button
                    class="hunk-btn hunk-btn--theirs"
                    :class="{ active: stateOf(seg.index).theirs }"
                    :title="
                      stateOf(seg.index).theirs
                        ? '本侧已采用 — 点击取消本侧采用（不影响左侧）'
                        : '采用右侧 → 把这段加入到中栏结果（不影响左侧）'
                    "
                    @click="toggleSide(seg.index, 'theirs')"
                  >
                    {{ stateOf(seg.index).theirs ? '✓ 本侧已采用' : '采用此处 →' }}
                  </button>
                  <button
                    class="hunk-btn hunk-btn--discard"
                    :disabled="!stateOf(seg.index).theirs"
                    :title="
                      stateOf(seg.index).theirs
                        ? '取消本侧采用 — 把这段从中栏结果移除（不影响左侧）'
                        : '本侧未被采用，无需丢弃'
                    "
                    @click="discardSide(seg.index, 'theirs')"
                  >
                    丢弃本侧
                  </button>
                  <span class="hunk-state-badge">{{ sideBadgeText(seg.index, 'theirs') }}</span>
                </div>
                <div
                  v-for="(line, i) in seg.theirsLines"
                  :key="'rt' + seg.index + '_' + i"
                  class="code-line theirs-line"
                  :class="{ 'line-accepted': stateOf(seg.index).theirs }"
                >
                  <span class="line-no">{{ i + 1 }}</span>
                  <span class="line-text">{{ line }}</span>
                </div>
                <div
                  v-if="seg.theirsLines.length === 0"
                  class="code-line theirs-line empty-hunk-line"
                >
                  <span class="line-no" />
                  <span class="line-text empty-hint">（无内容）</span>
                </div>
              </template>
            </template>
            </div>
            </div>
          </div>
          </Pane>
        </Splitpanes>
        <svg
          v-if="connectorOverlay.leftPath || connectorOverlay.rightPath"
          class="merge-connectors"
          :viewBox="`0 0 ${connectorOverlay.width} ${connectorOverlay.height}`"
          preserveAspectRatio="none"
        >
          <defs>
            <marker
              id="merge-connector-arrow-ours"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" class="merge-connector-arrow ours" />
            </marker>
            <marker
              id="merge-connector-arrow-theirs"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" class="merge-connector-arrow theirs" />
            </marker>
          </defs>
          <path
            v-if="connectorOverlay.leftPath"
            class="merge-connector-path merge-connector-path--ours"
            :d="connectorOverlay.leftPath"
            marker-end="url(#merge-connector-arrow-ours)"
          />
          <path
            v-if="connectorOverlay.rightPath"
            class="merge-connector-path merge-connector-path--theirs"
            :d="connectorOverlay.rightPath"
            marker-end="url(#merge-connector-arrow-theirs)"
          />
        </svg>
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

/* ---- Scenario banner ---- */
.scenario-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.scenario-banner.scenario-merge {
  background: color-mix(in srgb, #2d9a2d 12%, var(--color-surface));
  color: #7dd87d;
}

.scenario-banner.scenario-rebase,
.scenario-banner.scenario-stash-pop {
  background: color-mix(in srgb, #d97a1c 18%, var(--color-surface));
  color: #f0b265;
}

.scenario-banner.scenario-cherry-pick {
  background: color-mix(in srgb, #b56fd9 14%, var(--color-surface));
  color: #d3a3f0;
}

.scenario-tag {
  font-weight: 700;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 20%, transparent);
  letter-spacing: 0.3px;
}

.scenario-text strong {
  font-weight: 700;
  color: #ffd964;
  padding: 0 2px;
}

.yours-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
  background: #ffd964;
  color: #2a1a00;
  margin-left: 6px;
  letter-spacing: 0.3px;
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

/* ---- Column headers (now inside each Pane) ---- */
.pane-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
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
.merge-panels-frame {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.merge-panels {
  height: 100%;
  overflow: hidden;
  min-height: 0;
}

.merge-connectors {
  position: absolute;
  inset: 0;
  z-index: 5;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.merge-connector-path {
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.9;
  filter: drop-shadow(0 0 2px rgb(0 0 0 / 0.45));
}

.merge-connector-path--ours {
  stroke: #58c971;
}

.merge-connector-path--theirs {
  stroke: #6faefc;
}

.merge-connector-arrow.ours {
  fill: #58c971;
}

.merge-connector-arrow.theirs {
  fill: #6faefc;
}

.side-panel {
  height: 100%;
  width: 100%;
  overflow: auto;
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 20px;
  background: var(--color-background);
  user-select: text;
  cursor: text;
}

.side-panel-inner {
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: 100%;
}

.side-panel ::selection {
  background: var(--color-primary, #007acc);
  color: #fff;
}

.editor-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.monaco-container {
  flex: 1;
  height: 100%;
  user-select: text;
}

.code-line {
  display: flex;
  min-height: 20px;
  line-height: 20px;
  flex-shrink: 0;
}

.code-line.ours-line {
  background: color-mix(in srgb, #2d9a2d 18%, transparent);
}

.code-line.theirs-line {
  background: color-mix(in srgb, #1e6fcc 18%, transparent);
}

/* When this side has been accepted into the merged result, brighten it.
   The opposite side is NOT visually penalized — left/right are independent. */
.code-line.line-accepted {
  filter: brightness(1.25);
  box-shadow: inset 3px 0 0 currentColor;
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

/* When this side's accept toggle is on, brighten the action bar.
   The opposite side is independent and not affected. */
.hunk-action-bar--ours.side-accepted {
  background: color-mix(in srgb, #2d9a2d 22%, var(--color-surface));
}

.hunk-action-bar--theirs.side-accepted {
  background: color-mix(in srgb, #1e6fcc 22%, var(--color-surface));
}

.hunk-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.hunk-state-badge {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  opacity: 0.7;
  padding: 1px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
}

.hunk-btn.active {
  outline: 1px solid currentColor;
  outline-offset: -2px;
  filter: brightness(1.15);
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
  user-select: text;
}
</style>
