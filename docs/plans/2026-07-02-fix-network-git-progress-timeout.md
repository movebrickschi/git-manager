# 修复：大仓库拉取被误报「操作超时」（联网 git 加 --progress）

## 目标

大仓库 pull / fetch / push / clone 传输耗时很久属正常，不应被 120s block 超时误杀并显示「操作超时」；只有真正卡死（长时间零进展）才应超时。

## 根因（已实证）

- `server/services/git-net.ts` `runTracked()` 的超时语义是「**连续 120s 无任何 stdout/stderr 输出**即 kill」（`blockTimeoutMs` 默认 `REMOTE_GIT_TIMEOUT_MS = 120_000`，见 git-net.ts:46、143-148、184-186）。设计初衷正确：有进度就不算卡死。
- 但 git 的进度输出（`Receiving objects: 42% ...` 等）**仅在 stderr 是 TTY 时默认开启**；`runTracked` 用 `spawn` 管道跑 git（非 TTY），git 自动关闭进度输出。
- 结果：大仓库传输阶段（Receiving objects / Resolving deltas / 远端 Counting objects）持续 >120s **全程零输出** → block 定时器从未被 reset → 误判卡死 → kill → 抛 `git operation timed out (no output for 120000ms)` → 前端经 `git-error.ts` 的 `/timeout|timed out/i` 翻译显示「操作超时」。
- 同样问题存在于 simple-git 跑的 clone（`repo.service.ts:121`，block 120s）与 submodule update（`submodule.service.ts`，block 5min）。

修复思路：给联网传输命令加 `--progress`（git 文档：强制在非 TTY 的 stderr 上输出进度）。进度行持续 reset block 定时器 → 大仓库不再被误杀；真卡死（120s 连进度都没有）仍会兜底超时。**不调大超时值**——那治标不治本且拖慢真卡死的发现。

## 影响面

1. `server/services/remote.service.ts` — 8 处 `runNetworkGit` 的 args 加 `--progress`：
   - `push()` line 21：`["push"]` → `["push", "--progress"]`
   - `deleteRemoteBranch()` line 59：`["push", remote, "--delete", name]` → 加 `--progress`（引用删除传输量小，为一致性统一加）
   - `pull()` line 149：`["pull"]` → `["pull", "--progress"]`
   - `previewPullConflicts()` line 255：`["fetch", remote]` / `["fetch"]` → 加 `--progress`
   - `forcePull()` line 356：`["pull"]` → 加 `--progress`
   - `fetch()` line 409、`fetchAll()` line 416、`fetchBranch()` line 424 → 加 `--progress`
2. `server/services/git-net.ts` — `runTracked()` close 回调（line 192）：构造失败错误消息时**剔除纯进度/统计行**（`Receiving objects:` / `Resolving deltas:` / `remote: Counting objects:` / `remote: Compressing objects:` / `remote: Enumerating objects:` / `remote: Total ...` / `Writing objects:` / `Unpacking objects:` / `Compressing objects:` / `Counting objects:`），避免失败时 stderr 里的大量进度串污染错误提示。**保留其它 `remote:` 行**（服务端 hook 拒绝消息是关键排错信息）。按 `\r` 与 `\n` 拆行过滤。
3. `server/services/repo.service.ts` — `clone()` line 129：`git.clone(url, target)` → `git.clone(url, target, ["--progress"])`。
4. `server/services/submodule.service.ts` — `updateSubmodules()` line 144/146：`["submodule", "update", "--init", "--recursive"]` → 加 `--progress`（git ≥2.11 支持；克隆大子模块同样受非 TTY 无进度影响）。`init`/`sync`/`status` 不联网传输，不加。
5. 测试更新：
   - `server/services/remote.service.test.ts` — 现有断言 `runNetworkGit` args 的用例（pull/fetch 相关）需同步加 `--progress`；
   - `server/services/git-net.test.ts` — 新增用例：stderr 含进度行 + 真实错误行时，reject 的 message 不含进度行、保留错误行与 `remote:` hook 行。

## 分步方案

1. 改 `git-net.ts`：新增 `stripProgressLines(stderr)` 内部函数并接入 close 回调的 reject 消息构造；先跑 `git-net.test.ts` 旧用例确认不回归。
2. 改 `remote.service.ts` 8 处 args；同步更新 `remote.service.test.ts` 的 args 断言。
3. 改 `repo.service.ts` clone、`submodule.service.ts` update。
4. 新增 git-net 进度行过滤单测。
5. 全量 `pnpm test` + `typecheck:web` + `typecheck:server` + ReadLints。
6. 实跑冒烟：在真实仓库跑一次 fetch（走 app 后端路径不可行，则直接 `git fetch --progress 2>&1` 验证管道下 stderr 确有进度输出）。
7. 提交（独立 commit，不与上一轮中文化混合）；打包 `pnpm build:electron` 可与中文化改动一次打包。

## 验证方法

- `pnpm exec vitest run server/services/git-net.test.ts server/services/remote.service.test.ts`：新旧用例全绿
- `pnpm test` 全量 367+ 绿；`typecheck:web` / `typecheck:server` 退出码 0
- 冒烟：管道环境 `git fetch --progress` stderr 出现 `remote: Enumerating objects` / `Receiving objects` 等行（证明进度会持续喂给 block 定时器）
- 打包重启后人工验证：拉一个大仓库不再 120s 报「操作超时」（此条只能用户侧验证）

## 回滚点

- 单独 commit，`git revert <hash>` 即可整体还原；无配置/schema 变更
- 生效需要重新打包 + 重启 app（与中文化改动相同）；回滚同理

## 风险与不确定

- `--progress` 自 git 1.7+（submodule update --progress 自 2.11+）即支持，兼容风险极低
- 进度行过滤只删标准统计行，`remote:` 的 hook/权限错误行全部保留；若 git 未来改进度文案，最坏情况是错误提示变长，不影响功能
- 「>120s 传输不被误杀」无法离线端到端复现（需真实大仓库慢网），依赖 git 文档语义 + 进度行持续输出的冒烟证据；用户侧实测是最终验证
- 走 simple-git 的 clone / submodule update 的进度同样会被 simple-git 收集，仅影响其内部 block 计时（simple-git 的 block 语义同为「无输出即 kill」），行为与 runTracked 一致
