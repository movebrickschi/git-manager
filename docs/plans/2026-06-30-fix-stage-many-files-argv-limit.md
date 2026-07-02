# 修复「添加到 VCS / 批量 git 操作」在数百文件时点击无反应或报错

## 目标
让 git-manager 在一次性 stage / unstage / commit / discard **数百~数千个文件**时稳定成功，
根除「点击『添加到 VCS（暂存）』无反应、有时报错」的问题。

## 根因（已用证据确认）
- 复现仓库 `C:\lcc\workspace\hellome`：未跟踪文件 **664** 个，路径字符总和 **44,884**，
  拼成的 `git add -- <p1> <p2> …` 命令行长度 ≈ **45,558** 字符。
- Windows `CreateProcess` 命令行上限 **32,767** 字符 → 45,558 ≫ 32,767 → 子进程在 OS 边界 spawn 失败。
- 后端把全部路径摊进单条 argv：
  - `server/services/status.service.ts`
    - `stageFilesBatch` → `git.raw(["add","--",...filePaths])`（本次报障入口）
    - `unstageFilesBatch` → `git.raw(["reset","HEAD","--",...filePaths])`
    - `commitFiles` → `git.raw(["add","--",...])` + `git.raw(["commit","-m",msg,"--",...])`
    - `discardFilesBatch` 快路径 → `reset/checkout/restore -- ...filePaths`
- 前端 `bulkStage`（`src/composables/useBulkActions.ts`）有 try/catch 弹 `暂存失败:`，
  但 OS 边界失败的传播不稳定：可能立即报错，也可能挂到 simple-git 的 block 超时（120s，见 `_helpers.ts` `REMOTE_GIT_TIMEOUT_MS`）才失败 → 表现为「无反应 / 有时报错」。
- 注意：`deleteFilesBatch` 用逐文件 `fs.unlink`（Promise.all），不走 argv，**不受影响**。
- `git --version` = 2.45.1，已确认支持 `--pathspec-from-file <file>` + `--pathspec-file-nul`。

## 方案
统一改用 **`--pathspec-from-file`（NUL 分隔临时文件）** 传路径，彻底绕开 argv 长度限制：
单条 git 命令把任意数量路径写进临时文件，再 `--pathspec-from-file=<tmp> --pathspec-file-nul`。
相比「分块多次 add」更优：commit 无法被拆成多次（会变多个 commit），pathspec-from-file 是唯一干净解；
且 NUL 分隔对含空格 / Unicode 的路径天然安全。

## 影响面（精确到文件 / 函数）
1. `server/services/_helpers.ts`
   - 新增 `runGitPathspecFromFile(repoPath, subArgs: string[], filePaths: string[]): Promise<string>`
   - 实现：`fs.mkdtemp` → 写 `filePaths.join("\0")` → `git.raw([...subArgs, "--pathspec-from-file=<tmp>", "--pathspec-file-nul"])` → `finally` 清理临时目录
   - 复用已有 import：`fs`、`os`、`path`、`getGit`
2. `server/services/status.service.ts`
   - `stageFilesBatch` → `runGitPathspecFromFile(repoPath, ["add"], filePaths)`
   - `unstageFilesBatch` → `runGitPathspecFromFile(repoPath, ["reset","HEAD"], filePaths)`
   - `commitFiles` → add 步用 `runGitPathspecFromFile(...,["add"],...)`；commit 步用 `runGitPathspecFromFile(...,["commit","-m",message],...)`，保留原 `match` 取短 id 逻辑
   - `discardFilesBatch` 快路径 → reset/checkout/restore 三处改走 helper；**保留**整体失败后的逐文件回退分支
   - 各函数空数组 no-op 行为不变
3. `server/services/status.service.test.ts`
   - 新增「大批量」回归用例：生成 ~600 个 60+ 字符名的文件（旧实现必溢出、新实现必通过），断言全部进 staged
   - 现有小批量用例保持通过

## 分步方案（每步可独立验证）
1. 写 helper（仅新增函数，不动调用点）→ `npm run typecheck:server`
2. 改 `stageFilesBatch` 一处 → 加大批量 stage 测试 → `vitest run status.service.test.ts`
3. 改 `unstageFilesBatch` / `commitFiles` / `discardFilesBatch` → 跑全量 status 测试
4. 应用层验证：git-manager 打开 hellome，全选 664 → 添加到 VCS → 成功进暂存

## 验证方法
- typecheck：`npm run typecheck:server`（或全量 `npm run typecheck`）
- 单测：`npx vitest run server/services/status.service.test.ts`
- 手动：hellome 全选 664 文件「添加到 VCS」应秒级成功，无报错、无 120s 卡顿

