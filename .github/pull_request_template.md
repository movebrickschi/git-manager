<!--
  Engineering Harness PR 模板
  规则与流程见 docs/engineering-harness.md 与 CONTRIBUTING.md
  非 hotfix 类 PR 必须填写本模板各项；不适用项写「N/A」并简述原因。
-->

## 1. 背景与目标

<!-- 这是什么需求 / Bug / 重构 / 性能优化？关联的需求文档或任务 ID。 -->

- 任务 ID：T-XXXX（与 `docs/features/INDEX.md` 一致；一句话需求可直接写需求描述）
- 关联文档：`docs/features/<feature>/` 或 `feature-brief.md` 或 PR 描述中
- 关联 ADR：`docs/adr/NNNN-...md` 或「不需要」

## 2. 改动概览

<!-- 一段话说明做了什么；可以附必要的代码片段或截图。 -->

## 3. 流程类型

- [ ] 一句话小需求（oneliner）
- [ ] 中等需求（doc / proto）
- [ ] 大需求 / 高风险（doc，含 Gate Review）
- [ ] Bug 修复（bugfix-flow）
- [ ] 重构（refactor-flow）
- [ ] 性能优化（perf-flow）
- [ ] 第三方接入（third-party-flow）
- [ ] 紧急通道（hotfix）—— 需在第 9 节填写审批

## 4. 影响范围（IMPACT_ANALYSIS）

| 维度 | 是否影响 | 说明 |
| --- | --- | --- |
| API（新增 / 修改 / 删除） | 是 / 否 | |
| 数据库（表结构 / 索引 / Flyway） | 是 / 否 | |
| 鉴权 / 权限 / 租户隔离 | 是 / 否 | |
| 配置（Nacos / 环境变量） | 是 / 否 | |
| 缓存 / 搜索 / 锁 / 异步 | 是 / 否 | |
| 第三方依赖 | 是 / 否 | |
| 现有调用方兼容性 | 是 / 否 | |
| 性能 / 容量 | 是 / 否 | |
| 安全 / 敏感信息 | 是 / 否 | |
| 文档（Swagger / 模块文档） | 是 / 否 | |

## 5. API 契约（如涉及）

<!-- 接口路径、方法、鉴权、请求、返回、错误、兼容性。 -->

## 6. 数据库变更（如涉及）

- Flyway 脚本路径：`src/main/resources/db/migration/V<n>__<desc>.sql`
- 回滚 SQL / 回滚说明：
- SIT 验证结果：

## 7. 测试

- [ ] Controller 改动：MockMvc / 集成测试覆盖正常 / 校验失败 / 鉴权失败
- [ ] Service 改动：单元测试覆盖核心分支与异常分支
- [ ] Mapper / SQL 改动：集成测试或手工 SQL 验证（在阶段文档给出）
- [ ] Flyway 迁移：在 SIT 验证并写明回滚
- [ ] 缓存 / 锁 / 异步：最小用例
- [ ] `mvn -B test` 通过
- [ ] `./scripts/engineering-check.ps1` 通过（贴出 Summary 行）

测试摘要：

```
Tests run: ?, Failures: ?, Errors: ?, Skipped: ?
Summary:   ? PASS / ? WARN / ? FAIL / ? SKIP
```

## 8. 文档与 ADR

- [ ] 模块文档（`apps/api/docs/*.md`）已更新或不适用
- [ ] `docs/features/INDEX.md` 已更新状态
- [ ] 涉及决策：已新增 ADR `docs/adr/NNNN-...md`（或「不需要」）
- [ ] Swagger 注解齐全

## 9. 紧急通道（仅 hotfix 时填写）

- 触发原因（事故 / 数据 / 安全 / 阻断）：
- 审批人（值班负责人 / 项目负责人）：
- 审批理由：
- 48 小时内补单计划：

## 10. 自检清单（提交前）

- [ ] 不引入 `System.out.println` / `System.err.println`
- [ ] Controller 返回 `R<T>`，未使用裸 `ResponseEntity`
- [ ] 使用构造器注入 + Lombok，未新增字段 `@Autowired`
- [ ] 中文 Javadoc / 注释齐全
- [ ] 日志带 `[模块名]` 前缀，未打印密钥 / 密码 / Token
- [ ] 配置文件无明文密钥，新配置项已记录
- [ ] 工作区清洁，无临时目录或缓存入库
- [ ] 第一期边界未越界（业务表 / 接口 / 生产依赖未变）

## 11. 回滚预案

- 代码回滚：revert PR
- 配置回滚：
- 数据回滚：
- 监控指标：

<!--
  审查者请遵循 docs/engineering-harness.md 第 5 章「回退路由」：
  发现必改项 → 退回开发；发现设计跑偏 → 退回方案设计；
  Reviewer 不直接修代码。
-->
