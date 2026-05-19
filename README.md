# Git Manager

IDEA 风格的 Git 管理桌面软件，使用 Electron + Vue 3 构建。

## 功能特性

- **提交历史**：Git Log 分支线图、搜索与筛选
- **分支管理**：创建 / 切换 / 合并 / 变基 / Cherry-pick / 重置 / Revert
- **工作区变更**：Staging Area、逐文件暂存 / 取消暂存、Amend 提交
- **Diff 查看器**：Side-by-Side / Unified，基于 Monaco Editor
- **远程操作**：Push / Pull / Fetch / Clone
- **Stash 管理**：保存 / 应用 / 弹出 / 删除，支持查看 Stash 文件差异
- **Blame / Annotate**：逐行追溯提交来源
- **冲突解决**：三路合并编辑器，可视化解决合并冲突
- **多仓库支持**：同时管理多个本地仓库
- **AI 生成提交信息**：一键根据 `git diff --cached` 生成符合 Conventional Commits 规范的中英文 commit message，支持 OpenAI 兼容协议

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面框架 | Electron 33 |
| 前端 | Vue 3 + TypeScript + Vite 6 |
| 样式 | Tailwind CSS v4 |
| 状态管理 | Pinia |
| 代码编辑器 | Monaco Editor |
| 图标 | Lucide Vue Next |
| Git 后端 | simple-git（Node.js） |
| 后端服务 | Express.js（Web 模式） |

## 运行模式

本项目支持三种运行模式：

| 模式 | 描述 |
|------|------|
| **Electron 桌面应用** | 完整桌面体验，通过 IPC 直接调用 Git 服务 |
| **Web 应用（前后端分离）** | 前端 Vite Dev Server + Express 后端，适合浏览器访问 |
| **纯前端预览** | 仅启动 Vite，不含后端 |

## AI 提交信息生成

提交面板内置「✨ AI 生成」按钮（也可用快捷键 **Ctrl/Cmd + Shift + G**），点击会读取 `git diff --cached`、拼装 prompt 并调用兼容 OpenAI 协议的 chat completions 接口，把结果填入提交 textarea。

### 支持的供应商

走 **OpenAI 兼容协议**（即 `POST {baseUrl}/chat/completions`），「设置 → AI 设置」内置以下预设：

| 预设 | Base URL | 默认模型 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Moonshot Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 通义千问（DashScope） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Ollama 本地 | `http://localhost:11434/v1` | `qwen2.5-coder` |
| 自定义 | （手动填） | （手动填） |

任何兼容 OpenAI Chat Completions 协议的 endpoint 均可使用，包括自部署 vLLM / one-api / Cherry-Proxy。

### apiKey 存储策略

| 模式 | 路径 | 加密 |
|---|---|---|
| Electron 桌面 | `{userData}/ai-apikey.json` | **`safeStorage`** 加密：macOS Keychain / Windows DPAPI / Linux libsecret |
| Web 服务 | `~/.git-manager/ai-apikey.txt` | 明文（仅本机自用建议）|
| 环境变量（最高优先级） | `AI_API_KEY` | 不持久化 |

> Linux 若未装 libsecret 等密钥环，safeStorage 不可用，会自动降级为明文存储并在主进程 console 打印 warn。

### 配置项一览

设置弹窗里能改的字段，会持久化到：
- Electron：`{userData}/ai-settings.json`
- Web：`~/.git-manager/ai-settings.json`

| 字段 | 默认 | 说明 |
|---|---|---|
| `commitStyle` | `cc` | `cc` Conventional Commits / `plain` 纯文本 / `gitmoji` |
| `lang` | `auto` | `zh` / `en` / `auto`（按 diff 推断）|
| `timeout` | `30000` ms | 单次请求超时；超时后自动重试 1 次（仅对 5xx/网络错） |
| `maxDiffChars` | `16000` | 超长 diff 触发牌 B 兑底：每文件保留前 100 行 → 仍超则退化为 `path: +adds -dels` 摘要 |

