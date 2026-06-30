# 状态栏「联网中…」只跟随当前激活仓库

## 目标
让状态栏的「联网中…[中止]」胶囊只在**当前激活仓库**有在途联网操作（push/pull/fetch 等）时显示，而不是任意已打开仓库在联网就常亮。解决「在 hellome 标签看到的其实是后台 Auto-fetch hz-hermes-3」的误导。

## 影响面（精确到文件/行）
1. `src/utils/network-busy.ts`
   - 新增导出函数 `isRepoNetworkBusy(repoPath?: string | null): boolean`，读取既有 `counts` Map（在 Vue computed 内调用时，reactive Map 的 `.get(key)` 会被追踪，故可响应式）。
   - 不改动 `isNetworkBusy` / `networkBusyRepos` / `beginNetwork` / `endNetwork` / `runNetworkBusy`（保持向后兼容）。
2. `src/components/common/StatusBar.vue`
   - 第 8 行 import：增加 `isRepoNetworkBusy`（`isNetworkBusy` 不再用于模板，`networkBusyRepos` 改由 cancel 逻辑按需保留/移除）。
   - 新增 computed：`const activeRepoNetworkBusy = computed(() => isRepoNetworkBusy(repoStore.activeRepo?.path));`
   - 第 28–36 行 `cancelNetwork()`：从「遍历 networkBusyRepos 全杀」改为「只中止当前激活仓库」`commands.cancelNetworkOps(repoStore.activeRepo?.path)`（与只显示当前仓库的语义一致）。
   - 第 104 行模板：`v-if="isNetworkBusy"` → `v-if="activeRepoNetworkBusy"`。
3. `src/utils/network-busy.test.ts`
   - 新增用例：`isRepoNetworkBusy("/a")` 在 begin/end 前后为 true/false；不同 repo 互不影响。

## 分步方案（每步可独立验证）
1. 在 `network-busy.ts` 加 `isRepoNetworkBusy` 并补单测 → 跑 `pnpm test src/utils/network-busy.test.ts`。
2. 改 `StatusBar.vue` 的 import + computed + 模板 v-if + cancelNetwork 作用域 → `pnpm typecheck`。
3. 全量构建确认无回归 → `pnpm build`。

## 验证方法
- 单测：`pnpm test src/utils/network-busy.test.ts` 全绿（含新用例）。
- 类型：`pnpm typecheck` 无错；`pnpm build` 成功。
- 手动：同时打开 hellome 与 hz-hermes-3；触发 hz-hermes-3 后台/手动 fetch（大包慢传）：
  - 停在 hellome 标签 → 胶囊**不**显示；
  - 切到 hz-hermes-3 标签 → 胶囊显示，点「中止」只杀该仓库的联网子进程。

## 回滚点
- 改动仅 2 个源文件 + 1 个测试文件，无补丁/无需重装 cursor-patch、无需重启外部进程。
- 回滚：`git checkout -- src/utils/network-busy.ts src/components/common/StatusBar.vue src/utils/network-busy.test.ts`（这三者本次新增/修改部分）。

## 风险与不确定
- **响应式追踪**：依赖 Vue 3 reactive Map 对「当前不存在的 key 的 `.get` 也能追踪、后续 `set` 触发」。已知 Vue 3 支持，但用新单测 + 手动切换标签二次确认。
- **key 字符串匹配**：`repoStore.activeRepo.path` 必须与 `beginNetwork` 收到的 `repoPath`（前端命令首参）完全一致。已核对调用方（PushDialog / Auto-fetch / 分支操作）均使用 repo 的 `.path`，一致。
- **「中止」语义收窄**：原先一键中止所有仓库，现仅中止当前仓库；后台别的仓库卡住时需切到该仓库标签再中止。符合方案 1 的「只看当前项目」预期，属可接受取舍。
