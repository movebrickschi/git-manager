# Git Manager v0.2.0（待发布）

本次的核心升级是**让 Git Manager 不再是"快照"**：外部 IDE 修改文件后秒级自动刷新，并把 6 个源码检测/识别功能从健康加固到接近"生产稳"。

> 注：当前 `package.json` 版本仍为 `0.1.0`。发布前请按需 bump 到 `0.2.0`。

---

## ✨ 新功能

### 1. 文件系统 watcher（自动刷新）—— 体感最强升级

- **Electron 模式**：通过 chokidar + 500ms debounce，外部 IDE / 资源管理器改文件后自动更新 Changes / Branches / Log
- **Web 模式**：通过 SSE (`GET /api/repo/events`) 推送，浏览器端用 EventSource 订阅，与 Electron 行为对齐
- **资源管理**：切仓库自动释放旧 watcher；窗口/连接关闭时清理 inotify 句柄
- **可关**：状态栏新增「自动刷新」按钮（默认开启），大仓库或资源紧张时一键关闭

### 2. Monaco editor chunk 拆分 —— 首屏减负 30%

- 旧 `editor.main` 单 chunk **3.33 MB** → 拆为：
  - `monaco-core` 2.34 MB
  - `monaco-contrib-*`（find / hover / suggest / format ...）每个 30-90 KB
  - `monaco-lang-*`（typescript / json / python / go ...）每个 < 50 KB
- 首屏加载量减少 230 KB（gzip），按需 fetch 语言模块

### 3. chokidar 5.x（CJS 主进程 dynamic ESM import）

- 升级到 chokidar 5.0.0（脱离 EOL 的 3.x）
- 通过 `new Function("specifier", "return import(specifier)")` 在 CJS 主进程加载 ESM 模块
- 副产品：移除 11 个 deprecated transitive deps（rimraf 3 / glob 7 / inflight 等）

---

## 🔧 6 个源码检测/识别功能加固

### A · 二进制 vs 文本识别（`_helpers.ts`）
- **A1**：NUL 检测从前 8 KB 扩展到全量扫，修大文件后段含 NUL 漏检
- **A3**：parseDiffOutput split 兼容 `\r?\n` + strip 末尾 `\r`，修 Windows CRLF 输出漏判
- **A4**：recoverMisdetectedBinaryDiff 先 fs.stat 后读，避免大文件先读后丢弃

### B · Git 仓库识别 / clone（`repo.service.ts`）
- **B1**：openRepo 路径不存在 / 文件不是目录 → 友好中文错误（REPO_NOT_FOUND / INVALID_PATH）
- **B2**：detached HEAD 兜底为 `(HEAD: <sha>)`，不再显示空白或被误认为分支名
- **B3 [🔒 安全]**：cloneRepo 日志/错误消息 redact URL 中的 `user:pass / token`，防 token 落盘
- **B4**：cloneRepo target 非空目录预检（PATH_NOT_EMPTY）

### C · 本地变更检测（`status.service.ts` + `commitStore`）
- **C1**：见上面"文件系统 watcher"
- **C3**：新增 `stageFilesBatch` / `unstageFilesBatch`，1 次 git add 替代 N 次串行（50 文件 10s → 1s）
- **C4**：getWorkingFileContent / deleteFile 改 fs.promises（异步化）

### D · 冲突 marker / 半成态识别（`conflict.service.ts`）
- **D1**：getMergeState 用 fs.promises.access + Promise.all 并发（不再卡 event loop）
- **D3**：getConflictContent 走 buffer + decodeBufferToText，UTF-16 冲突文件不再乱码
- **D4**：resolveConflict 改 fs.promises.writeFile

### E · 子模块扫描（`submodule.service.ts`）
- **E1**：无 `.gitmodules` 直接返回 `[]` 不跑 git，消除"扫描中..."闪烁
- **E2**：updateSubmodules / syncSubmodules / initSubmodules 用 5 分钟 timeout（原 30s 不够大子模块克隆）
- **E3**：异常 console.warn 暴露错误，不再被静默吞

### F · Conventional Commits 解析（`report-filter.ts`）
- **F2**：parseConventional 返回 `breaking` 字段（支持 `feat!: xxx` / `feat(api)!: xxx`）
- **F3**：dedupMessage key 加 scope 维度，不同 scope 同 subject 不再误合并

---

## 🧪 测试增强

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `shared/report/report-filter.test.ts` (新) | 16 | parseConventional + applyReportFilter dedup + resolveRange |
| `server/services/repo.service.test.ts` (新) | 17 | openRepo / cloneRepo / redactUrl |
| `server/services/status.service.test.ts` (新) | 12 | getStatus / stageFilesBatch / unstageFilesBatch / path traversal |
| `server/services/conflict.service.test.ts` (新) | 6 | getMergeState 状态机 / getConflictContent / resolveConflict |
| `server/services/submodule.service.test.ts` (新) | 3 | 无 .gitmodules / 正常 submodule / 异常配置 |
| `server/services/_helpers.test.ts` (扩展) | +2 | A1 大文件 NUL 漏检 + A3 CRLF 输入 |

**总测试数 158 → 213（+55）。npm run check 全过。**

---

## ⚙️ 依赖

| 包 | 变化 |
|---|---|
| chokidar | （新）`^5.0.0` |

无其它运行时依赖变化。

---

## 🔍 升级注意事项

1. **首次启动会建立 watcher**：大仓库（10万+ 文件）可能短暂 CPU spike，需要时可在状态栏右下角关闭"自动刷新"
2. **Web 模式 SSE 在反向代理后需要确认 `X-Accel-Buffering: no` 生效**（nginx / cloudflare 默认会 buffer SSE）
3. **chokidar 5.x 需要 Node 18+**（Electron 33 内置 Node 20，OK）

---

## 校验文件完整性

```powershell
Get-FileHash "Git Manager Setup 0.1.0.exe" -Algorithm SHA256
```

实际 hash 待最终打包确定（每次 build 会变）。
