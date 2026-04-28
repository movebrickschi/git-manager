/**
 * 轻量 gitignore 风格的路径匹配器。
 *
 * 支持语法：
 *   - 空行与以 `#` 开头的注释行被忽略
 *   - `!` 取反（按规则顺序，最后命中的规则决定结果）
 *   - 末尾 `/` 表示仅匹配目录（路径以该目录前缀视为命中）
 *   - 开头 `/` 表示锚定到根（仅匹配相对仓库根的路径）
 *   - `**` 跨目录通配
 *   - `*` 单段（不跨 `/`）通配
 *   - `?` 单字符通配
 *
 * 输入路径统一使用 `/` 分隔符（与本项目 FileStatus.path 一致）。
 */

interface CompiledRule {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

function escapeRegex(ch: string): string {
  return ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把单条 gitignore 规则编译成正则。
 * 实现保持简洁：先做语义切片，再逐字符转义。
 */
function compilePattern(raw: string): CompiledRule | null {
  let pattern = raw.trim();
  if (!pattern || pattern.startsWith("#")) return null;

  let negated = false;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }

  let dirOnly = false;
  if (pattern.endsWith("/")) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }

  // 是否锚定到根：开头有 `/`，或者 pattern 中间含有 `/`（且不是仅末尾的 `/`）
  const hasMidSlash = pattern.includes("/") && !pattern.endsWith("/");
  let anchored = false;
  if (pattern.startsWith("/")) {
    anchored = true;
    pattern = pattern.slice(1);
  } else if (hasMidSlash) {
    // 含路径分隔符的规则隐式锚定，符合 gitignore 语义
    anchored = true;
  }

  let regexStr = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // ** 跨段
        const before = pattern[i - 1];
        const after = pattern[i + 2];
        if ((before === undefined || before === "/") && (after === undefined || after === "/")) {
          // /**/ 形式：匹配任意层目录（含零层）
          if (after === "/") {
            regexStr += "(?:.*/)?";
            i += 3;
            continue;
          }
          // 末尾 ** ：匹配剩余所有
          regexStr += ".*";
          i += 2;
          continue;
        }
        // 退化为普通 *
        regexStr += "[^/]*";
        i += 2;
        continue;
      }
      regexStr += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      regexStr += "[^/]";
      i += 1;
      continue;
    }
    regexStr += escapeRegex(ch);
    i += 1;
  }

  // 锚定决定起始；目录规则匹配「该目录或其子文件」
  const head = anchored ? "^" : "(?:^|.*/)";
  const tail = dirOnly ? "(?:/.*)?$" : "(?:$|/.*$)";
  // 非目录、非锚定的规则也应能匹配子路径（如 `node_modules` 命中 `node_modules/foo.js`）
  const finalRegex = new RegExp(head + regexStr + tail);

  return { regex: finalRegex, negated, dirOnly };
}

export interface IgnoreMatcher {
  /** 路径是否被忽略（true = 隐藏） */
  ignores(path: string): boolean;
  /** 是否包含任何有效规则 */
  hasRules: boolean;
}

/**
 * 编译多条规则为单一匹配器。后命中的规则覆盖前者，与 git 行为一致。
 */
export function compilePatterns(patterns: string[] | string): IgnoreMatcher {
  const lines = Array.isArray(patterns) ? patterns : patterns.split(/\r?\n/);
  const rules: CompiledRule[] = [];
  for (const line of lines) {
    const rule = compilePattern(line);
    if (rule) rules.push(rule);
  }

  const ignores = (rawPath: string): boolean => {
    const path = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    let ignored = false;
    for (const rule of rules) {
      if (rule.regex.test(path)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  };

  return { ignores, hasRules: rules.length > 0 };
}
