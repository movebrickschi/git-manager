# Git Manager × Daily Newspaper Generator 集成方案

> **状态**：草案 v1（待人工卡点确认后进入实施）
> **维度**：功能合并 / 跨项目重写（Kotlin/Java IDEA 插件 → TypeScript/Electron 桌面端）
> **来源项目**：`C:\lcc\workspace\daily_newspaper_generator`（Kotlin + IntelliJ Platform）
> **目标项目**：`C:\lcc\workspace\git-manager`（Vue 3 + Electron + Express）
> **更新时间**：2026-05-19

---

## 0. 决策摘要（TL;DR）

1. **完全可以集成，且天然契合**。`git-manager` 已具备约 90% 底层能力（Git log 抽取、AI OpenAI 兼容协议、多仓库、safeStorage 加密、Monaco 编辑器、Pinia 状态），daily_newspaper_generator 的全部功能可以在不引入新依赖的情况下重写实现。
2. **Java/Kotlin 源码不可直接搬运**，但功能逻辑可以 1:1 映射到 TypeScript。原项目 ~200KB 源码、约 50 个文件，移植后预计 12–15 个新增 TS/Vue 文件、约 4000–6000 行。
3. **AI 配置共用**（用户明确决策）：commit message 生成与日报润色**共用同一份 `apiKey` / `baseUrl` / `model`**，仅各自保留独立的"风格/语言/输出格式"小字段。需对现有 `AiSettings` 做一次轻量重构（向下兼容）。
4. **本文为方案文档，不动任何代码**。代码实施需要在 4 个强制人工卡点逐一通过后，分期推进（P0 → P1 → P2）。

---

## 1. 背景与目标

### 1.1 现有产品

- `git-manager` 是 IDEA 风格的桌面 Git 客户端，已支持 Log/分支/工作区/Diff/Stash/Blame/冲突/远程/多仓库/AI commit message 9 大模块。
- `daily_newspaper_generator` 是 IntelliJ IDEA 插件，唯一职责是把 Git 提交记录转成结构化日报/周报/月报。

两者用户高度重叠（都是开发者）。把日报功能并入 `git-manager` 后，用户在同一桌面应用内可以完成：
**写代码 → 提交（AI 生成 commit message）→ 周末/日终一键生成日报 → 复制 / 推送钉钉企微飞书**。

### 1.2 目标

- **G1**：在 git-manager 内提供等价于 daily_newspaper_generator 的全部能力，UI 风格遵守现有 IDEA 暗色主题。
- **G2**：复用现有 `simple-git` Git 后端与 `ai.service.ts` AI 服务；不引入新的网络/Git 依赖。
- **G3**：commit message 与日报润色共用 API Key 与 Base URL 配置，仅独立配置"风格/语言/格式"等业务字段。
- **G4**：MVP（P0）能生成 + 复制 + AI 润色，二期（P1）再加多渠道 Webhook 推送。
- **G5**：保持 Electron / Web / 纯前端三模式全部可用（同 git-manager 现有架构）。

### 1.3 非目标

- 不实现"自动定时生成并推送"（cron / 调度），由用户手动触发。
- 不接入语音 / 图片 / 文件类报告输出，只产 Markdown / 纯文本。
- 不重写 daily_newspaper_generator 的 IDEA 插件版本（原项目继续独立维护）。
- 不引入第二份 AI Provider 体系，全部走 OpenAI 兼容协议。

---

## 2. 用户故事

| 编号 | 角色 | 故事 | 验收 |
|---|---|---|---|
| US-1 | 程序员小张 | 下班前 5 分钟，打开 git-manager，选"今日"，自动汇总今天的提交，复制到钉钉发给领导 | ≤30 秒完成 |
| US-2 | 团队 Lead | 周五，选"本周 + 团队全部作者 + 多仓库"，生成按项目分组的周报，AI 润色后导出 Markdown | 报告含 3 个仓库、按项目分组、AI 改写过 |
| US-3 | 远程开发者 | 月底，选"本月 + 自己 + 排除 merge/revert"，一键推送到企业微信群机器人 | Webhook 推送成功，群里收到结构化消息 |
| US-4 | 新人 | 第一次用，不想配 AI，纯靠"提取 + 复制"也能工作 | 不配 AI 时 ✨ 按钮 disabled，普通生成按钮可用 |

