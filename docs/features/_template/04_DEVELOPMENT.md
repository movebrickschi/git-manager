# 04 开发记录

- **任务 ID**：T-XXXX
- **状态**：InProgress / Done
- **更新时间**：YYYY-MM-DD
- **开发者**：<姓名 / Agent>

## 1. 实现概览

- 起始 commit：
- 关键 commit：
- 关联 PR：

## 2. 关键文件

| 路径 | 类型 | 改动说明 |
| --- | --- | --- |
| src/main/java/.../XxxController.java | 新增 / 修改 | … |
| src/main/java/.../XxxService.java | 新增 / 修改 | … |
| src/main/resources/db/migration/V<n>__<desc>.sql | 新增 | … |

## 3. 偏离方案的变更

| 偏离项 | 原方案 | 新方案 | 原因 | 是否需要回 02_SOLUTION_DESIGN 修订 |
| --- | --- | --- | --- | --- |

## 4. Gate Review 条件落实

| 条件编号 | 落实方式 | 证据 |
| --- | --- | --- |
| C-1 | … | <文件 / 测试 / 截图> |

## 5. 自检清单（开发完成前）

- [ ] 编译通过：`mvn -B -DskipTests package`
- [ ] 测试通过：`mvn -B test`
- [ ] 本地门禁：`./scripts/engineering-check.ps1` 全部 PASS / 必要 WARN 已说明
- [ ] Swagger 注解齐全
- [ ] 中文 Javadoc / 注释
- [ ] 日志格式 `[模块名]` 前缀
- [ ] 无 `System.out.println`、无字段 `@Autowired`、无裸 `ResponseEntity`
- [ ] 涉及 DB 变更：Flyway 脚本 + 回滚 SQL
- [ ] 涉及配置变更：Nacos / 环境变量已记录

## 6. 已知风险与待办

- 风险 1：…
- TODO：…（需在 PR 中说明，不能默默遗留）

## 7. 提交前文档同步

- [ ] 模块文档（`apps/api/docs/*.md`）已更新
- [ ] `docs/features/INDEX.md` 状态已更新
- [ ] 必要的 ADR 已撰写
