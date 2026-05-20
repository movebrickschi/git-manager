# macOS 打包指南

把 Git Manager 打成 macOS 安装包（`.dmg`），支持 Apple Silicon (arm64) 与 Intel (x64) 双架构。

> **核心约束**：electron-builder 必须在 macOS 设备上原生构建 `.dmg`，Windows / Linux 跑不出来。这是 electron-builder 的硬限制（mac 包内部依赖 `hdiutil` 等 macOS 系统工具，符号链接也需要 macOS 文件系统支持）。

---

## 1. 前置要求

### 1.1 硬件 / 系统

- 一台 macOS 设备（macOS 11 Big Sur 及以上推荐）。
- arm64 Mac 和 Intel Mac 都行——electron-builder 都能交叉出**对方架构的包**，但 app 只能在本机架构启动测试。

### 1.2 命令行工具

```bash
git --version            # 必须能输出版本号
```

如果系统提示让你安装 **Xcode Command Line Tools**：

```bash
xcode-select --install
```

`git`、`make`、`clang` 都在 CLT 里，装完一次后系统范围可用。

### 1.3 Node 与 pnpm

```bash
node --version           # 推荐 18.x 或 20.x LTS
pnpm --version           # 推荐 10.x（与 pnpm-lock.yaml 对齐，避免 lockfile 漂移）
```

如果没装 pnpm：

```bash
corepack enable
corepack prepare pnpm@10.30.3 --activate
# 或全局装：npm i -g pnpm@10
```

---

## 2. 准备工作（mac 设备上第一次）

### 2.1 拉代码

```bash
git clone <repo-url> git-manager
cd git-manager
```

### 2.2 装依赖（重要：必须重装）

如果你是从 Windows 拷贝的项目目录（包含 `node_modules/`），**必须先删除 `node_modules/`**，因为 `sharp` 是原生包，Windows 上装的二进制无法在 mac 上运行：

```bash
rm -rf node_modules
pnpm install
```

如果是 `git clone` 的全新目录，直接 `pnpm install` 即可。

### 2.3 sanity check

确认基础脚本能跑：

```bash
pnpm run build:icon
# 期望输出：
#   icon written: build/icon.ico (16, 32, 48, 64, 128, 256)
#   icon written: build/icon.icns (1024x1024 base)

ls build/
# 期望看到：icon.icns  icon.ico  icon.png
```

---

## 3. 打包命令

### 3.1 双架构一次性打包（推荐）

```bash
pnpm run build:mac
```

产物（位于 `release/`）：

```
release/
├── Git Manager-0.1.0-arm64.dmg          # Apple Silicon 用户下载
├── Git Manager-0.1.0-x64.dmg            # Intel 用户下载
├── builder-debug.yml                    # electron-builder 调试信息
└── builder-effective-config.yaml        # 实际生效的构建配置
```

> 注：当前 `package.json` 的 `build.mac.target` 只声明了 `dmg`，所以不会出 zip。如果后续要支持 autoUpdater（electron 自动更新），需要再加 `zip` 目标用于发布到 GitHub releases 作为更新源。

### 3.2 只出某一种架构（更快）

```bash
# 只出 Apple Silicon
pnpm run build:mac:arm64

# 只出 Intel
pnpm run build:mac:x64
```

每个架构单独跑约 1-3 分钟（依赖你的 Mac 性能与网络）。

### 3.3 备用：通用入口

```bash
pnpm run build:electron
# 在 mac 上跑会自动出 mac 包；在 Windows 上跑会出 .exe。平台自适应。
```

---

## 4. 首次构建会发生什么

