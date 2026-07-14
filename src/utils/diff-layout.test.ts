import { describe, expect, it } from "vitest";
import type { DiffHunk, DiffLine } from "./commands";
import { buildDiffLayout, buildMinimapSegments } from "./diff-layout";

function line(
  lineType: DiffLine["lineType"],
  content: string,
  oldLineNo: number | null,
  newLineNo: number | null
): DiffLine {
  return { lineType, content, oldLineNo, newLineNo };
}

function hunk(lines: DiffLine[]): DiffHunk {
  return {
    oldStart: 1,
    oldLines: lines.filter((item) => item.lineType !== "addition").length,
    newStart: 1,
    newLines: lines.filter((item) => item.lineType !== "deletion").length,
    header: "",
    lines,
  };
}

describe("buildDiffLayout", () => {
  it("keeps context lines aligned in both panes", () => {
    const context = line("context", "same", 1, 1);

    const layout = buildDiffLayout([hunk([context])]);

    expect(layout.unifiedLines).toEqual([context]);
    expect(layout.sideBySideRows).toEqual([
      { left: context, right: context, kind: null, hunkIndex: 0 },
    ]);
    expect(layout.unifiedHunkStarts).toEqual([0]);
    expect(layout.sideBySideHunkStarts).toEqual([0]);
  });

  it("pairs balanced replacement lines and marks them modified", () => {
    const deletedOne = line("deletion", "old one", 1, null);
    const deletedTwo = line("deletion", "old two", 2, null);
    const addedOne = line("addition", "new one", null, 1);
    const addedTwo = line("addition", "new two", null, 2);

    const layout = buildDiffLayout([hunk([deletedOne, deletedTwo, addedOne, addedTwo])]);

    expect(layout.sideBySideRows).toEqual([
      {
        left: deletedOne,
        right: addedOne,
        kind: "modified",
        hunkIndex: 0,
      },
      {
        left: deletedTwo,
        right: addedTwo,
        kind: "modified",
        hunkIndex: 0,
      },
    ]);
    expect(layout.unifiedKinds).toEqual(["removed", "removed", "added", "added"]);
    expect(layout.sideBySideKinds).toEqual(["modified", "modified"]);
  });

  it("keeps empty placeholders for unbalanced replacement lines", () => {
    const deletedOne = line("deletion", "old one", 1, null);
    const deletedTwo = line("deletion", "old two", 2, null);
    const deletedThree = line("deletion", "old three", 3, null);
    const addedOne = line("addition", "new one", null, 1);

    const layout = buildDiffLayout([hunk([deletedOne, deletedTwo, deletedThree, addedOne])]);

    expect(layout.sideBySideRows).toHaveLength(3);
    expect(layout.sideBySideRows[1]).toEqual({
      left: deletedTwo,
      right: null,
      kind: "removed",
      hunkIndex: 0,
    });
    expect(layout.sideBySideRows[2]).toEqual({
      left: deletedThree,
      right: null,
      kind: "removed",
      hunkIndex: 0,
    });
  });

  it("tracks distinct hunk starts for unified and side-by-side rows", () => {
    const first = hunk([
      line("context", "before", 1, 1),
      line("deletion", "old", 2, null),
      line("addition", "new", null, 2),
    ]);
    const second = hunk([line("addition", "later", null, 5)]);

    const layout = buildDiffLayout([first, second]);

    expect(layout.unifiedHunkStarts).toEqual([0, 3]);
    expect(layout.sideBySideHunkStarts).toEqual([0, 2]);
    expect(layout.sideBySideRows[2]?.hunkIndex).toBe(1);
  });

  it("returns empty collections for an empty diff", () => {
    expect(buildDiffLayout([])).toEqual({
      unifiedLines: [],
      sideBySideRows: [],
      unifiedHunkStarts: [],
      sideBySideHunkStarts: [],
      unifiedKinds: [],
      sideBySideKinds: [],
    });
  });
});

describe("buildMinimapSegments", () => {
  it("groups adjacent changes and preserves modified rows", () => {
    expect(buildMinimapSegments([null, "removed", "removed", null, "modified", "added"])).toEqual([
      { topPct: 100 / 6, heightPct: 200 / 6, kind: "removed" },
      { topPct: 400 / 6, heightPct: 100 / 6, kind: "modified" },
      { topPct: 500 / 6, heightPct: 100 / 6, kind: "added" },
    ]);
  });

  it("returns no segments when there are no rendered rows", () => {
    expect(buildMinimapSegments([])).toEqual([]);
  });
});