---

## 3. 功能需求

### 3.1 必须项（P0 / MVP）

| 编号 | 需求 |
|---|---|
| FR-01 | 时间维度预设：今日 / 昨日 / 本周 / 上周 / 本月 / 上月 / 自定义区间 |
| FR-02 | 作者过滤：当前用户（默认） / 任意作者多选 / 全部 |
| FR-03 | 项目过滤：当前仓库 / 多仓库联合 / 排除指定仓库 |
| FR-04 | 分支过滤：当前分支 / 所有本地分支 / 远程分支 / 指定分支白名单 |
| FR-05 | 关键字过滤：commit message 包含/不包含某关键字 |
| FR-06 | 自动去重：合并 commit（`merge` 字样 / 双父）、Revert commit、重复 message |
| FR-07 | 输出格式：Markdown（默认）/ 纯文本，两种均可一键切换 |
| FR-08 | 分组规则：按"项目 → 模块（commit message 前缀 feat/fix/perf…）→ 日期"三层分组 |
| FR-09 | 一键复制：剪贴板写入（Electron `clipboard` / Web `navigator.clipboard`） |
| FR-10 | AI 润色：把"裸 commit 列表"调用 LLM 改写成成果性自然语言 |
| FR-11 | 配置共用：润色复用 commit 生成同一份 `apiKey` / `baseUrl` / `model` |

### 3.2 二期（P1）

| 编号 | 需求 |
|---|---|
| FR-20 | 渠道推送：钉钉机器人 / 企业微信机器人 / 飞书机器人 / 通用 Webhook |
| FR-21 | 多渠道并发推送：勾选 N 个渠道 → `Promise.all` 并行投递，单个失败不影响其它 |
| FR-22 | 渠道密钥加密：webhook secret / access_token 通过 `safeStorage` 加密落盘 |
| FR-23 | AccessToken 缓存：钉钉/企微的 token 在过期前缓存复用 |
| FR-24 | Prompt 模板库：用户可保存多个润色风格的 prompt（正式/活泼/Bullet/无 emoji 等） |
| FR-25 | 导出为文件：Markdown / TXT / HTML（带样式）三选一另存为 |

### 3.3 三期（P2）

| 编号 | 需求 |
|---|---|
| FR-30 | 定时调度：每日 18:00 自动生成今日日报到剪贴板 / 推送（可选） |
| FR-31 | 历史报告记录：本地保存生成过的所有报告，可重看 / 二次润色 |
| FR-32 | 团队聚合视图：多人 commit 按人分组并并排展示 |
| FR-33 | 工时估算：根据 commit 数与 diff 大小估算工作量（loc / 时 / 任务） |

---

## 4. 技术方案

### 4.1 总体架构

```
┌──────────────────────────────────────────────────┐
│  Vue 3 前端 (src/components/report/)             │
│  ├─ ReportPanel.vue       主面板                 │
│  ├─ ReportFilterBar.vue   过滤条件               │
│  ├─ ReportPreview.vue     Markdown 预览 / 编辑    │
│  └─ ChannelSettingsDialog.vue  渠道配置(P1)      │
└──────────────────────────────────────────────────┘
                     ↕  reportBridge.ts (双模式)
        ┌─────────────────────┬─────────────────────┐
        ↓                     ↓                     ↓
┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐
│  Electron IPC  │  │ Express /api     │  │ shared/  (纯函数)│
│ report-handlers│  │ /report  /channel│  │ report-filter.ts │
│  + safeStorage │  │                  │  │ report-grouper.ts│
└────────────────┘  └──────────────────┘  │ report-prompt.ts │
        ↓                     ↓            └─────────────────┘
┌──────────────────────────────────────────────────┐
│  server/services/                                │
│  ├─ report.service.ts   抽取 + 过滤 + 去重 + 分组   │
│  ├─ channel.service.ts  钉钉/企微/飞书/Webhook(P1)│
│  └─ ai.service.ts       (已存在, 复用)           │
└──────────────────────────────────────────────────┘
                     ↓
              simple-git (已存在)
```

### 4.2 Java → TypeScript 映射表（来源精确到文件）

