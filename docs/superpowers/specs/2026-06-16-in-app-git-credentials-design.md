# 应用内 Git 凭据（HTTPS）— 设计文档

> 状态：草案 v1（待人工评审后进入实现）
> 日期：2026-06-16
> 范围：git-manager（Electron + Vue 3 + Express 三模式）

---

## 1. 背景与目标

### 1.1 问题
上一轮修复设置了 `GIT_TERMINAL_PROMPT=0`（避免缺凭据时 push 卡死）。代价是：**没装 Git Credential Manager（GCM）、也没配 SSH key 的用户，HTTPS 私有仓库的 push / pull / fetch / clone 会直接鉴权失败，且 GUI 内没有任何输入账号/Token 的地方**——成为“压根用不了联网操作”的阻断点。

### 1.2 目标
- G1：提供**应用内 HTTPS 凭据输入**（用户名 + 密码/Token）。
- G2：凭据按 **host** 缓存，**safeStorage 加密**（Electron）/ 明文文件（Web，与 ai-apikey 同策略）。
- G3：联网 git 通过 **GIT_ASKPASS** 透明使用缓存凭据，Token **不进命令行参数、不写入 git 明文 credential store**。
- G4：**反应式**触发——联网操作遇鉴权失败时弹「登录」对话框，保存后自动重试。
- G5：设置里提供「凭据管理」（按 host 查看用户名 / 清除；**绝不回显 Token**）。
- G6：三模式（Electron / Web / 纯前端）均不崩；纯前端无后端时该功能自然不可用（与现状一致）。

### 1.3 非目标（YAGNI）
- 不做 SSH key 管理 / 生成。
- 不做 OAuth/Device Flow 登录。
- 不做 per-repo 粒度（只按 host）。
- 不与系统 GCM 互操作 / 不改用户全局 git config。
- 不支持凭据回显（查看明文 Token）。

---

## 2. 机制：GIT_ASKPASS（方案 A）

### 2.1 原理
git 在需要凭据时，若设置了 `GIT_ASKPASS`，会**逐字段**调用：`GIT_ASKPASS "<prompt>"`，从其 **stdout** 读取答案。`GIT_ASKPASS` 与 `GIT_TERMINAL_PROMPT` 相互独立——即使 `GIT_TERMINAL_PROMPT=0`，askpass 仍生效。

我们在 `git-net` 跑联网命令时，给子进程注入：
- `GIT_ASKPASS` = askpass 包装脚本路径
- `GM_ASKPASS_NODE` = `process.execPath`（Electron 下即 electron 可执行）
- `ELECTRON_RUN_AS_NODE` = `"1"`（让 electron 以 node 模式运行 askpass.js；纯 node/web 下该变量被忽略，无副作用）
- `GM_ASKPASS_USERNAME` / `GM_ASKPASS_PASSWORD` = 缓存的用户名 / Token

脚本本身**不含任何密钥**；密钥仅在调用时经环境变量传入短生命周期子进程。

### 2.2 脚本（运行时生成，asar 内无法执行故落到真实磁盘）
生成目录 `D`：Electron = `app.getPath('userData')/askpass`；Web/dev = `os.tmpdir()/gm-askpass`。首次用时写入（幂等），posix 脚本 `chmod 0o755`。

`askpass.js`（纯 node，无依赖）：
```js
const prompt = process.argv[2] || "";
if (/username/i.test(prompt)) process.stdout.write(process.env.GM_ASKPASS_USERNAME || "");
else if (/password|token/i.test(prompt)) process.stdout.write(process.env.GM_ASKPASS_PASSWORD || "");
process.exit(0);
```

win32 `askpass.cmd`：
```bat
@echo off
"%GM_ASKPASS_NODE%" "%~dp0askpass.js" %*
```

posix `askpass.sh`：
```sh
#!/bin/sh
"$GM_ASKPASS_NODE" "$(dirname "$0")/askpass.js" "$@"
```

`GIT_ASKPASS` 指向 `.cmd`（win32）/ `.sh`（posix）。

### 2.3 凭据匹配
- git prompt 形如 `Username for 'https://github.com': ` / `Password for 'https://user@github.com': ` → 正则区分字段。
- 仅 HTTPS 远端注入；SSH 远端（`git@host:`）跳过（走密钥，askpass 不介入）。

---

## 3. 数据流

```
push/pull/fetch（facade 命令）
  └─ remoteService.<op>(repoPath, ...)
       ├─ env = await credentialService.buildAuthEnv(repoPath)   // 解析 host → 查缓存 → 生成 askpass env（无缓存/SSH 则 {}）
       └─ runNetworkGit(repoPath, args, { extraEnv: env })       // git-net 合并 env 后 spawn
            └─ git 缺凭据 → 调 GIT_ASKPASS → 脚本回显缓存值 → 鉴权
                 ├─ 成功
                 └─ 失败（无缓存 / Token 失效）→ 抛鉴权错误
                      └─ 前端识别为「需要登录」→ 弹 GitCredentialDialog(host, username, token)
                           └─ commands.saveGitCredential(host, user, token)（加密落盘）
                                └─ 自动重试原操作
```

设置面板「凭据管理」：`listGitCredentials()` → 列出 {host, username, hasToken}；`deleteGitCredential(host)` 清除。

---

## 4. 组件与文件清单

