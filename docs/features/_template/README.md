# Feature 阶段文档模板

复制本目录到 `docs/features/<feature-kebab-name>/` 作为新需求的起点。

## 文件清单

| 文件 | 何时填写 | 必出场景 |
| --- | --- | --- |
| [`01_REQUIREMENT_ANALYSIS.md`](01_REQUIREMENT_ANALYSIS.md) | 进入开发前 | 中等及以上需求 |
| [`02_SOLUTION_DESIGN.md`](02_SOLUTION_DESIGN.md) | 进入开发前 | 中等及以上需求 |
| [`03_GATE_REVIEW.md`](03_GATE_REVIEW.md) | 开发前闸门评估 | 高风险 / 大需求 |
| [`04_DEVELOPMENT.md`](04_DEVELOPMENT.md) | 开发过程中 | 中等及以上需求 |
| [`05_CODE_REVIEW.md`](05_CODE_REVIEW.md) | Code Review 后 | 中等及以上需求 |
| [`06_TEST_REPORT.md`](06_TEST_REPORT.md) | 测试完成后 | 中等及以上需求 |

一句话小需求和小 Bug 不强制沉淀本目录，可只写 `feature-brief.md` 或 PR 描述；
一旦升级或日后回顾价值高，再迁入。

## 版本规范

每份文档顶部维护：

- **任务 ID**：与 `docs/features/INDEX.md` 一致
- **状态**：`Draft` / `Approved` / `Outdated`
- **更新时间**：YYYY-MM-DD

被取代时**不要删除**，改 `Outdated` 并在新文档中链接旧版。