| 来源文件（daily_newspaper_generator） | 目标文件（git-manager） | 移植策略 |
|---|---|---|
| `utils/GitCommitExtractor.java` (27KB) | `server/services/report.service.ts` | 用 `simple-git` 的 `log({from, to, '--author': X, '--all': true})` 重写；去掉 Git4Idea 依赖 |
| `utils/ExtractOptions.java` | `shared/types.ts` 新增 `ReportFilter` interface | 直接对应 DTO |
| `utils/GitUserUtil.java` | `server/services/report.service.ts` 内函数 | `git config user.name / user.email` |
| `utils/PolishCache.java` | `server/services/report.service.ts` 内 `Map` | 同 process 内 LRU，无需持久化 |
| `utils/ExportService.java` | `src/utils/exportReport.ts` | 浏览器/Electron 各写一个分支 |
| `utils/ReportActionRunner.java` | `src/stores/report.ts` 动作 | Pinia action |
| `utils/LlmUtil.java` | `shared/ai/report-prompt-builder.ts` | 纯函数，单元可测 |
| `llm/LlmClient.java` (16KB) | **复用** `server/services/ai.service.ts` | 仅追加一个 `polishReport(prompt, opts)` 方法 |
| `config/LlmSettings.java` | **复用** `ai-settings.json` + 加 `report` 子段 | 见 §5 配置共用方案 |
| `config/PromptTemplate.java` | `shared/types.ts` 新增 `PromptTemplate` | P1 启用 |
| `config/SecureKeyStore.java` | **复用** Electron `safeStorage`（已用于 ai-apikey） | 同套路加密 channel token |
| `config/ChannelConfig.java` | `shared/types.ts` 新增 `ChannelConfig` | P1 启用 |
| `channel/ChannelSender.java` + 注册中心 | `server/services/channel.service.ts` 内策略对象 | P1，每个 vendor 一个函数 |
| `channel/DingTalkRobotSender.java` | `channel.service.ts → sendDingTalk()` | P1，普通 fetch |
| `channel/DingTalkReportSender.java` | `channel.service.ts → sendDingTalkReport()` | P1，企业内部机器人 |
| `channel/FeishuRobotSender.java` | `channel.service.ts → sendFeishu()` | P1 |
| `channel/WeComRobotSender.java` | `channel.service.ts → sendWeCom()` | P1 |
| `channel/GenericWebhookSender.java` | `channel.service.ts → sendGenericWebhook()` | P1 |
| `channel/AccessTokenCache.java` | `channel.service.ts` 内 `Map<vendor, {token, expiresAt}>` | P1 |
| `channel/HttpUtil.java` | 直接用 `fetch`（Node 20+ 原生） | — |
| `action/Extract*Action.java` × 3 | `src/stores/report.ts` 三个 action | — |
| `action/Generate*ByAI*Action.java` × 2 | `src/stores/report.ts` 两个 action | — |
| `ui/ReportDialog.java` (20KB) | `src/components/report/ReportPanel.vue` | 主面板拆分 |
| `ui/ExtractRangeDialog.java` (14KB) | `src/components/report/ReportFilterBar.vue` | 过滤栏 |
| `ui/AuthorAutoCompleteField.java` | `src/components/report/AuthorPicker.vue` | 用 `@vueuse/core` 的 `useFuse` 做模糊匹配 |
| `ui/SimpleDatePickerField.java` | 用 HTML5 `<input type="date">` 或 `vue-datepicker` | — |
| `ui/MarkdownRenderer.java` (14KB) | 复用 Monaco Editor（已在用） | Markdown 语法 + 预览 split-pane |
| `ui/ChannelListPanel.java` (17KB) | `src/components/report/ChannelSettingsDialog.vue` | P1 |
| `ui/PromptTemplateListPanel.java` (12KB) | `src/components/report/PromptTemplateDialog.vue` | P1 |
| `ui/UiTokens.java` | 复用 Tailwind 与现有 `:root` CSS 变量 | — |
| `ui/RoundedBadge.java` | Tailwind 类即可 | — |
| `ui/StatusNotifier.java` | 复用现有 toast 系统 | — |
| `i18n/DailyReportBundle.properties` × 2 | `src/i18n/locales/zh.json` / `en.json` 追加键 | 已有 vue-i18n |