1. **`prebuild:electron`**：清理 `release/` 目录（mac/linux 用轻量 `fs.rm`，不调 taskkill）。
2. **`build:icon`**：用 `sharp` 把 `public/vite.svg` 转 PNG → `png2icons` 生成 `icon.icns`（1024×1024 base）。同时也出 `icon.ico` 和 `icon.png`。
3. **`vue-tsc --noEmit`**：TypeScript 类型检查（不发出 .js，只校验类型）。
4. **`vite build`**：前端打包到 `dist/`。
5. **`tsc -p tsconfig.electron.json`**：编译 electron 主进程 + server 到 `dist-electron/`（CommonJS）。
6. **`postbuild-electron.mjs`**：在 `dist-electron/` 写入 `package.json` 把 `type` 改成 `commonjs`，避免 Node ESM/CJS 混乱。
7. **`electron-builder --mac --arm64 --x64`**：
   - 首次会从 GitHub releases 下载 Electron 33 的 mac 版 runtime（arm64 + x64 两份，约 200-300 MB）。**这一步取决于网络，国内可能比较慢**。
   - 把前端、electron 主进程、Electron runtime 打包成 `Git Manager.app`。
   - 调用 `hdiutil` 把 `.app` 封装成 `.dmg`。

---

## 5. 验证产物

### 5.1 检查文件存在

```bash
ls -lh release/*.dmg
# 期望每个 dmg 约 100-150 MB
```

### 5.2 本机架构直接 mount 测试

```bash
# Apple Silicon Mac：
open release/Git\ Manager-0.1.0-arm64.dmg

# Intel Mac：
open release/Git\ Manager-0.1.0-x64.dmg
```

会弹出 dmg 挂载窗口：把 `Git Manager.app` 拖到 `/Applications` 即可。

### 5.3 启动 app

```bash
open /Applications/Git\ Manager.app
```

**首次启动会被 Gatekeeper 拦截**（见下一节）。

---

## 6. 用户首次打开的处理（未签名 dmg）

当前发布版**未做 Apple 代码签名 / 公证**，macOS Gatekeeper 会拦截。两种处理方式：

### 6.1 推荐：右键打开

1. 在 `/Applications` 里**右键点击** `Git Manager.app`。
2. 菜单选「**打开**」。
3. 弹窗里再次确认「**打开**」。

之后再启动就不会再弹了。

### 6.2 命令行解除隔离

```bash
xattr -dr com.apple.quarantine /Applications/Git\ Manager.app
```

`-dr` = 递归删除指定属性。执行后双击就能打开。

### 6.3 给最终用户的安装说明

把上面任一种方法写进你的发布说明（GitHub release 描述、官网下载页等），用户照着做即可。

---

## 7. 常见问题

### Q1：`pnpm install` 卡在 sharp 下载

`sharp` 会下载平台对应的 libvips 二进制。如果国内网络慢，可以：

```bash
PUPPETEER_SKIP_DOWNLOAD=1 SHARP_IGNORE_GLOBAL_LIBVIPS=1 \
SHARP_BINARY_HOST="https://npmmirror.com/mirrors/sharp" \
SHARP_LIBVIPS_BINARY_HOST="https://npmmirror.com/mirrors/sharp-libvips" \
pnpm install
```

### Q2：`electron-builder` 卡在下载 electron runtime

