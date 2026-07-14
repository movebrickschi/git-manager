/**
 * Repo Watcher Ignored Patterns · 主进程 watcher 与 SSE watcher 共用的忽略规则
 *
 * 设计原则：
 *   1. 通用规则排除 `.git/` 内 objects/logs/hooks；实际 repo watcher 再按解析出的
 *      git-dir 为 hooks 与 reflog 精确开白名单，并保留 HEAD / index / refs /
 *      FETCH_HEAD / packed-refs / MERGE_HEAD / rebase-* 等状态信号
 *   2. 常见大目录（node_modules / dist / build / venv / target / coverage 等）排除
 *      避免百万级文件 watch 占用过多 inotify watch / RAM
 *   3. OS 元数据文件（.DS_Store / Thumbs.db）排除
 *
 * 适用：本数组以 RegExp[] 形式提供，chokidar 5.x `ignored` 选项接受函数
 * `(file: string) => boolean`，由调用方包装：
 *   ignored: (file) => REPO_WATCHER_IGNORED.some(re => re.test(file))
 */
export const REPO_WATCHER_IGNORED: ReadonlyArray<RegExp> = [
  // .git 内噪声
  /(^|[\\/])\.git[\\/]objects([\\/]|$)/,
  // 专用 watcher 会按真实 git-dir 为 hooks 与 HEAD/refs reflog 开白名单；
  // 通用 predicate 仍保持默认降噪行为。
  /(^|[\\/])\.git[\\/]logs([\\/]|$)/,
  /(^|[\\/])\.git[\\/]hooks([\\/]|$)/,
  // common-dir/modules 下是嵌套仓库，只保留 HEAD/index 等轻量状态，排除对象库与 reflog。
  /(^|[\\/])\.git[\\/]modules(?:[\\/].*)?[\\/]objects([\\/]|$)/,
  /(^|[\\/])\.git[\\/]modules(?:[\\/].*)?[\\/]logs([\\/]|$)/,
  /(^|[\\/])\.git[\\/]worktrees[\\/][^\\/]+[\\/]logs([\\/]|$)/,

  // 包管理器 / 构建输出
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])(dist|dist-electron|dist-server|build|out|release)([\\/]|$)/,
  /(^|[\\/])\.next([\\/]|$)/,
  /(^|[\\/])\.nuxt([\\/]|$)/,
  /(^|[\\/])\.svelte-kit([\\/]|$)/,
  /(^|[\\/])\.turbo([\\/]|$)/,
  /(^|[\\/])\.parcel-cache([\\/]|$)/,
  /(^|[\\/])\.cache([\\/]|$)/,

  // 测试/覆盖率
  /(^|[\\/])coverage([\\/]|$)/,
  /(^|[\\/])\.nyc_output([\\/]|$)/,
  /(^|[\\/])\.pytest_cache([\\/]|$)/,

  // Python / Ruby / Rust / Go / Java / .NET 常见 vendored 目录
  /(^|[\\/])(venv|\.venv|env|__pycache__)([\\/]|$)/,
  /(^|[\\/])(vendor|bundle)([\\/]|$)/,
  /(^|[\\/])target([\\/]|$)/,
  /(^|[\\/])(\.gradle|\.mvn)([\\/]|$)/,
  /(^|[\\/])bin([\\/]|$)/,
  /(^|[\\/])obj([\\/]|$)/,

  // IDE / OS 元数据
  /(^|[\\/])\.idea([\\/]|$)/,
  /(^|[\\/])\.vscode([\\/]|$)/,
  /(^|[\\/])\.DS_Store$/,
  /(^|[\\/])Thumbs\.db$/,
  /(^|[\\/])desktop\.ini$/,

  // 大日志文件
  /\.log$/,
];

/** 给 chokidar.ignored 用的函数适配器。 */
export function makeIgnoredPredicate(): (file: string) => boolean {
  return (file: string) => REPO_WATCHER_IGNORED.some((re) => re.test(file));
}