### 4.3 不变项（git-manager 现状直接复用）

| 现有能力 | 文件 | 复用方式 |
|---|---|---|
| Git 命令底座 | `server/services/log.service.ts` | 在 `report.service.ts` 内部调用 |
| AI 调用底座 | `server/services/ai.service.ts` | 抽出通用 `chatCompletions()`，commit 与 report 各自包一层 |
| 双模式桥 | `src/services/ai/` 套路 | 报告功能照抄一份 `src/services/report/` |
| 多仓库 | 现有 repo store | `ReportFilter.repos: string[]` 引用 |
| safeStorage 加密 | `electron/ai-handlers.ts` | 同套路加密 channel secret（P1） |

---

## 5. 配置共用方案（用户明确要求）

### 5.1 现状

```ts
// shared/ai/types.ts (当前)
interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  commitStyle: CommitStyle;  // 仅 commit 用
  lang: CommitLang;          // 仅 commit 用
  timeout: number;
  maxDiffChars: number;      // 仅 commit 用
}
```

`commitStyle` / `lang` / `maxDiffChars` 是 **commit 专属**字段，混在顶层 `AiSettings` 里，无法承载报告的"润色风格 / 报告语言 / 最大输入 token"等独立参数。

### 5.2 重构后

```ts
// shared/ai/types.ts (建议)
interface AiConnectionSettings {        // 连接层（共用）
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout: number;
}

interface CommitAiSettings {            // commit 专属
  style: CommitStyle;
  lang: CommitLang;
  maxDiffChars: number;
}

interface ReportAiSettings {            // 报告专属 (新增)
  polishStyle: 'formal' | 'casual' | 'bullet' | 'narrative';
  lang: ReportLang;                     // 'zh' | 'en' | 'auto'
  maxInputChars: number;                // 报告输入截断阈值
  promptTemplateId?: string;            // P1：选用哪份 prompt 模板
}

interface AiSettings extends AiConnectionSettings {
  commit: CommitAiSettings;
  report: ReportAiSettings;
}
```

### 5.3 落盘格式（向后兼容）

```jsonc
// {userData}/ai-settings.json  (Electron)
// ~/.git-manager/ai-settings.json  (Web)
{
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-chat",
  "timeout": 30000,
  "commit": {
    "style": "cc",
    "lang": "auto",
    "maxDiffChars": 16000
  },
  "report": {
    "polishStyle": "formal",
    "lang": "zh",
    "maxInputChars": 32000
  }
}
```

`apiKey` 仍走 `ai-apikey.json` + `safeStorage`，**单独一份不变**。

### 5.4 迁移逻辑

读取旧 `ai-settings.json`（无 `commit` / `report` 子段）时，加载器自动把 `commitStyle` / `lang` / `maxDiffChars` 包成 `commit` 子对象、并补默认 `report` 段。第一次写入时自然完成升级。**无破坏性变更**。

### 5.5 设置面板 UI

`AiSettingsDialog.vue` 改造为三段式：

```
┌────────────────────────────────┐
│ [常规]   [Commit 生成]   [日报润色] │  ← Tab 切换
├────────────────────────────────┤
│ 常规：                         │
│   预设 / Base URL / 模型 /     │
│   API Key / 超时 / 测试连接    │
│                                │
│ Commit：风格 / 语言 / 最大 diff  │
│ 日报：润色风格 / 语言 / 最大输入  │
└────────────────────────────────┘
```

API Key 在"常规"配一次，commit ✨ 与日报 ✨ 都自动用同一份。

---

## 6. 新增文件清单

> P0 必须，P1 二期再加。

