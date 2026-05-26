# Git Manager v0.1.0

IDEA 风格的可视化 Git 桌面客户端的首个公开发布版，基于 Electron 33 + Vue 3 + TypeScript + Vite 6 构建。

> **这是 v0.1.0 首个正式 release**，本次仅发布 Windows 安装包。macOS Apple Silicon / Intel 双架构 dmg 即将在下一次发布补齐（代码与文档已就绪，详见仓库内 `docs/BUILD_MACOS.md`）。

---

## 安装

### Windows

下载下方 Assets 区的 **`Git Manager Setup 0.1.0.exe`** 直接双击安装。

- 默认走 NSIS 引导式安装
- 支持自定义安装目录
- 卸载从「应用与功能」即可

### macOS（即将发布）

下一次发布会同时附上：
- `Git-Manager-0.1.0-arm64.dmg`（Apple Silicon）
- `Git-Manager-0.1.0-x64.dmg`（Intel）

由于未做 Apple 代码签名 / 公证，首次打开需要：
- **右键点击 Git Manager.app → 打开 → 在弹窗里再次点「打开」**；或
- 命令行 `xattr -dr com.apple.quarantine /Applications/Git\ Manager.app`

---

## 主要功能

### Git 工作流

- **提交历史**：Log 分支线图、搜索、按作者/日期/关键字筛选
- **分支管理**：创建 / 切换 / 合并 / 变基 / Cherry-pick / 重置 / Revert / 重命名
- **Smart Checkout**：仿 IntelliJ IDEA 切分支体验，自动 stash + restore，冲突预检测
- **工作区变更**：Staging Area、逐文件暂存 / 取消暂存、Amend 提交、untracked 文件 diff 与回滚
- **Diff 查看器**：Side-by-Side / Unified，基于 Monaco Editor，支持 Hunk 导航与 Minimap（IDEA Gutter Marker 风格）
- **远程操作**：Push / Pull / Fetch / Clone，Smart Pull（IDEA「Update Project (Stash)」等价）
- **Stash 管理**：保存 / 应用 / 弹出 / 删除，支持查看 Stash 文件差异
- **Blame / Annotate**：逐行追溯提交来源，支持搜索与复制
- **冲突解决**：三路合并编辑器，可视化解决合并冲突
- **多仓库支持**：同时管理多个本地仓库

### IDEA 同款进阶功能

- **Interactive Rebase**：可视化 sequencer editor 编排 reword / squash / drop / edit / fixup
- **Tag CRUD**：创建 / 删除 / push / 删远端 / checkout
- **Force-push with lease**：安全的强制推送
- **Reflog 面板**：完整 reflog 浏览
- **Squash 多 commit**：批量合并连续提交
- **Patch 与 Submodule**：完整支持
- **后台 Fetch**：可配置间隔

### AI 集成

- **AI 生成提交信息**：一键根据 `git diff --cached` 生成符合 Conventional Commits 规范的中英文 commit message
  - 支持 OpenAI / DeepSeek / 通义千问 / 智谱 / Moonshot / Ollama 本地 等任意 OpenAI 兼容协议
  - 快捷键 **Ctrl/Cmd + Shift + G**
  - apiKey 走 safeStorage 加密：Windows DPAPI / macOS Keychain / Linux libsecret
- **日报 / 周报 / 月报**：多仓库提交记录聚合为 Markdown 报告，4 风格 × 3 语言 AI 润色

### 三种运行模式

- **Electron 桌面应用**：完整桌面体验，通过 IPC 直接调用 Git 服务
- **Web 应用**：前端 Vite + Express 后端，适合浏览器访问
- **纯前端预览**：仅启动 Vite，不含后端

---

## 本次构建（v0.1.0）包含的最新亮点

按时间倒序列出最近的几项重要改动：

- `feat(build)`：兼容 macOS Apple Silicon 与 Intel 双架构打包，新建完整打包手册 `docs/BUILD_MACOS.md`（mac dmg 将在下次发布补齐到 release 资产）
- `feat(local-changes)`：右键菜单新增「在资源管理器 / Finder 中显示」(IDEA 同款 Show in Files)
- `test(diff)`：补齐 untracked diff + 二进制识别的 9 个回归用例
- `feat`：支持未跟踪文件 diff、报告预览和过滤规则快速添加
- `feat(report)`：新增日报 / 周报 / 月报，等价 daily_newspaper_generator 能力
- `fix(log)`：日期筛选 `--after` / `--before` 补齐到 `00:00:00` / `23:59:59`，解决当天 commit 漏过
- `feat(rebase)`：Phase 3 E - Interactive Rebase（IDEA 风格 sequencer editor）
- `feat(branch)`：Smart Checkout 冲突预检测 + pop 失败自动跳本地变更
- `feat(diff-viewer)`：Hunk 导航与 Minimap（IDEA Gutter Marker 风格）
- `feat(ai)`：接入 AI commit message 生成（OpenAI 兼容协议）

---

## 系统要求

| 项 | 要求 |
|---|---|
| Windows | Windows 10 1809+ / Windows 11 |
| 系统位数 | x64（暂未提供 ARM Windows 包） |
| 必备命令 | PATH 中存在 `git`（如果系统没装，安装 [Git for Windows](https://git-scm.com/download/win) 即可） |
| 磁盘空间 | 约 250 MB（含 Electron runtime） |

---

## 已知限制

- 未做代码签名：Windows SmartScreen 可能在首次运行时弹出「Windows 已保护你的电脑」，点「更多信息 → 仍要运行」即可。
- macOS 安装包**本次未发布**，下次 release 补齐。开发者如果需要立刻在 mac 上跑，可以 clone 仓库后跟着 [`docs/BUILD_MACOS.md`](https://github.com/movebrickschi/git-manager/blob/master/docs/BUILD_MACOS.md) 第 10 节的一键命令清单自行构建。
- Linux 包暂未提供。

---

## 反馈与贡献

- Issue：在仓库 issues 区开
- PR：欢迎，请先 fork

---

## 校验文件完整性（可选）

构建产物：

- `Git Manager Setup 0.1.0.exe`

下载后可用 PowerShell 计算 SHA256 校验：

```powershell
Get-FileHash "Git Manager Setup 0.1.0.exe" -Algorithm SHA256
```

应得到：

```
Algorithm: SHA256
Hash:      3D7F0D7EC5070BD6B89730DA214600ADBF352D5581EB00B5B8D5F81543814C54
File:      Git Manager Setup 0.1.0.exe (101,499,615 bytes / 96.8 MB)
```