### 4.1 新增
| 文件 | 作用 |
|---|---|
| `server/services/credential.service.ts` | 凭据 CRUD + host 解析 + `buildAuthEnv(repoPath)`；可设置存储单例 `setCredentialStorage()` |
| `server/services/git-askpass.ts` | 运行时生成 askpass 脚本（cmd/sh + js），返回包装脚本路径 |
| `server/services/credential.service.test.ts` | 单测：CRUD / host 归一化 / resolveHost / buildAuthEnv / askpass 选值 |
| `electron/credential-store.ts` | safeStorage 加密的 `CredentialStorage` 实现 + 启动时 `setCredentialStorage()` |
| `src/components/common/GitCredentialDialog.vue` | 登录对话框（host / 用户名 / Token，含「保存并重试」） |

### 4.2 修改
| 文件 | 改动 |
|---|---|
| `server/services/git-net.ts` | `runTracked`/`runNetworkGit` 增 `opts.extraEnv`，merge 进 spawn env |
| `server/services/remote.service.ts` | push/pull/fetch/forcePull/fetchAll/fetchBranch 前 `buildAuthEnv` 并传 `extraEnv` |
| `server/git-service.ts` | facade 增 spread `credentialFacade`（save/list/delete） |
| `shared/types.ts` | `GitCredentialInfo {host;username;hasToken}`；Commands 增 3 方法 |
| `shared/command-manifest.ts` | 新增 `saveGitCredential` / `listGitCredentials` / `deleteGitCredential` |
| `electron/preload.ts` | 新增 3 条 ipc 白名单 |
| `electron/main.ts` | 启动调用 `setCredentialStorage(safeStorage 版)` |
| `server/index.ts` | 启动调用 `setCredentialStorage(明文文件版)`（或用默认明文） |
| `src/components/common/PushDialog.vue` | 鉴权失败 → 开 GitCredentialDialog → 重试 doPush/handleDivergence* |
| `src/components/common/SystemSettingsDialog.vue` | 新增「Git 凭据」管理区（列表 + 清除） |

### 4.3 存储格式
`{userData}/git-credentials.json`（Electron）/ `~/.git-manager/git-credentials.json`（Web）：
```jsonc
{
  "github.com": { "username": "alice", "secret": "<enc|plain>", "encrypted": true }
}
```
- Electron：`secret` 为 safeStorage 加密后的 base64；不可用时降级明文 + warn（与 ai-apikey 一致）。
- 列表 API 只回 `{host, username, hasToken: !!secret}`，**绝不回 secret**。

### 4.4 命令契约（manifest）
| method | ipc | http | bodyKeys |
|---|---|---|---|
| `saveGitCredential` | `save_git_credential` | `/credential/save` | `["host","username","token"]` |
| `listGitCredentials` | `list_git_credentials` | `/credential/list` | `[]` |
| `deleteGitCredential` | `delete_git_credential` | `/credential/delete` | `["host"]` |

> 走 COMMANDS 自动布线（routes/IPC/adapter 自动生成），因 credentialService 用**模块级存储单例**（启动时由各运行时 set），facade 无需 per-call 注入。`save/delete` 归入 `WRITE_COMMANDS`？否——它们不跑 git，不必冻结后台刷新；不登记。

---

## 5. 错误处理

### 5.1 鉴权失败识别（前端）
联网操作错误信息命中以下任一，判定为「需要登录」：
`/authentication failed|could not read Username|terminal prompts disabled|Permission denied|HTTP 403|invalid username or password/i`
- host 取自当前远端 URL（`getRemotes` 解析）。
- pull 走 MergeResult（不抛）→ 同样按 `message` 命中判定；push/fetch 抛错 → 按 error message 判定。
- 命中 → 打开 GitCredentialDialog（预填 host，若已有缓存预填 username）。

### 5.2 取消与并发
- 与已实现的 cancelNetworkOps 兼容：askpass env 注入不改变可取消性（askpass 是 git 的子调用，杀 git 进程树即终止）。
- 用户取消登录对话框 → 不重试，按普通失败处理。

### 5.3 安全
- Token 仅存于加密文件 + 调用时的子进程 env；**不进 argv、不写 git 明文 store、不回显前端、日志 redact**。
- askpass 脚本文件不含密钥；目录权限 0o700、文件 0o600/0o755（脚本需可执行）。

---

## 6. 测试

| 层 | 用例 |
|---|---|
| credential.service | save/get/delete/list；host 归一化（大小写/端口）；resolveHost 解析 https/ssh/无 remote；buildAuthEnv：有缓存→含 GIT_ASKPASS+GM_*；无缓存/SSH→{} |
| askpass 选值 | 用生成的脚本 + execFile，传 `Username for ...` / `Password for ...` 与 GM_ASKPASS_* env，断言 stdout 为对应值（win32 跑 .cmd） |
| git-net | `runTracked` 透传 `extraEnv`（用 node 子进程回显某 env 断言） |
| 前端 | 环境为 node 无 DOM——GitCredentialDialog 靠类型检查 + 人工；鉴权识别正则抽成纯函数单测 |

验收：`pnpm check` 全绿（typecheck + lint ≤65 warn + test）。

---

## 7. 兼容与回滚
- 纯新增为主；remote.service 仅在每次联网前多一次 `buildAuthEnv`（无缓存即 {} 几乎零成本）。
- 已装 GCM 的用户不受影响：未缓存凭据时 buildAuthEnv 返回 {}，git 仍走 GCM。
- 回滚：删除新增文件 + 还原 remote.service / git-net 的 extraEnv 接入即可。

---

## 8. 待评审决策点
1. 反应式（失败才弹）之外，是否要在设置里**主动新增**凭据？（建议：是，「凭据管理」区加「添加」按钮，低成本）
2. 凭据键是否计入端口（如自建 GitLab `host:8443`）？（建议：是，键 = `host[:port]`）
3. Token 失效（已有缓存但 401）后的体验：直接弹登录覆盖（建议）vs 先提示再弹。
