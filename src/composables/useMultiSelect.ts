import { computed, ref, watch, type Ref } from "vue";

/**
 * 通用多选 hook：支持单点切换、Shift 范围选、Set 操作。
 * 与具体业务解耦：调用方提供 flat key 序列（按视觉顺序）作为响应式来源。
 */
export function useMultiSelect(flatKeys: Ref<readonly string[]>) {
  const selectedKeys = ref<Set<string>>(new Set());
  const lastClickedKey = ref<string | null>(null);

  const selectedCount = computed(() => selectedKeys.value.size);

  function isSelected(key: string): boolean {
    return selectedKeys.value.has(key);
  }

  function toggle(key: string): void {
    const next = new Set(selectedKeys.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selectedKeys.value = next;
    lastClickedKey.value = key;
  }

  function selectRange(key: string): void {
    const flat = flatKeys.value;
    const anchor =
      lastClickedKey.value && flat.includes(lastClickedKey.value) ? lastClickedKey.value : key;
    const a = flat.indexOf(anchor);
    const b = flat.indexOf(key);
    if (a < 0 || b < 0) {
      toggle(key);
      return;
    }
    const [from, to] = a <= b ? [a, b] : [b, a];
    const next = new Set(selectedKeys.value);
    for (let i = from; i <= to; i += 1) {
      const k = flat[i];
      if (k) next.add(k);
    }
    selectedKeys.value = next;
    lastClickedKey.value = key;
  }

  function clear(): void {
    selectedKeys.value = new Set();
    lastClickedKey.value = null;
  }

  /** 仅保留指定 key 集合；其它移除。常用于「请求成功后清除已成功的项」 */
  function removeKeys(toRemove: readonly string[]): void {
    if (selectedKeys.value.size === 0) return;
    const next = new Set(selectedKeys.value);
    for (const k of toRemove) next.delete(k);
    selectedKeys.value = next;
  }

  // 文件列表刷新后，自动剔除已不存在的选中项
  watch(flatKeys, (keys) => {
    if (selectedKeys.value.size === 0) return;
    const valid = new Set(keys);
    let changed = false;
    const next = new Set<string>();
    for (const k of selectedKeys.value) {
      if (valid.has(k)) next.add(k);
      else changed = true;
    }
    if (changed) selectedKeys.value = next;
  });

  return {
    selectedKeys,
    lastClickedKey,
    selectedCount,
    isSelected,
    toggle,
    selectRange,
    clear,
    removeKeys,
  };
}
