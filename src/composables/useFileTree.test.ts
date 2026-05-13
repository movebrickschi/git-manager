import { describe, it, expect } from "vitest";
import { ref } from "vue";
import type { FileStatus } from "@/utils/commands";
import { useFileTree } from "./useFileTree";

function makeFile(path: string, status: FileStatus["status"] = "modified"): FileStatus {
  return { path, oldPath: null, status, staged: false };
}

describe("useFileTree", () => {
  it("空列表应返回空 visibleNodes", () => {
    const files = ref<FileStatus[]>([]);
    const { visibleNodes } = useFileTree(files);
    expect(visibleNodes.value).toEqual([]);
  });

  it("单层文件应直接放在 root 下，depth=0", () => {
    const files = ref<FileStatus[]>([makeFile("a.ts"), makeFile("b.ts")]);
    const { visibleNodes } = useFileTree(files);
    const nodes = visibleNodes.value;
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.path)).toEqual(["a.ts", "b.ts"]);
    expect(nodes.every((n) => n.depth === 0 && !n.isDir)).toBe(true);
  });

  it("嵌套目录应递归构建，深度准确", () => {
    const files = ref<FileStatus[]>([
      makeFile("src/utils/error.ts"),
      makeFile("src/utils/format.ts"),
      makeFile("src/main.ts"),
    ]);
    const { visibleNodes } = useFileTree(files);
    const nodes = visibleNodes.value;

    // src(d) > utils(d) > error.ts, format.ts | src(d) > main.ts
    expect(nodes.map((n) => ({ p: n.path, d: n.depth, dir: n.isDir }))).toEqual([
      { p: "src", d: 0, dir: true },
      { p: "src/utils", d: 1, dir: true },
      { p: "src/utils/error.ts", d: 2, dir: false },
      { p: "src/utils/format.ts", d: 2, dir: false },
      { p: "src/main.ts", d: 1, dir: false },
    ]);
  });

  it("反斜杠路径应被规范化（Windows 用户场景）", () => {
    const files = ref<FileStatus[]>([makeFile("src\\utils\\error.ts")]);
    const { visibleNodes } = useFileTree(files);
    const paths = visibleNodes.value.map((n) => n.path);
    expect(paths).toEqual(["src", "src/utils", "src/utils/error.ts"]);
  });

  it("toggleDir(path) 折叠目录后其子节点应消失", () => {
    const files = ref<FileStatus[]>([
      makeFile("src/a.ts"),
      makeFile("src/b.ts"),
      makeFile("dist/c.js"),
    ]);
    const { visibleNodes, toggleDir } = useFileTree(files);

    expect(visibleNodes.value.map((n) => n.path)).toEqual([
      "src",
      "src/a.ts",
      "src/b.ts",
      "dist",
      "dist/c.js",
    ]);

    toggleDir("src");
    expect(visibleNodes.value.map((n) => n.path)).toEqual([
      "src", // 目录本身仍可见
      "dist",
      "dist/c.js",
    ]);

    toggleDir("src"); // 再次切换 → 展开
    expect(visibleNodes.value.map((n) => n.path)).toEqual([
      "src",
      "src/a.ts",
      "src/b.ts",
      "dist",
      "dist/c.js",
    ]);
  });

  it("isCollapsed 反映折叠状态", () => {
    const files = ref<FileStatus[]>([makeFile("a/b.ts")]);
    const { isCollapsed, toggleDir } = useFileTree(files);

    expect(isCollapsed("a")).toBe(false);
    toggleDir("a");
    expect(isCollapsed("a")).toBe(true);
  });

  it("collapseAll() / expandAll() 同时切换全部目录", () => {
    const files = ref<FileStatus[]>([makeFile("a/x.ts"), makeFile("b/y.ts")]);
    const { visibleNodes, collapseAll, expandAll } = useFileTree(files);

    collapseAll();
    expect(visibleNodes.value.map((n) => n.path)).toEqual(["a", "b"]);

    expandAll();
    expect(visibleNodes.value.map((n) => n.path)).toEqual(["a", "a/x.ts", "b", "b/y.ts"]);
  });

  it("files 引用变化应触发重建，但同一引用应被 memo 不重建", () => {
    const list1: FileStatus[] = [makeFile("a.ts")];
    const files = ref<FileStatus[]>(list1);
    const { visibleNodes } = useFileTree(files);

    const r1 = visibleNodes.value;
    const r2 = visibleNodes.value; // 同一引用 → 应返回同一计算结果（Vue computed 默认缓存）
    expect(r1).toBe(r2);

    const list2: FileStatus[] = [makeFile("b.ts")];
    files.value = list2;
    const r3 = visibleNodes.value;
    expect(r3).not.toBe(r1);
    expect(r3.map((n) => n.path)).toEqual(["b.ts"]);
  });

  it("叶子节点应带上原始 file 数据，便于交互回调使用", () => {
    const original = makeFile("src/a.ts", "added");
    const files = ref<FileStatus[]>([original]);
    const { visibleNodes } = useFileTree(files);

    const leaf = visibleNodes.value.find((n) => !n.isDir);
    // ref 数组的元素会被 reactive 代理，故用结构相等而非引用相等；业务回调按字段使用
    expect(leaf?.file).toEqual(original);
    expect(leaf?.file?.status).toBe("added");
    expect(leaf?.file?.path).toBe("src/a.ts");
  });

  it("折叠多层目录时，所有后代节点（孙、曾孙）均不可见", () => {
    const files = ref<FileStatus[]>([makeFile("a/b/c/d.ts"), makeFile("a/b/e.ts")]);
    const { visibleNodes, toggleDir } = useFileTree(files);

    toggleDir("a");
    const paths = visibleNodes.value.map((n) => n.path);
    expect(paths).toEqual(["a"]);
    expect(paths).not.toContain("a/b");
    expect(paths).not.toContain("a/b/c/d.ts");
  });
});
