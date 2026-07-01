# Pull 报英文「未指定分支」错误 → 全量中文化

## 目标
git-manager 点击 Pull 时，若当前分支无上游（upstream/tracking），会弹出 git 原生英文错误
（`You asked to pull from the remote 'origin', but did not specify a branch...`）。
目标：让该类 git 错误提示在 UI 红框中显示为中文；（可选）从根因上让「无上游分支」的 Pull 更友好。

## 根因（已用命令验证）
- 受管仓库为 **linger**（`C:/lcc/workspace/empty/linger`），当前分支 `experiment/phase0-align-pchat`
  **无 upstream**：`git rev-parse --abbrev-ref @{u}` → `fatal: no upstream configured`。
- `src/components/log/BranchesPane.vue` `handlePull()`：分支无 upstream 时回退
  `resolveDefaultRemote()` = `"origin"`，调用后端 `remote.service.ts` `pull(repoPath, "origin")`，
  实际执行 `git pull origin`（**只有 remote、没有 branch**）。
- git 因「当前分支无上游 + origin 非该分支默认远程」拒绝，打印英文 stderr。
- 该 stderr 经 `src/utils/git-error.ts` `translateGitError()` 处理，但 `PATTERN_MAP` 无匹配项
  → 命中「原文兜底」分支 → 直接显示英文。

## 影响面（精确到文件）
- 主改：`src/utils/git-error.ts` —— `PATTERN_MAP` 增补 3 条正则映射。
- 测试：`src/utils/git-error.test.ts` —— 新增 3 条用例。
- 可选（B 方案）：`src/components/log/BranchesPane.vue`（`handlePull` / `pullForLocalBranch` /
  `updateBranchWithoutCheckout` 无上游分支处理）；若要 Pull 真正成功还需扩展后端
  `server/services/remote.service.ts` `pull()` 支持传 branch 参数。

## 分步方案
### A 方案（纯中文化，推荐先做，低风险）
1. `git-error.ts` `PATTERN_MAP` 在通用兜底前增补：
   - `/you asked to pull from the remote.*did not specify a branch/is`
     → 「当前分支未设置上游分支，无法确定要拉取哪个远程分支。请先 Push 建立上游，或右键分支指定拉取来源。」
   - `/there is no tracking information for the current branch/i`
     → 「当前分支没有跟踪信息（未设置上游）。请先 Push 建立上游后再 Pull。」
   - `/no candidate for merging|no source branch/i`
     → 「找不到可合并的远程分支，请检查分支的上游设置。」
2. `git-error.test.ts` 新增 3 条用例覆盖以上模式。

### B 方案（根因优化，可选，需你二次确认）
- `handlePull` 检测到无 upstream 时：改为 `git pull <remote> <branch>`，或自动 set-upstream，
  或弹中文引导「先 Push」。涉及后端 `pull()` 增加 branch 参数，改动较大、风险更高，单独排期。

## 验证方法
- 单测：`pnpm vitest run src/utils/git-error.test.ts`（新增用例全绿）。
- 类型：`pnpm tsc -p tsconfig.json --noEmit`（或项目既有 `engineering-check`）。
- 手动：在无上游分支点 Pull，确认红框显示中文。

## 回滚点
- 仅 A 方案：`git checkout -- src/utils/git-error.ts src/utils/git-error.test.ts` 即还原；
  无需重启 / 重装，纯前端字符串映射。
- B 方案回滚：额外还原 `BranchesPane.vue` / `remote.service.ts` 对应改动。

## 风险与不确定
- A 方案低风险（纯映射，不改 git 行为）；但只把英文变中文，Pull 本身仍不会成功
  ——「无上游」本就需要用户先 Push。
- 若你的真实诉求是「Pull 要能成功」，需走 B 方案（改 git 行为，风险更高，须二次确认）。
- 中文文案措辞可按你偏好调整。

---

## 执行记录（2026-07-01 · 用户确认「所有英文提示全部改中文」→ 扩大到全量 i18n）

用户明确要求「将所有英文提示全部改为中文」，故不止 A 方案，而是全量把「会显示给用户的
git 英文文案」中文化。根因发现：真正的问题不止「翻译表缺一条」，而是**很多组件直接展示
raw `result.message` / `e.message`，绕过了翻译层**（此前只有 BranchesPane / ReflogDialog 翻）。

### 改动点
1. **翻译层 `src/utils/git-error.ts`**：`PATTERN_MAP` 新增约 20 条常见 git stderr
   （无上游 / no tracking / has no upstream / failed to push / updates were rejected /
   everything up-to-date / already up-to-date / automatic merge failed / pathspec /
   nothing to commit / 身份未配置 / dubious ownership / SSL / 403 / 401 / unable to access 等）；
   放宽 `not a git repository`；`translateRaw` 增加「裸错误码字符串」兜底（生产模式后端只回 code）。
2. **统一错误展示 helper `src/utils/error.ts`**：新增 `errText(e) = translateGitError(errMsg(e))`；
   `errMsg` 保持原样（写日志用，不翻译）。
3. **后端 cosmetic 文案改中文**（不动 classifyError 关键字）：
   `remote.service.ts`（拉取完成 / 拉取失败 / 拉取产生了合并冲突 / 强制拉取失败…）、
   `branch.service.ts`（变基完成 / 自动压缩变基完成 / 拣选完成 / 回滚完成）、
   `patch.service.ts`（补丁已应用 / 补丁内容为空）。
4. **前端把 raw 展示全部改走翻译**：PushDialog、CommitsPane、StashList、rebaseStore、
   branchStore、useMergeState、useAutoFetch、MainLayout、WelcomeView、BranchesPane（6 处 catch
   改走 friendlyErr），以及 reveal/ChangedFilesPane/LocalChangesView/GitLogView/HooksDialog/
   CompareBranchesDialog/FileHistoryDialog/WorktreeDialog/useBulkActions（errMsg→errText）。
5. **测试**：`git-error.test.ts` 新增 9 条用例；`remote.service.test.ts` 同步「Pull completed」→「拉取完成」。

### 验证结果（全绿）
- `pnpm test`：41 文件 / 363 用例通过
- `pnpm run typecheck:web`：通过
- `pnpm run typecheck:server`：通过
- 受影响文件 ReadLints：无错误

### 已知边界
- git 可能输出任意英文 stderr，未命中 PATTERN_MAP 的**罕见**原文仍按原样显示（无法穷举翻译）；
  常见路径已覆盖，后续遇到新英文再往 PATTERN_MAP 补一条即可。
- 本次仅做「翻译」，未改 git 行为：**无上游分支的 Pull 仍会失败**（现在是中文提示，引导先 Push）。
  若要「无上游也能 Pull 成功」，需另做 B 方案。
- 桌面版是 Electron 打包应用：改动需**重新构建 / 重启**才能看到；`pnpm dev:electron` 开发模式下热更新即可。
