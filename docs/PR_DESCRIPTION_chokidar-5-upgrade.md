# feat/chokidar-5-upgrade · PR Description

把 chokidar 3 → 5、Web 模式 SSE watcher、Monaco chunk 拆分、service 层补测试 4 件大事一起打包合并到 `opt_ui_change`。

> 此 PR 的兄弟 PR：`opt_ui_change`（基础 6 项源码检测优化 + watcher 雏形）应先于此 PR 合入。

---

## Summary

5 个 commit，按依赖顺序：

1. **`chore(deps)`**：chokidar 3.6.0 → 5.0.0 via dynamic ESM import
2. **`perf(build)`**：split Monaco editor chunk 3.33 MB → 2.34 MB (-30%)
3. **`feat(web)`**：SSE-based repo watcher for Web mode parity with Electron
4. **`test(services)`**：add 37 vitest cases for repo/status/conflict/submodule + fix B2 detached HEAD bug
5. **`feat(settings)`**：autoRefreshOnFsChange toggle + 增强 watcher ignored 规则

---

## What's new for the user

| 功能 | 影响 |
|---|---|
| **Web 模式自动刷新** | 浏览器访问 git-manager 时也享受外部改文件自动更新（之前仅 Electron） |
| **首屏 chunk 减 30%** | Monaco editor 拆为 monaco-core + 多 contrib/lang，按需加载 |
| **关闭自动刷新开关** | 大仓库可在状态栏右下角一键关 watcher，释放 inotify/file handle |
| **detached HEAD 显示修复** | 不再被错误显示为 sha 字符串"分支名"，统一显示 `(HEAD: xxxxx)` |

## What's new for developers

- chokidar 5.x 给以后 Node 升级与安全 CVE 跟进留了空间
- service 层（repo / status / conflict / submodule）首次有正式 vitest 覆盖
- `shared/repo-watcher-ignored.ts` 让 Electron / Web 两端共享 ignore 规则
- ignore 规则覆盖：`.next` `.nuxt` `.turbo` `venv` `target` `.gradle` `.mvn` `bin` `obj` 等大量构建/语言 vendored 目录

---

## Test Plan

```
npm run check
# typecheck ✅
# lint 0 errors / 52 warnings (≤65 上限, 无新增)
# vitest 213/213 ✅
```

手动 smoke：
- [ ] `pnpm dev:electron` 启动，外部 VS Code 改文件验证 500ms 内自动刷新
- [ ] `pnpm dev:web` 启动，浏览器访问 http://localhost:5173，外部改文件验证 SSE 自动刷新
- [ ] 状态栏右下角点"自动刷新"按钮关闭，验证不再触发刷新
- [ ] 打开一个非 git 目录，验证报"REPO_NOT_FOUND"（旧版报英文 simple-git 错误）
- [ ] git checkout --detach HEAD 验证仓库标题显示 `(HEAD: xxxxx)`
- [ ] 选 50 个文件 → Stage 按钮 → 验证耗时 < 2s（原 ~10s）

---

## Risk

- **低**：chokidar dynamic import 用 Function 构造器绕过 TS 重写，已验证 dist-electron 产物保留运行时构造；Electron 33 内置 Node 20 原生支持
- **低**：SSE endpoint 与现有 REST 路由独立，互不影响
- **中**：autoRefreshOnFsChange 默认 true，对超大仓库用户可能首次启动 CPU spike；缓解：用户可一键关闭

---

## Breaking changes

无。所有改动向下兼容。
