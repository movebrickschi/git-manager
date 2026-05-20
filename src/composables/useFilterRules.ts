import { computed, ref } from "vue";
import { useFilterStore } from "@/stores/filterStore";

const EXAMPLE_RULES = [
  "# 每行一条规则，类似 .gitignore",
  ".idea/",
  "node_modules/",
  "**/*.log",
  "dist/",
].join("\n");

/**
 * 过滤规则弹窗：草稿 / 打开 / 保存 / 插入示例。
 * 与 filterStore 直接耦合（业务上不可拆得更细），但与 LocalChangesView 解耦。
 */
export function useFilterRules(opts: {
  getRepoPath: () => string;
  onMessage?: (msg: string) => void;
}) {
  const filterStore = useFilterStore();
  const visible = ref(false);
  const draft = ref("");

  const hasRules = computed(() => filterStore.hasRules(opts.getRepoPath()));

  function open(): void {
    draft.value = filterStore.getRules(opts.getRepoPath());
    visible.value = true;
  }

  function close(): void {
    visible.value = false;
  }

  function save(): void {
    filterStore.setRules(opts.getRepoPath(), draft.value);
    visible.value = false;
    opts.onMessage?.("过滤规则已更新");
  }

  function insertExample(): void {
    draft.value = draft.value
      ? `${draft.value.replace(/\s+$/, "")}\n${EXAMPLE_RULES}`
      : EXAMPLE_RULES;
  }

  /**
   * 把选中的文件路径作为新规则追加到当前仓库的过滤规则末尾。
   * - 自动跳过已存在的同名规则（按行去重）
   * - 直接调用 filterStore.setRules 落库；不打开 dialog
   * - 返回实际新增的条数
   */
  function addPaths(paths: string[]): number {
    const repoPath = opts.getRepoPath();
    if (!repoPath) {
      opts.onMessage?.("未选中仓库，无法添加过滤规则");
      return 0;
    }
    const incoming = paths.map((p) => p.trim()).filter(Boolean);
    if (incoming.length === 0) return 0;

    const current = filterStore.getRules(repoPath);
    const existingLines = new Set(
      current
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
    );

    const additions: string[] = [];
    for (const p of incoming) {
      if (!existingLines.has(p)) {
        existingLines.add(p);
        additions.push(p);
      }
    }

    if (additions.length === 0) {
      opts.onMessage?.("所选路径已存在于过滤规则中");
      return 0;
    }

    const merged = current
      ? `${current.replace(/\s+$/, "")}\n${additions.join("\n")}`
      : additions.join("\n");
    filterStore.setRules(repoPath, merged);
    opts.onMessage?.(`已添加 ${additions.length} 条过滤规则`);
    return additions.length;
  }

  return { visible, draft, hasRules, open, close, save, insertExample, addPaths };
}
