# Engineering Harness · git-manager

> 项目内 SSOT 入口。完整规范通过 MCP 资源 `harness://spec/solo` 获取。

- Mode: `solo`
- Stack: `node-typescript`
- Project Type: `frontend-spa`

## 任务路由
新需求、Bug、重构、性能优化、第三方接入统一先调用 `harness_route_task`，再按返回的 skill 执行。

## 本地门禁
提交前调用 `harness_check`。在 strict 模式下 WARN 也视为 FAIL。

## 任务记忆
需求记录在 `docs/features/INDEX.md`，中大型需求建立 `docs/features/<feature>/` 阶段文档。

## ADR
架构变更、DB 表设计、第三方依赖引入必须写 ADR，存放在 `docs/adr/`。

## 升档
团队规模变化时运行 `harness_upgrade_mode`，按 `solo -> small-team -> mid-team -> org` 补齐增量文件。
