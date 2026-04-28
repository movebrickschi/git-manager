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
├── electron/          # Electron 主进程（IPC 处理、窗口管理）
├── server/            # Express 后端服务（Web 模式使用）
│   ├── git-service.ts # Git 操作核心逻辑（simple-git）
│   └── routes.ts      # REST API 路由
├── src/               # Vue 3 前端
│   ├── components/    # 功能组件（log/branch/diff/blame/stash/merge...）
│   ├── views/         # 页面视图
│   ├── stores/        # Pinia 状态管理
│   └── utils/         # 工具函数
└── public/            # 静态资源
```