### 错误兜底

| 触发 | 处理 |
|---|---|
| HTTP 401/403 | toast `apiKey 无效`，建议打开设置面板检查 |
| HTTP 429 | toast `触发限速`，需稍后再试 |
| HTTP 5xx / 网络异常 | 静默重试 1 次（2s backoff），仍失败 toast 提示 |
| 暂存为空 | ✨ 按钮 disabled + tooltip `请先暂存文件` |
| 用户主动取消 | 生成中点击「取消」即 abort fetch，无 toast 噪音 |
| 输出非空格式不规范 | 不强校验，原样填入（用户可手改） |
| safeStorage 不可用 | 降级为明文存储 + console.warn 一次 |

### 快速上手（30 秒）

```powershell
# 方式 A：环境变量（无需配置面板）
$env:AI_API_KEY = "sk-xxxxxxxx"
npm run dev:electron
# 打开任一仓库 → 暂存文件 → ✨

# 方式 B：图形配置
npm run dev:electron
# 提交面板 → chevron ▾ → AI 设置 → 选 DeepSeek 预设 → 粘 apiKey
# → 🔌 测试连接 → 保存 → ✨
```

## 日报 / 周报 / 月报

侧边栏 **「日报」** Tab 一键把多仓库 Git 提交记录聚合成结构化 Markdown 报告，支持 AI 润色 + 一键复制 / 导出。常见场景：日终 / 周末写汇报、月底总结、Sprint 复盘。

### 能力一览

| 维度 | 说明 |
|---|---|
| **时间范围** | 今日 / 昨日 / 本周（ISO 周一起）/ 上周 / 本月 / 上月 / 自定义区间 |
| **作者过滤** | 仅我（默认）/ 全部 / 按邮箱多选；多选自动 OR 合并 |
| **仓库过滤** | 多仓库联合扫描，每个仓库可**单独**指定扫描分支（不会切换工作区） |
| **关键字** | include / exclude 双向；逗号或换行分隔；命中 commit message 任意行即可 |
| **去重** | 自动剔除 merge commit（双父）、Revert commit、message 完全重复 |
| **分组** | 三层 `仓库 → 模块（feat/fix/perf/...）→ 日期`；conventional commits 前缀自动解析 module 与 scope |
| **渲染** | 每条 commit 作为 `####` 四级标题；commit message 的 body 行展开为 `-` bullet；输出 Markdown / 纯文本两种 |
| **AI 润色** | 4 风格（正式 / 轻松 / 项目符号 / 叙事段落）× 3 语言（中文 / 英文 / 自动）× 自定义提示词 |
| **复制 / 导出** | 一键写入剪贴板；导出 `.md` 文件 |

### 与 commit message 生成共用 AI 配置

日报润色与 commit 生成走**同一份** `ai-settings.json` 与 `ai-apikey.json`（safeStorage 加密）。即：

- 顶层 `baseUrl` / `apiKey` / `model` / `timeout` 两边都用，**只填一次**
- 子段 `report` 独立保存润色 `style` / `lang` / `maxInputChars` / `customPrompt`，不污染 commit 配置

落盘格式示例（`{userData}/ai-settings.json`）：

```jsonc
{
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-chat",
  "commitStyle": "cc",
  "lang": "auto",
  "timeout": 30000,
  "maxDiffChars": 16000,
  "report": {
    "style": "formal",
    "lang": "auto",
    "maxInputChars": 32000,
    "customPrompt": "每条加上工时估算"
  }
}
```

`customPrompt` 非空时被**追加**到 system prompt 末尾，并标注「优先级高于固定模板的 1-8 条规则」，因此可以覆盖默认风格之外的任何附加要求（工时 / 客户语境 / emoji 偏好等）。

### 错误兜底