| # | 路径 | 作用 | 期 |
|---|---|---|---|
| 1 | `shared/types.ts` (增段) | `ReportFilter` / `ReportEntry` / `ReportGroup` DTO | P0 |
| 2 | `shared/ai/types.ts` (重构) | 拆分 commit / report 子段，向后兼容加载器 | P0 |
| 3 | `shared/report/report-filter.ts` | 纯函数：过滤 + 去重（merge/revert/duplicate） | P0 |
| 4 | `shared/report/report-grouper.ts` | 纯函数：按项目/模块/日期分组 | P0 |
| 5 | `shared/ai/report-prompt-builder.ts` | 纯函数：拼装润色 prompt | P0 |
| 6 | `server/services/report.service.ts` | simple-git log + 调用 filter/grouper + 调用 ai.service | P0 |
| 7 | `server/routes.ts` (增段) | `GET /api/report/authors` `POST /api/report/extract` `POST /api/report/polish` | P0 |
| 8 | `electron/report-handlers.ts` | IPC: `report:extract` / `report:polish` / `report:copy` | P0 |
| 9 | `electron/preload.ts` (增白名单) | 暴露 `window.reportApi.*` | P0 |
| 10 | `src/services/report/reportBridge.ts` | 双模式桥（IPC / HTTP） | P0 |
| 11 | `src/stores/report.ts` | Pinia store（filter 状态、loading、错误、生成结果） | P0 |
| 12 | `src/components/report/ReportPanel.vue` | 主面板（侧边栏 tab 或独立路由） | P0 |
| 13 | `src/components/report/ReportFilterBar.vue` | 时间/作者/项目/分支/关键字过滤栏 | P0 |
| 14 | `src/components/report/ReportPreview.vue` | Monaco Markdown 预览 + 编辑 + 复制 + ✨ 润色 | P0 |
| 15 | `src/components/report/AuthorPicker.vue` | 作者多选 + 模糊搜索 | P0 |
| 16 | `src/i18n/locales/zh.json` `en.json` (增键) | 新增 `report.*` 命名空间 | P0 |
| 17 | `server/services/channel.service.ts` | 钉钉/企微/飞书/Generic webhook | P1 |
| 18 | `electron/channel-handlers.ts` | IPC + safeStorage 加密 channel secret | P1 |
| 19 | `src/components/report/ChannelSettingsDialog.vue` | 渠道配置对话框 | P1 |
| 20 | `src/components/report/ChannelSelector.vue` | 报告生成完毕后的"推送到 X / Y / Z" | P1 |
| 21 | `src/components/report/PromptTemplateDialog.vue` | Prompt 模板管理 | P1 |
| 22 | `shared/report/channel-types.ts` | `ChannelConfig` / `ChannelKind` / `SendResult` | P1 |

**合计**：P0 = 16 个文件；P1 = 6 个文件。

---

## 7. 数据模型与 API 契约（P0）

### 7.1 DTO

```ts
// shared/types.ts 增段
export interface ReportFilter {
  range: {
    preset?: 'today' | 'yesterday' | 'this-week' | 'last-week'
           | 'this-month' | 'last-month' | 'custom';
    fromISO?: string;       // preset='custom' 时必填
    toISO?: string;
  };
  authors?: string[];       // 空 = 当前用户; ['*'] = 所有
  repos: string[];          // 必填，至少 1 个仓库根路径
  branches?: string[];      // 空 = 当前分支; ['--all'] = 所有
  includeKeywords?: string[];
  excludeKeywords?: string[];
  excludeMerge: boolean;    // 默认 true
  excludeRevert: boolean;   // 默认 true
  dedupMessage: boolean;    // 默认 true
}

export interface ReportEntry {
  repo: string;
  branch: string;
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  dateISO: string;
  message: string;
  module?: string;          // feat/fix/perf/refactor/...（从 conventional commits 前缀提取）
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
}

export interface ReportGroup {
  level: 'repo' | 'module' | 'date';
  key: string;
  entries: ReportEntry[];
  children?: ReportGroup[];
}

export interface ReportResult {
  filter: ReportFilter;
  groups: ReportGroup[];
  markdown: string;
  plain: string;
  totalCommits: number;
  generatedAtISO: string;
}
```

### 7.2 REST API（Web 模式 / Electron IPC 同型）

| 方法 | 路径 / 通道 | 入参 | 出参 |
|---|---|---|---|
| GET | `/api/report/authors?repo=…` | repo | `{ authors: {name,email,count}[] }` |
| POST | `/api/report/extract` | `ReportFilter` | `ReportResult` |
| POST | `/api/report/polish` | `{ markdown, style?, lang? }` | `{ markdown }` (重用 ai.service) |
| IPC | `report:copy` | `{ text }` | `{ ok: true }` |

### 7.3 错误码（沿用现有 `AiErrorCode` 风格）