设置 electron 国内镜像：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
pnpm run build:mac
```

### Q3：报错 `Application Specific Password is not defined`

说明 electron-builder 在尝试公证。检查 `package.json` 的 `build.mac.identity` 应该是 `null`（当前已配置为 null，不签名也不公证）。如果你**主动配置了 `APPLE_ID` 等环境变量但没配齐**，可能触发这个报错——`unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD CSC_LINK` 清掉即可。

### Q4：在 Intel Mac 上出 arm64 dmg，但启动失败

正常——arm64 二进制需要 Apple Silicon CPU 才能跑（Rosetta 翻译的是 x64 → arm64，不是反向）。需要拷给 Apple Silicon 设备验证。

### Q5：app 启动后白屏

可能原因：
- `dist/` 里 `index.html` 没正确写入（vite build 失败）。
- electron 主进程的 `mainWindow.loadFile(...)` 路径不对。

排查：

```bash
# 用 Electron 的开发模式直接启动 dist 产物
NODE_ENV=production npx electron .
# 看控制台输出
```

或者把 `electron/main.ts` 里的 `webContents.openDevTools()` 在生产模式也启用，看 renderer 控制台错误。

### Q6：simple-git 调用失败 `git is not installed`

mac 上没装 `git`。装 Xcode Command Line Tools 即可：

```bash
xcode-select --install
```

---

## 8. 与 Windows 包的功能对齐说明

经过代码审计，**mac 与 Windows 版功能完全对齐**：

| 维度 | Windows | macOS | 备注 |
|---|---|---|---|
| Git 操作 | ✅ | ✅ | 通过 `simple-git` 调系统 PATH 里的 `git`，跨平台 |
| AI apiKey 加密 | DPAPI | Keychain | `safeStorage` 自动选择；mac 首次访问会弹一次「允许访问钥匙串」 |
| 配置落盘 | `%APPDATA%\git-manager\` | `~/Library/Application Support/Git Manager/` | `app.getPath("userData")` 自动适配 |
| 快捷键 | Ctrl 系 | Cmd 系 | UI 层 `ctrlKey \|\| metaKey` 双路兼容 |
| 在文件管理器中显示 | Explorer | Finder | Electron `shell.showItemInFolder` |
| 交互式 rebase | 走 `.cmd` 脚本 | 走 `.sh` 脚本 + chmod 755 | `git-rebase-editor.ts` 已实现跨平台 |
| 窗口关闭行为 | 关窗 = 退出 | 关窗 = 保留 dock 图标 | mac 原生习惯 |
| 顶部菜单栏 | 窗口内 | 全局菜单栏（Electron 默认） | Edit/Copy/Paste/Select All 等系统行为可用 |

---

## 9. 后续可扩展（暂未做）

### 9.1 GitHub Actions 自动出包

可在 `.github/workflows/release.yml` 加 `macos-latest` runner，用 `matrix.arch: [arm64, x64]` 并行打两个包。需要时告诉维护者。

### 9.2 Apple 签名 + 公证

1. 申请 Apple Developer Program（$99 / 年）。
2. 在 Apple Developer 后台创建 Developer ID Application 证书。
3. 设环境变量：
   ```bash
   export CSC_LINK="/path/to/cert.p12"       # 或 base64 字符串
   export CSC_KEY_PASSWORD="cert-password"
   export APPLE_ID="your@email.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="XXXXXXXXXX"
   ```
4. 把 `package.json` 的 `build.mac.identity` 改成证书名（或留 `null` 让 electron-builder 自动找）。
5. 把 `build.mac.hardenedRuntime` 改成 `true`。
6. 重新跑 `pnpm run build:mac`，electron-builder 会自动签名 + 上传公证。

### 9.3 Universal Binary（单包同时支持 arm64 + x64）

把 `package.json` 里 `build.mac.target` 改成：

```jsonc
"target": [
  {
    "target": "dmg",
    "arch": ["universal"]
  }
]
```

产物变成单个 `Git Manager-0.1.0-universal.dmg`，体积约 250-300 MB。本项目没有运行时 native 依赖，做 universal 无痛。

---

## 10. 一键复制版命令清单（mac 设备首次使用）

```bash
# 1. 准备环境
xcode-select --install         # 如果没装过
corepack enable && corepack prepare pnpm@10 --activate

# 2. 拉代码 + 装依赖
git clone <repo-url> git-manager
cd git-manager
rm -rf node_modules            # 如果是从 Windows 拷过来的，必须删
pnpm install

# 3. 验证图标生成
pnpm run build:icon
ls build/                      # 应该有 icon.icns / icon.ico / icon.png

# 4. 双架构打包
pnpm run build:mac

# 5. 验证产物
ls -lh release/*.dmg
open release/Git\ Manager-0.1.0-arm64.dmg   # Apple Silicon
# 或
open release/Git\ Manager-0.1.0-x64.dmg     # Intel
```

---

如遇到本文档未覆盖的问题，参考 [electron-builder 官方文档](https://www.electron.build/configuration/mac) 或在仓库 issue 中反馈。
