import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readComponent(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

function expectNoRule(source: string, selectors: string[], declaration: RegExp): void {
  for (const selector of selectors) {
    expect(ruleBody(source, selector), selector).not.toMatch(declaration);
  }
}

describe("visual divider density", () => {
  it("avoids row and stacked section dividers in secondary dialogs", () => {
    const worktree = readComponent("../components/worktree/WorktreeDialog.vue");
    const hooks = readComponent("../components/hooks/HooksDialog.vue");
    const reflog = readComponent("../components/common/ReflogDialog.vue");

    expectNoRule(
      worktree,
      [".wt-header", ".wt-add-form", ".wt-table td"],
      /border-bottom\s*:/
    );
    expect(ruleBody(worktree, ".wt-table thead")).toMatch(/border-bottom\s*:/);

    expectNoRule(hooks, [".hk-header", ".hk-table td"], /border-bottom\s*:/);
    expect(ruleBody(hooks, ".hk-table thead")).toMatch(/border-bottom\s*:/);

    expectNoRule(
      reflog,
      [".reflog-header", ".reflog-toolbar", ".reflog-error", ".reflog-row"],
      /border-bottom\s*:/
    );
    expect(ruleBody(reflog, ".reflog-list")).toMatch(/border-right\s*:/);
  });

  it("keeps structural diff boundaries without stacked chrome dividers", () => {
    const diff = readComponent("../components/diff/DiffViewer.vue");
    const merge = readComponent("../components/merge/ThreeWayMerge.vue");

    expectNoRule(diff, [".diff-toolbar", ".side-header"], /border-bottom\s*:/);
    expectNoRule(diff, [".hunk-nav"], /border-left\s*:/);
    expect(ruleBody(diff, ".left-side")).toMatch(/border-right\s*:/);
    expect(ruleBody(diff, ".diff-minimap")).toMatch(/border-left\s*:/);

    expectNoRule(
      merge,
      [
        ".sidebar-header",
        ".sidebar-file",
        ".scenario-banner",
        ".merge-toolbar",
        ".panel-head",
        ".hunk-action-bar",
      ],
      /border-bottom\s*:/
    );
    expect(ruleBody(merge, ".file-sidebar")).toMatch(/border-right\s*:/);
    expect(ruleBody(merge, ".hunk-action-bar")).toMatch(/border-top\s*:/);
  });

  it("keeps horizontal diff scrolling at the pane level", () => {
    const diff = readComponent("../components/diff/DiffViewer.vue");

    expect(ruleBody(diff, ".side-content")).toMatch(/overflow\s*:\s*auto/);
    expect(ruleBody(diff, ".unified-view")).toMatch(/overflow\s*:\s*auto/);
    expect(ruleBody(diff, ".line-content")).not.toMatch(/overflow-x\s*:\s*auto/);
  });

  it("uses surfaces instead of repeated separators in complex panels", () => {
    const push = readComponent("../components/common/PushDialog.vue");
    const report = readComponent("../components/report/ReportPanel.vue");

    expectNoRule(
      push,
      [".push-header", ".repo-row", ".files-header"],
      /border-bottom\s*:/
    );
    expect(ruleBody(push, ".push-left")).toMatch(/border-right\s*:/);
    expect(ruleBody(push, ".push-options")).toMatch(/border-top\s*:/);

    expectNoRule(
      report,
      [".preview-toolbar", ".prompt-panel"],
      /border-bottom\s*:/
    );
    expect(ruleBody(report, ".filter-bar")).toMatch(/border-bottom\s*:/);
  });

  it("drops boxed-in header dividers but keeps a background for separation", () => {
    const cases: Array<[string, string]> = [
      ["../components/log/CommitDetailsPane.vue", ".pane-header"],
      ["../components/log/ChangedFilesPane.vue", ".changed-files-pane > :deep(.toolbar)"],
      ["../components/changes/ChangesToolbar.vue", ".panel-header"],
      ["../components/changes/FileSection.vue", ".section-header"],
      ["../components/changes/LocalChangesView.vue", ".diff-header"],
      ["../components/changes/LocalChangesView.vue", ".modal-header"],
      ["../components/stash/StashList.vue", ".panel-header"],
      ["../components/stash/StashList.vue", ".modal-header"],
    ];
    for (const [path, selector] of cases) {
      const body = ruleBody(readComponent(path), selector);
      expect(body, `${path} ${selector} keeps no bottom divider`).not.toMatch(
        /border-bottom\s*:/
      );
      expect(body, `${path} ${selector} keeps a background`).toMatch(/background\s*:/);
    }
  });

  it("uses a header surface instead of a divider in secondary dialogs", () => {
    const cases: Array<[string, string]> = [
      ["../components/common/KeyboardShortcutsDialog.vue", ".shortcuts-header"],
      ["../components/common/GitCredentialDialog.vue", ".cred-header"],
      ["../components/common/CreateTagDialog.vue", ".tag-dialog-header"],
      ["../components/commit/AiSettingsDialog.vue", ".ai-dialog-header"],
      ["../components/rebase/RebaseSequencerDialog.vue", ".rb-header"],
      ["../components/common/DivergenceDialog.vue", ".divergence-header"],
      ["../components/changes/FilterRulesDialog.vue", ".modal-header"],
      ["../components/compare/CompareBranchesDialog.vue", ".cb-header"],
    ];
    for (const [path, selector] of cases) {
      const body = ruleBody(readComponent(path), selector);
      expect(body, `${path} ${selector} keeps no bottom divider`).not.toMatch(
        /border-bottom\s*:/
      );
      expect(body, `${path} ${selector} uses emphasis surface`).toMatch(
        /background\s*:\s*var\(--color-surface-emphasis\)/
      );
    }
  });
});
