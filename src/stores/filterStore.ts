import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { compilePatterns, type IgnoreMatcher } from "@/utils/ignore-matcher";

const STORAGE_KEY = "git-manager:change-filters";

interface PersistedShape {
  rulesByRepo: Record<string, string>;
  showFiltered: boolean;
}

function loadPersisted(): PersistedShape {
  if (typeof localStorage === "undefined") {
    return { rulesByRepo: {}, showFiltered: false };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { rulesByRepo: {}, showFiltered: false };
    const parsed = JSON.parse(raw);
    return {
      rulesByRepo: parsed.rulesByRepo ?? {},
      showFiltered: !!parsed.showFiltered,
    };
  } catch {
    return { rulesByRepo: {}, showFiltered: false };
  }
}

export const useFilterStore = defineStore("changeFilter", () => {
  const persisted = loadPersisted();
  const rulesByRepo = ref<Record<string, string>>(persisted.rulesByRepo);
  const showFiltered = ref<boolean>(persisted.showFiltered);

  // 编译缓存：避免每次 isFiltered 都重新构造正则
  const matcherCache = new Map<string, { rules: string; matcher: IgnoreMatcher }>();

  function persist() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          rulesByRepo: rulesByRepo.value,
          showFiltered: showFiltered.value,
        })
      );
    } catch {
      // 忽略写入失败（隐私模式 / 配额）
    }
  }

  function getRules(repoPath: string): string {
    return rulesByRepo.value[repoPath] ?? "";
  }

  function setRules(repoPath: string, text: string): void {
    if (text.trim()) {
      rulesByRepo.value = { ...rulesByRepo.value, [repoPath]: text };
    } else {
      const next = { ...rulesByRepo.value };
      delete next[repoPath];
      rulesByRepo.value = next;
    }
    matcherCache.delete(repoPath);
    persist();
  }

  function setShowFiltered(value: boolean): void {
    showFiltered.value = value;
    persist();
  }

  function toggleShowFiltered(): void {
    setShowFiltered(!showFiltered.value);
  }

  function getMatcher(repoPath: string): IgnoreMatcher {
    const rules = getRules(repoPath);
    const cached = matcherCache.get(repoPath);
    if (cached && cached.rules === rules) return cached.matcher;
    const matcher = compilePatterns(rules);
    matcherCache.set(repoPath, { rules, matcher });
    return matcher;
  }

  function isFiltered(repoPath: string, filePath: string): boolean {
    if (!repoPath) return false;
    const matcher = getMatcher(repoPath);
    if (!matcher.hasRules) return false;
    return matcher.ignores(filePath);
  }

  function hasRules(repoPath: string): boolean {
    return !!getRules(repoPath).trim();
  }

  return {
    rulesByRepo,
    showFiltered,
    getRules,
    setRules,
    setShowFiltered,
    toggleShowFiltered,
    isFiltered,
    hasRules,
  };
});