| code | 触发 |
|---|---|
| `NO_REPO` | filter.repos 为空 |
| `NO_COMMITS` | 过滤后 0 条 |
| `GIT_FAIL` | simple-git 报错 |
| `AI_*` | 复用现有 `AiErrorCode` |

---

## 8. UI/UX

### 8.1 入口

**待人工卡点 #2 决策**。候选方案：

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 侧边栏新 tab "日报" | 与现有"提交 / 历史 / 分支"导航统一 | 占侧边栏空间 |
| B. 顶部菜单 "工具 → 生成日报" + 独立浮窗 | 不打扰主界面 | 跟现有 IDE 风格不太一致 |
| C. 命令面板（Ctrl+Shift+P）"日报：生成" + 模态 | 极简、低噪音 | 发现性差 |
| **推荐 A**：与 IDEA 风格一致，且报告功能并非"一次性"工具 | | |

### 8.2 ReportPanel 三栏布局（参考 daily_newspaper_generator 的 ReportDialog）

```
┌──────────────────────────────────────────────────┐
│ ReportFilterBar  时间 / 作者 / 项目 / 分支 / 关键字  │
├─────────┬────────────────────────────────────────┤
│         │                                        │
│ 分组树   │  ReportPreview (Monaco Markdown)        │
│ (repo→  │  + 工具栏：复制 / ✨润色 / 导出 / 推送(P1)│
│  module→│                                        │
│  date)   │                                        │
│         │                                        │
└─────────┴────────────────────────────────────────┘
```

### 8.3 交互细节

- 切换过滤条件后**不自动重提取**，避免 git log 频繁 IO；底部"生成"按钮显式触发。
- ✨ 润色按钮与 commit ✨ 同款 hover / loading / cancel UX。
- 复制按钮显示 toast "已复制 N 条提交 / X 字符"。
- 多仓库下若某个仓库 git log 失败，显示部分结果 + 警告条，不整体失败。

---

## 9. 实施路线图

### P0（MVP，约 3–5 工日）

1. 重构 `shared/ai/types.ts` 三段式 + 向后兼容加载器（半天）
2. 新增 `report.service.ts` + 路由（1.5 天）
3. 新增 Electron IPC handler 与 preload 白名单（半天）
4. Vue 组件 `ReportPanel / FilterBar / Preview / AuthorPicker`（2 天）
5. Pinia store 与 bridge（半天）
6. 单元测试：`report-filter` / `report-grouper` / `report-prompt-builder` 三个纯函数（半天）
7. e2e 冒烟：今日 / 自定义区间 / 多仓库 / AI 润色四条主路径（半天）

### P1（多渠道推送，约 2–3 工日）

8. `channel.service.ts` 四个 vendor + AccessToken 缓存
9. safeStorage 加密 channel secret
10. UI: `ChannelSettingsDialog` + `ChannelSelector`
11. Prompt 模板库
12. 各渠道 mock test（钉钉、企微、飞书的官方"消息预览"接口可不打真实 webhook）

### P2（可选扩展，按需）

13. 定时调度
14. 历史报告持久化
15. 团队聚合视图
16. 工时估算

---

## 10. 强制人工卡点（4 道关）

实施期间，每个卡点必须用户显式 OK 才能继续：

1. **C-1（本文档）**：方案范围 / 文件清单 / API 契约是否符合预期。
2. **C-2（UI 入口）**：选 A/B/C 哪种入口形态（§8.1）。
3. **C-3（P0 完成）**：MVP 跑通后用户验收 → 确认进入 P1。
4. **C-4（全部完成）**：P1 完成后用户验收（多仓库 + 润色 + 至少一个渠道跑通）。

---

