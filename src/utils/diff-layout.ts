import type { DiffHunk, DiffLine } from "./commands";

export type DiffMinimapKind = "added" | "removed" | "modified";
export type DiffRowKind = DiffMinimapKind | null;

export interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
  kind: DiffRowKind;
  hunkIndex: number;
}

export interface DiffLayout {
  unifiedLines: DiffLine[];
  sideBySideRows: SideBySideRow[];
  unifiedHunkStarts: number[];
  sideBySideHunkStarts: number[];
  unifiedKinds: DiffRowKind[];
  sideBySideKinds: DiffRowKind[];
}

export interface DiffMinimapSegment {
  topPct: number;
  heightPct: number;
  kind: DiffMinimapKind;
}

function unifiedKind(line: DiffLine): DiffRowKind {
  if (line.lineType === "addition") return "added";
  if (line.lineType === "deletion") return "removed";
  return null;
}

function flushPairs(
  rows: SideBySideRow[],
  deletions: DiffLine[],
  additions: DiffLine[],
  hunkIndex: number
): void {
  const length = Math.max(deletions.length, additions.length);
  for (let index = 0; index < length; index++) {
    const left = deletions[index] ?? null;
    const right = additions[index] ?? null;
    rows.push({
      left,
      right,
      kind: left && right ? "modified" : left ? "removed" : "added",
      hunkIndex,
    });
  }
}

export function buildDiffLayout(hunks: readonly DiffHunk[]): DiffLayout {
  const unifiedLines: DiffLine[] = [];
  const sideBySideRows: SideBySideRow[] = [];
  const unifiedHunkStarts: number[] = [];
  const sideBySideHunkStarts: number[] = [];
  const unifiedKinds: DiffRowKind[] = [];

  for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
    const hunk = hunks[hunkIndex]!;
    unifiedHunkStarts.push(unifiedLines.length);
    sideBySideHunkStarts.push(sideBySideRows.length);

    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];

    for (const diffLine of hunk.lines) {
      unifiedLines.push(diffLine);
      unifiedKinds.push(unifiedKind(diffLine));

      if (diffLine.lineType === "deletion") {
        if (additions.length > 0) {
          flushPairs(sideBySideRows, deletions, additions, hunkIndex);
          deletions.length = 0;
          additions.length = 0;
        }
        deletions.push(diffLine);
      } else if (diffLine.lineType === "addition") {
        additions.push(diffLine);
      } else {
        flushPairs(sideBySideRows, deletions, additions, hunkIndex);
        deletions.length = 0;
        additions.length = 0;
        sideBySideRows.push({
          left: diffLine,
          right: diffLine,
          kind: null,
          hunkIndex,
        });
      }
    }

    flushPairs(sideBySideRows, deletions, additions, hunkIndex);
  }

  return {
    unifiedLines,
    sideBySideRows,
    unifiedHunkStarts,
    sideBySideHunkStarts,
    unifiedKinds,
    sideBySideKinds: sideBySideRows.map((row) => row.kind),
  };
}

export function buildMinimapSegments(kinds: readonly DiffRowKind[]): DiffMinimapSegment[] {
  if (kinds.length === 0) return [];

  const segments: DiffMinimapSegment[] = [];
  let runKind: DiffRowKind = null;
  let runStart = 0;

  for (let index = 0; index <= kinds.length; index++) {
    const kind = index < kinds.length ? kinds[index]! : null;
    if (kind === runKind) continue;

    if (runKind && index > runStart) {
      segments.push({
        topPct: (runStart * 100) / kinds.length,
        heightPct: Math.max(0.5, ((index - runStart) * 100) / kinds.length),
        kind: runKind,
      });
    }

    runKind = kind;
    runStart = index;
  }

  return segments;
}