## 回滚点
- 仅改 3 个文件，`git checkout -- server/services/_helpers.ts server/services/status.service.ts server/services/status.service.test.ts` 即还原
- 纯 Node/TS 改动，**无需**重装任何补丁、**无需**重启 Cursor

## 风险与不确定
- `--pathspec-file-nul` 需要写 NUL 分隔文件；`fs.writeFile(..., "utf8")` 写入 `\0`（0x00）正常，Unicode 路径无损
- unborn 仓库（无 HEAD）下 `reset HEAD` 仍会报错——保持现有「透传给调用方」行为
- 临时文件用 `finally` + `fs.rm({force:true})` 清理，异常路径不残留
- 可选（不在本次核心范围）：前端在「选中即全部 untracked+unstaged」时直接调 `stageAll`（`git add -A`）做快捷优化——是否纳入由你定

## 追加范围（第二轮 · 用户确认：修 stash + 加固 submodule，一起重打包）
全量审计后发现还有同款 argv 溢出隐患，已一并处理：

1. `server/services/stash.service.ts` · `stashFiles`
   - 原 `git stash push --include-untracked [-m msg] -- <...filePaths>` → 数百文件溢出
   - **实测发现**：即便用 `--pathspec-from-file` 绕过我们这层，`git stash` 内部仍会 spawn
     `git clean` 清理 untracked 并把 pathspec 展开成 argv → `cannot spawn git: Filename too long`，
     且此时 stash commit 已建、工作区没清 → 留下「有 entry 但文件还在」的半残状态（比原来更糟）。
   - **改用**：先 `git add`（pathspec-from-file，任意数量不溢出）把选中文件入索引，
     再 `git stash push --staged`（只搁置暂存区、无需 pathspec → 不触发内部 argv 展开）。
     单命令产出单 entry，工作区清理干净（700 文件实测通过）。需 git ≥ 2.35（用户 2.45）。
   - 语义保护：stash 前把「已暂存但未选中」的外部文件先 reset 取消暂存、stash 后再 add 还原，
     保证只搁置选中项、不波及用户其它已暂存工作。
2. `server/services/_helpers.ts` · 新增 `runGitArgsChunked(git, baseArgs, paths, budget=6000)`
   - 给**不支持** `--pathspec-from-file` 的子命令用（已确认 `git submodule` 不支持）
   - 按命令行长度预算分块跑 `git <baseArgs> -- <chunk>`，单路径超预算也独立成块（保证推进）
3. `server/services/submodule.service.ts` · `initSubmodules` / `updateSubmodules` / `syncSubmodules`
   - 原 `args.push("--", ...paths)` → 改为 paths 非空时走 `runGitArgsChunked`，空则原样全量
   - 用 `getLongTimeoutGit` 实例（保留子模块 5 分钟超时）；submodule init/update/sync 对分块幂等
4. 测试
   - `stash.service.test.ts`：700 长路径文件一次搁置 → 仅 1 个 stash entry + 工作区清理
   - `_helpers.test.ts`：`runGitArgsChunked` budget 极小时分多块、空数组 no-op

安全无需改动（已审计确认）：主「提交」按钮（`git commit -m`，提交索引无文件列表）、删除（逐个 unlink）、
复制路径（前端）、作为/创建补丁（多选禁用，仅单文件）、添加到 .gitignore（单文件）、过滤规则（前端列表）。

## 第三轮 · 推送预览为空 + 自动设上游（用户确认：两个都修）
现象：「提交并推送」后弹框显示「无待推送的提交」。实测 reflog 证明推送其实已成功（origin/dev=HEAD），
当下为空是准确的；但查出一个真实隐患并修复：

1. `server/services/remote.service.ts` · `getUnpushedCommits`
   - 原固定用 `<remote>/<branch>..HEAD`；分支**首次推送**（`refs/remotes/<remote>/<branch>` 不存在）时该
     区间报错 → catch 吞成 `[]` → 预览误显示「无待推送」。
   - 修复：先 `rev-parse --verify --quiet refs/remotes/<remote>/<branch>` 判存在；不存在时回退
     `HEAD --not --remotes=<remote>`，正确列出首次推送将发送的提交。无显式 remote/branch 时，
     无 upstream 回退 `HEAD --not --remotes`。
2. `server/services/remote.service.ts` · `push`
   - 自动建立上游：显式 `setUpstream` 或该分支当前无 upstream 时，自动带 `--set-upstream`
     （首次推送即写 branch.<name>.remote/merge），之后 ahead/behind 与预览的 `@{u}` 分支才正常。
3. 测试
   - `remote-unpushed.test.ts`（真实 git）：新分支远端不存在→列出提交、已存在最新→空、领先→只列领先项
   - `remote.service.test.ts`（mock）：push 无 upstream→自动 `--set-upstream`；已有 upstream→不加；显式勾选→加且不再查
