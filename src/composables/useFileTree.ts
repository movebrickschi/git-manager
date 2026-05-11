import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { FileStatus } from "@/utils/commands";

export interface TreeNode {
  /** 节点显示名（最后一段路径） */
  name: string;
  /** 该节点完整路径（POSIX 分隔符） */
  path: string;
  /** 缩进深度，0 为根级 */
  depth: number;
  /** 目录节点 true；叶子文件节点 false */
  isDir: boolean;
  /** 叶子节点持有的原始 FileStatus，方便交互回调直接用 */
  file?: FileStatus;
}

export interface UseFileTreeReturn {
  /** 扁平化的可见节点列表（已按目录折叠状态过滤） */
  visibleNodes: ComputedRef<TreeNode[]>;
  /** 切换目录折叠/展开 */
  toggleDir: (path: string) => void;
  /** 判断目录是否处于折叠态 */
  isCollapsed: (path: string) => boolean;
  /** 一键折叠所有目录 */
  collapseAll: () => void;
  /** 一键展开所有目录 */
  expandAll: () => void;
}

interface InternalNode {
  name: string;
  path: string;
  isDir: boolean;
  children: InternalNode[];
  file?: FileStatus;
}

function buildTree(files: readonly FileStatus[]): InternalNode {
  const root: InternalNode = { name: "", path: "", isDir: true, children: [] };
  // 用 Map 加速「按名查找子节点」，避免 O(N²) 子节点扫描
  const dirIndex: Map<string, Map<string, InternalNode>> = new Map();
  dirIndex.set("", new Map());

  for (const file of files) {
    const parts = file.path.replace(/\\/g, "/").split("/").filter(Boolean);
    let cur = root;
    let curPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      const childPath = curPath ? `${curPath}/${part}` : part;

      if (isLast) {
        cur.children.push({
          name: part,
          path: childPath,
          isDir: false,
          children: [],
          file,
        });
      } else {
        const map = dirIndex.get(curPath)!;
        let dir = map.get(part);
        if (!dir) {
          dir = { name: part, path: childPath, isDir: true, children: [] };
          cur.children.push(dir);
          map.set(part, dir);
          dirIndex.set(childPath, new Map());
        }
        cur = dir;
        curPath = childPath;
      }
    }
  }

  return root;
}

function flatten(
  root: InternalNode,
  collapsed: ReadonlySet<string>,
): TreeNode[] {
  const out: TreeNode[] = [];

  function walk(node: InternalNode, depth: number): void {
    for (const child of node.children) {
      out.push({
        name: child.name,
        path: child.path,
        depth,
        isDir: child.isDir,
        file: child.file,
      });
      if (child.isDir && !collapsed.has(child.path)) {
        walk(child, depth + 1);
      }
    }
  }

  walk(root, 0);
  return out;
}

function collectAllDirPaths(root: InternalNode, into: string[]): void {
  for (const child of root.children) {
    if (child.isDir) {
      into.push(child.path);
      collectAllDirPaths(child, into);
    }
  }
}

/**
 * 将平铺的 FileStatus[] 转换为可折叠的目录树，输出扁平化的可见节点列表。
 *
 * - `files` 引用稳定时，Vue computed 自动缓存 → 多次读取 visibleNodes 不会重建
 * - 折叠/展开仅触发扁平化重算，不重建树本身
 * - 输出含 `depth` 字段，调用方按 depth 控制缩进；接 VirtualList 时可直接当作列表项
 */
export function useFileTree(files: Ref<readonly FileStatus[]>): UseFileTreeReturn {
  const collapsedDirs = ref<Set<string>>(new Set());

  const tree = computed(() => buildTree(files.value));

  const visibleNodes = computed(() => flatten(tree.value, collapsedDirs.value));

  function toggleDir(path: string): void {
    const next = new Set(collapsedDirs.value);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    collapsedDirs.value = next;
  }

  function isCollapsed(path: string): boolean {
    return collapsedDirs.value.has(path);
  }

  function collapseAll(): void {
    const allDirs: string[] = [];
    collectAllDirPaths(tree.value, allDirs);
    collapsedDirs.value = new Set(allDirs);
  }

  function expandAll(): void {
    collapsedDirs.value = new Set();
  }

  return { visibleNodes, toggleDir, isCollapsed, collapseAll, expandAll };
}
