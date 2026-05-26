# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build / Dev Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev:electron` | Primary dev mode (Electron desktop app) |
| `pnpm dev:web` | Web mode (Vite frontend + Express backend) |
| `pnpm dev` | Pure frontend preview (no backend) |
| `pnpm test` | Run all Vitest tests once |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test -- -t "name"` | Run tests matching a pattern |
| `pnpm typecheck` | Run all three tsconfig checks (web + server + electron) |
| `pnpm lint` | ESLint with max 65 warnings |
| `pnpm format` | Prettier format |
| `pnpm build:electron` | Full Electron installer build |
| `pnpm build:web` | Web production build |
| `pnpm check` | typecheck + lint + test |

## Architecture

This is an IDEA-style Git GUI client (Electron + Vue 3 + Vite + Tailwind CSS v4). It runs in three modes: Electron desktop, Web (Vite + Express), or pure frontend preview.

### Command Manifest — central routing table

`shared/command-manifest.ts` is the single source of truth that maps every API method to its IPC channel name, HTTP route, and parameter keys. Three consumers derive from it:
- **Electron main process**: iterates COMMANDS to register `ipcMain.handle(channel, ...)` handlers
- **Electron preload** (`electron/preload.ts`): has a hardcoded channel allowlist (sandboxed preload can't import external modules) — must be kept in sync manually
- **Frontend adapters** (`src/utils/electron-adapter.ts`, `src/utils/web-adapter.ts`): generated proxy objects that translate `commands.method(args)` → IPC invoke or HTTP POST

### Domain types — single source

`shared/types.ts` defines all DTOs (`CommitInfo`, `FileStatus`, `DiffResult`, `BranchInfo`, `Commands` interface, etc.). Historically types were duplicated across `server/git-service.ts` and `src/utils/types.ts` — both now re-export from `shared/types.ts`.

### Adapter pattern (runtime detection)

`src/utils/commands.ts` detects `window.electronAPI` at runtime to pick between `createElectronAdapter()` (IPC) and `createWebAdapter()` (HTTP fetch). All components import `commands` from this file and call methods without knowing which transport is active.

### Git backend

`server/git-service.ts` is a facade that spreads 11 sub-services: `repo`, `log`, `branch`, `status`, `remote`, `stash`, `blame`, `conflict`, `patch`, `submodule`, `rebase`. Each sub-service in `server/services/` wraps `simple-git` calls. The facade is shared by Electron main process (direct imports) and Express routes.

### State management

Pinia stores in `src/stores/` use composition API style (`defineStore` with setup function). Key stores: `repoStore` (multi-repo management), `logStore`, `branchStore`, `commitStore`, `reportStore`, `settingsStore`, `rebaseStore`, `filterStore`.

### Routing

Two routes defined inline in `src/main.ts`: `/` (WelcomeView) and `/repo` (GitLogView). Hash-based history (`createWebHashHistory`).

### i18n

`src/i18n/index.ts` provides `zh-CN` and `en-US` via vue-i18n. Locale persists to localStorage key `git-manager.locale`.

### Security constraints (Electron)

- Preload is sandboxed (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`)
- IPC channel allowlist in `electron/preload.ts` prevents arbitrary invoke from renderer
- CSP headers set in `electron/main.ts` (strict in production, relaxed in dev for HMR)
- API keys stored via `safeStorage` (macOS Keychain / Windows DPAPI / Linux libsecret) in Electron mode; plaintext fallback for Web mode

### Test layout

Vitest with globals enabled, environment: node. Tests live co-located as `*.test.ts` files in `server/`, `src/`, and `shared/`. Coverage targets `server/**/*.ts`, `src/utils/**/*.ts`, `shared/**/*.ts`.

### Key patterns

- When adding a new Git operation: add to `Commands` interface in `shared/types.ts`, add entry in `shared/command-manifest.ts`, register IPC handler in `electron/main.ts`, add channel to allowlist in `electron/preload.ts`, add Express route in `server/routes.ts`, implement in the appropriate `server/services/*.ts`
- All user-facing strings go through `$t()` from vue-i18n (keys in `src/i18n/locales/`)
- Monaco Editor is used for diff viewers (side-by-side and unified)
- `simple-git` is the only Git library; no raw child_process git calls
