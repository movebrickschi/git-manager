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

  return { visible, draft, hasRules, open, close, save, insertExample };
}
