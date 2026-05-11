/**
 * 将后端返回的 git 错误（多为 stderr 英文）翻译为中文。
 *
 * 优先级：
 * 1. 已知错误码（来自 server/routes.ts wrap classifyError 的 code 字段）
 * 2. 关键字匹配
 * 3. 原文兜底
 */

const CODE_MAP: Record<string, string> = {
  PATH_DENIED: "路径越界或非法文件名",
  REPO_NOT_FOUND: "仓库不存在或路径无效",
  GIT_CONFLICT: "存在 git 冲突，请手动解决",
  NON_FAST_FORWARD: "远端有新提交，请先 pull / fetch 合并",
  AUTH_FAILED: "认证失败，请检查账号 / 密钥",
  GIT_TIMEOUT: "git 操作超时",
  GIT_ERR: "git 内部错误",
};

const PATTERN_MAP: Array<[RegExp, string]> = [
  [/non-?fast-?forward/i, "远端有新提交，请先 pull"],
  [/permission denied/i, "权限被拒绝（公钥 / 文件锁）"],
  [/authentication failed/i, "认证失败"],
  [/could not resolve host/i, "无法解析主机，请检查网络 / DNS"],
  [/connection (timed out|refused|reset)/i, "连接异常，请稍后重试"],
  [/network is unreachable/i, "网络不可达"],
  [/repository not found/i, "仓库不存在或无访问权限"],
  [/refusing to merge unrelated histories/i, "拒绝合并不相关的历史（需 --allow-unrelated-histories）"],
  [/your local changes.*would be overwritten/i, "本地未提交的改动会被覆盖，请先 commit / stash"],
  [/please commit your changes or stash them/i, "请先提交或搁置本地改动"],
  [/cannot lock ref|unable to create.*lock/i, "git 索引被锁定，请关闭其他 git 进程后重试"],
  [/cannot remove untracked file/i, "无法移除未跟踪文件"],
  [/untracked working tree files.*would be overwritten/i, "未跟踪文件会被覆盖，请先备份或删除"],
  [/conflict.*merge/i, "合并产生冲突"],
  [/index\.lock|\.git\/index\.lock/i, "git 索引被锁定，可能有其它进程占用"],
  [/fatal: bad revision/i, "无效的 git 引用"],
  [/fatal: ambiguous argument/i, "git 参数歧义"],
  [/fatal: not a git repository/i, "不是 git 仓库"],
  [/destination path .* already exists and is not an empty directory/i, "目标目录已存在且不为空"],
  [/remote rejected/i, "远端拒绝了推送"],
  [/HEAD detached/i, "当前处于游离 HEAD 状态"],
  [/early eof/i, "网络中断（git 提前 EOF）"],
  [/timeout|timed out/i, "操作超时"],
];

export function translateGitError(input: { code?: string; error?: string; message?: string } | string | null | undefined): string {
  if (input == null) return "未知错误";
  if (typeof input === "string") return translateRaw(input);
  const code = input.code;
  if (code && CODE_MAP[code]) {
    return CODE_MAP[code];
  }
  const raw = input.error ?? input.message ?? "";
  return translateRaw(raw);
}

function translateRaw(msg: string): string {
  if (!msg) return "未知错误";
  for (const [pat, zh] of PATTERN_MAP) {
    if (pat.test(msg)) return zh;
  }
  return msg;
}