| 触发 | 处理 |
|---|---|
| 未打开任何仓库 | 「生成报告」按钮 disabled |
| 范围内无匹配提交 | toast `NO_COMMITS`，提示放宽筛选条件 |
| 单仓库 git log 失败 | 显示该仓库错误条，**其余仓库结果照常返回** |
| AI 未配置 apiKey | ✨ 润色按钮触发后回 `NO_API_KEY`，引导到 commit 面板 AI 设置 |
| 润色超时 / 5xx | 静默重试 1 次（2s backoff）；用户可主动点「取消」abort |
| 输入 Markdown 超 `maxInputChars` | 自动尾部截断并附「已截断」提示，避免上下文打爆 |

### 快速上手（30 秒）

```powershell
# 1. 启动桌面应用
npm run dev:electron
# 或直接装安装包：release\Git Manager Setup x.y.z.exe

# 2. Welcome 页打开任一 Git 仓库
# 3. 侧边栏切到「日报」Tab
# 4. 顶部过滤栏：选「今日」/「本周」→「全部 / 仅我」→ 勾选仓库 →（可选）切到某个分支
# 5. 点「🚀 生成报告」→ 预览区即出 Markdown
# 6. （可选）点「✨ AI 润色」前选风格 / 语言，或展开「▸ 提示词」加自定义要求
# 7. 「📋 复制」粘贴到企微 / 钉钉 / 邮箱，或「💾 导出 .md」存档
```

### 设计文档

完整的设计稿、Java→TS 映射表、P0/P1/P2 路线图、风险与回滚策略详见 [`docs/PROPOSAL.md`](docs/PROPOSAL.md)。

## 开发

### 前置要求

- [Node.js](https://nodejs.org/) 18+
- pnpm（推荐）或 npm

### 安装依赖

```bash
pnpm install
# 或
npm install
```

### 开发模式

**Electron 桌面应用（推荐）**

```bash
npm run dev:electron
```

**Web 模式（浏览器访问）**

```bash
npm run dev:web
# 前端: http://localhost:5173
# 后端: http://localhost:3000
```

**纯前端预览**

```bash
npm run dev
```

### 构建

**构建 Electron 安装包**

```bash
npm run build:electron
# 输出目录: release/
```

**构建 Web 版本**

```bash
npm run build:web
# 前端输出: dist/
# 后端输出: dist-server/
```

## 项目结构

```
git-manager/
├── electron/                    # Electron 主进程（IPC、窗口管理、safeStorage）
│   ├── main.ts
│   ├── preload.ts               # IPC channel allowlist
│   └── ai-handlers.ts           # AI 主进程 handler（safeStorage 加密 apiKey）
├── server/                       # Express 后端服务（Web 模式使用）
│   ├── git-service.ts            # Git facade（聚合 8 个 service）
│   ├── routes.ts                 # REST API 路由（含 /api/ai/*）
│   └── services/
│       ├── ai.service.ts         # AI 公共逻辑（fetch + 错误分类 + 重试 + abort）
│       └── ...                   # branch / log / status / blame / ...
├── shared/                       # 三端共享类型与纯工具
│   ├── types.ts                  # 领域 DTO + Commands 接口
│   ├── command-manifest.ts       # IPC ↔ HTTP 双向命令清单
│   └── ai/
│       ├── types.ts              # AiSettings / 预设清单 / 错误码
│       ├── prompt-builder.ts     # system/user prompt 拼装（纯函数）
│       └── diff-truncator.ts     # 牌 B 两级截断（纯函数 + 单元测试）
├── src/                          # Vue 3 前端
│   ├── components/
│   │   └── commit/
│   │       ├── CommitPanel.vue   # 提交面板（含 ✨ + chevron + 覆盖/追加 confirm）
│   │       └── AiSettingsDialog.vue
│   ├── services/
│   │   └── ai/                   # 双模式 aiBridge（Electron IPC / Web HTTP）
│   ├── stores/                   # Pinia 状态管理
│   └── utils/
└── public/                       # 静态资源
```
