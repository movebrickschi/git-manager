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
  NON_FAST_FORWARD: "远端有新提交，请先拉取 / 抓取并合并",
  AUTH_FAILED: "认证失败，请检查账号 / 密钥",
  GIT_TIMEOUT: "git 操作超时",
  GIT_ERR: "git 内部错误",
  LOCAL_CHANGES_OVERWRITTEN: "本地未提交的改动会被拉取覆盖，请先提交或搁置",
  STASH_POP_CONFLICT: "恢复本地搁置改动时产生冲突，请逐个解决后再丢弃搁置记录",
};

const PATTERN_MAP: Array<[RegExp, string]> = [
  [/^Error invoking remote method/i, "调用本地功能失败"],
  [/non-?fast-?forward/i, "远端有新提交，请先拉取"],
  [/permission denied/i, "权限被拒绝（公钥 / 文件锁）"],
  [/authentication failed/i, "认证失败"],
  [/could not resolve host/i, "无法解析主机，请检查网络 / DNS"],
  [/connection (timed out|refused|reset)/i, "连接异常，请稍后重试"],
  [/network is unreachable/i, "网络不可达"],
  [/repository not found/i, "仓库不存在或无访问权限"],
  [
    /refusing to merge unrelated histories/i,
    "拒绝合并不相关的历史（需 --allow-unrelated-histories）",
  ],
  [/your local changes.*would be overwritten/i, "本地未提交的改动会被覆盖，请先提交或搁置"],
  [/please commit your changes or stash them/i, "请先提交或搁置本地改动"],
  [/auto stash failed/i, "自动搁置失败，请手动提交或搁置后再重试"],
  [
    /pull completed.*restoring stashed local changes caused conflicts/i,
    "拉取成功，但恢复本地搁置改动时产生冲突，请逐个解决冲突后再丢弃 stash@{0}",
  ],
  [
    /pull completed.*stash pop failed/i,
    "拉取成功，但恢复搁置记录失败；你的改动仍保存在 stash@{0}",
  ],
  [
    /pull completed.*local changes auto-stashed and restored/i,
    "拉取完成（本地改动已自动暂存并还原）",
  ],
  // ── 分支上游 / tracking 缺失（Pull / Push 最常见）──────────────
  [
    /you asked to pull from the remote.*did not specify a branch/is,
    "当前分支未设置上游分支，无法确定要拉取哪个远程分支。请先推送建立上游，或右键分支指定拉取来源。",
  ],
  [
    /there is no tracking information for the current branch/i,
    "当前分支没有跟踪信息（未设置上游）。请先推送建立上游后再拉取。",
  ],
  [
    /the current branch .* has no upstream branch/i,
    "当前分支没有上游分支。请先推送并建立上游。",
  ],
  [/no candidate for merging|no source branch/i, "找不到可合并的远程分支，请检查分支的上游设置。"],
  [/couldn'?t find remote ref/i, "远端找不到该引用（分支 / 标签可能已被删除）。"],
  // ── Push 相关 ────────────────────────────────────────────────
  [/failed to push some refs/i, "推送失败：远端有新提交，请先拉取合并后再推送。"],
  [/updates were rejected/i, "推送被拒绝：远端有新提交，请先拉取合并。"],
  [/everything up-to-date/i, "已是最新，无需推送。"],
  [/src refspec .* does not match any/i, "本地没有可推送的该分支 / 引用。"],
  [/already up[- ]to[- ]date/i, "已是最新。"],
  // ── 合并 / 检出覆盖 / 路径 ────────────────────────────────────
  [/automatic merge failed|fix conflicts and then commit/i, "自动合并失败，存在冲突，请解决后再提交。"],
  [/pathspec .* did not match any file/i, "找不到匹配的文件或分支。"],
  // ── 提交 / 身份 ──────────────────────────────────────────────
  [/nothing to commit/i, "没有需要提交的改动。"],
  [
    /please tell me who you are|unable to auto-detect email address|empty ident name/i,
    "请先配置 git 用户名和邮箱（user.name / user.email）。",
  ],
  // ── 属主 / 证书 / 访问 ───────────────────────────────────────
  [
    /detected dubious ownership/i,
    "检测到仓库属主可疑（safe.directory），请把该仓库路径加入 git 的 safe.directory 配置。",
  ],
  [/ssl certificate problem/i, "SSL 证书校验失败，请检查系统时间 / 证书 / 代理设置。"],
  [/the requested url returned error: 403/i, "远端拒绝访问（403），请检查账号权限。"],
  [/the requested url returned error: 401/i, "认证失败（401），请检查账号 / 令牌。"],
  [/unable to access/i, "无法访问远端仓库，请检查网络 / 地址 / 认证。"],
  [/cannot lock ref|unable to create.*lock/i, "git 索引被锁定，请关闭其他 git 进程后重试"],
  [/cannot remove untracked file/i, "无法移除未跟踪文件"],
  [/untracked working tree files.*would be overwritten/i, "未跟踪文件会被覆盖，请先备份或删除"],
  [/conflict.*merge/i, "合并产生冲突"],
  [/index\.lock|\.git\/index\.lock/i, "git 索引被锁定，可能有其它进程占用"],
  [/fatal: bad revision/i, "无效的 git 引用"],
  [/fatal: ambiguous argument/i, "git 参数歧义"],
  [/not a git repository/i, "不是 git 仓库"],
  [/destination path .* already exists and is not an empty directory/i, "目标目录已存在且不为空"],
  [/remote rejected/i, "远端拒绝了推送"],
  [/not fully merged/i, "分支尚未完全合并，删除会丢失其独有提交（可选择强制删除）"],
  [/HEAD detached/i, "当前处于游离 HEAD 状态"],
  [/early eof/i, "网络中断（git 提前 EOF）"],
  [/timeout|timed out/i, "操作超时"],
];

export function translateGitError(
  input: { code?: string; error?: string; message?: string } | string | null | undefined
): string {
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
  // 生产模式下后端只回错误码字符串（见 server/routes.ts wrap），这里按裸 code 兜底翻译
  const trimmed = msg.trim();
  if (CODE_MAP[trimmed]) return CODE_MAP[trimmed];
  // git 的 stderr 常按 ~80 列硬折行，会把「did not specify a branch」拆成
  // 「did not specify\na branch」，令依赖连续空格的正则漏匹配。匹配前把连续空白
  // （含换行）折叠成单空格，兜底仍返回原文以保留原始换行格式。
  const collapsed = msg.replace(/\s+/g, " ");
  for (const [pat, zh] of PATTERN_MAP) {
    if (pat.test(msg) || pat.test(collapsed)) return zh;
  }
  return msg;
}
