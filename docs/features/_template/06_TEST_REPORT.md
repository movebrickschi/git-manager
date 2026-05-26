# 06 测试报告

- **任务 ID**：T-XXXX
- **状态**：Pending / Passed / Blocked
- **更新时间**：YYYY-MM-DD
- **执行人**：<姓名 / Agent>

## 1. 测试范围

- 涵盖的功能点：
- 显式不在本次范围内的部分：

## 2. 测试分层执行情况

| 层级 | 是否覆盖 | 命令 / 文件 | 结果 |
| --- | --- | --- | --- |
| Controller（MockMvc / 集成） | | `mvn -B test -Dtest=XxxControllerTest` | PASS / FAIL |
| Service（单元） | | … | … |
| Mapper / SQL | | … | … |
| Flyway 迁移（含回滚） | | 在 SIT 验证 | … |
| 缓存 / 锁 / 异步 | | 关键用例 | … |
| 端到端（E2E / 手工） | | 操作步骤 | … |

## 3. 自动化结果

```
mvn -B test
...
Tests run: <total>, Failures: <f>, Errors: <e>, Skipped: <s>
```

JaCoCo 覆盖率：

- 行覆盖：%
- 分支覆盖：%

与 `verification_baseline.json` 对比：是否倒退？

## 4. 缺陷记录

| 编号 | 严重性 | 描述 | 是否已修复 | 关联 commit |
| --- | --- | --- | --- | --- |
| D-1 | Critical / Major / Minor | … | 是 / 否 | … |

## 5. 性能验证（如涉及）

- 基线数据：
- 优化后：
- 对比与结论：

## 6. 安全验证（如涉及）

- 鉴权 / 权限路径：
- 输入校验 / 输出脱敏：
- 越权 / 跨租户尝试：

## 7. 剩余风险

- 未覆盖场景：
- 已知问题与跟进计划：

## 8. 上线建议

- [ ] 通过，可上线
- [ ] 需要灰度 / 限流
- [ ] 阻塞，理由：
