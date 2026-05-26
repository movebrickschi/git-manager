# ADR 0001 · Engineering Harness Baseline

- **Date**: 2026-05-20
- **Status**: Accepted

## Context
项目 `git-manager` 接入 Engineering Harness（mode=`solo`，stack=`node-typescript`）以建立从需求到发布的工程治理基线。

## Decision
- 使用 Harness Engineering MCP 作为工程治理基座。
- 使用 `harness.config.json` 作为项目级机器可读配置。
- 使用 `harness_route_task` 路由日常任务到对应 skill。
- 提交前执行 `harness_check` 并达到 PASS。

## Consequences
- 规范、skills、rules、templates 通过 MCP 资源实时供给。
- 项目本地只保留 project-specific 文件，升级成本更低。
- 团队规模变化时通过 `harness_upgrade_mode` 升档。