## 11. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 多仓库 git log 性能（10+ 仓库 × 1 月 = 数千 commit） | 中 | 并发 + 单仓库流式 + 客户端结果分页；超 N 万条切预警 |
| AI 润色超长 input 被截断 | 中 | 复用 `diff-truncator.ts` 的牌 B 套路，先按"每仓库取 top N 条"再拼 |
| 共用 AI Key 后 commit/report 频次高致限速 | 低 | 复用 ai.service 现有 429 重试 + 用户级 toast |
| safeStorage 在 Linux 无密钥环 | 低 | 已有降级方案，沿用现有 console.warn 一次的策略 |
| 作者邮箱混淆（同一人多 email） | 中 | 给 AuthorPicker 提供"合并别名"功能，写入 `~/.git-manager/author-aliases.json` |
| 用户没装 AI 也想用 | 低 | 普通提取 + 复制完全不依赖 AI；✨ 按钮在无 apiKey 时 disabled + tooltip |
| Webhook 加签错误（钉钉/飞书） | 中 | P1 阶段照搬原项目 Java 加签逻辑，单元测试覆盖签名生成 |

---

## 12. 兼容与回滚

- 所有改动**新增为主**，唯一对现有代码的改动是 `shared/ai/types.ts` 重构，但有自动迁移逻辑，不会损坏旧配置。
- 回滚方式：删除 `src/components/report/` `server/services/report.service.ts` `electron/report-handlers.ts` 与 `shared/ai/types.ts` 中新增字段，恢复原 `AiSettings` 即可。
- 不引入新 npm / pnpm 依赖；P1 渠道推送也只用原生 `fetch` 与 `crypto`。

---

## 13. 附录

### 13.1 原项目 Java 源码索引（C:\lcc\workspace\daily_newspaper_generator）

```
action/      5  ExtractByRange / ExtractSelected / ExtractTodayCommits
                GenerationSelectedByAI / GenerationTodayCommitsByAI
channel/    10  ChannelSender + Registry / AccessTokenCache / HttpUtil
                DingTalkRobot / DingTalkReport / Feishu / WeCom / GenericWebhook
                SenderSupport / SendResult
config/      5  LlmSettings + Configurable + Listener / ChannelConfig
                SecureKeyStore / PromptTemplate
llm/         2  LlmClient (16KB) / LlmException
ui/         16  ReportDialog (20KB) / ExtractRangeDialog (14KB)
                MarkdownRenderer (14KB) / ChannelListPanel (17KB)
                PromptTemplateListPanel (12KB) / AuthorAutoCompleteField (10KB)
                SimpleDatePickerField (9KB) / ReportPushHelper / ReportButtonFactory
                ReportDialogV2 / ReportDialogs / MarkdownEngine(s)
                MarkdownHtmlTransferable / RoundedBadge / StatusNotifier / UiTokens
utils/       8  GitCommitExtractor (27KB · 核心) / ExtractOptions
                GitUserUtil / LlmUtil / NotifyUtil / PolishCache
                ExportService / ReportActionRunner
i18n/        1  DailyReportBundle
```

### 13.2 推荐先精读的 4 个文件（为 TS 移植找参考）

1. `utils/GitCommitExtractor.java` — Git log 抽取 + 过滤 + 去重核心
2. `llm/LlmClient.java` — OpenAI 协议 client，与 git-manager 现有 ai.service 对照
3. `ui/ReportDialog.java` — 主对话框 UI 蓝本
4. `channel/DingTalkRobotSender.java` + `AccessTokenCache.java` — 钉钉加签与 token 缓存最有代表性

### 13.3 git-manager 现状契合度评分

| 维度 | 评分（满分 10） | 说明 |
|---|---|---|
| Git 后端可用性 | 10 | simple-git 全面覆盖 log/diff/show |
| AI 服务可用性 | 9 | 复用度极高，仅需补一个 polishReport 方法 |
| 三模式架构匹配 | 10 | Electron/Web/纯前端 已统一 |
| 安全存储 | 10 | safeStorage 已经在跑 |
| UI 组件可用性 | 9 | Monaco + Tailwind + i18n 都齐 |
| 状态管理 | 10 | Pinia 已就位 |
| 测试基础设施 | 9 | Vitest + supertest 现成 |
| **综合** | **9.5/10** | 几乎无障碍 |

---

## 14. 决策需要

请在确认本方案后回复以下任一选项：

- **A**：完全同意 → 我会进入 §10 的 C-2 卡点（选 UI 入口），但代码改动需要切换到 git-manager 工作区或显式授权跨盘修改。
- **B**：调整范围 / 文件清单 / 配置共用方案 → 请指出哪段需要改。
- **C**：仅留方案文档，暂不实施。

---

**文档版本**：v1.0 — 2026-05-19
