/**
 * 旧 import 路径的兼容 shim。
 *
 * P5 之后所有领域 DTO 与 Commands / Platform 都集中在 `shared/types.ts`，作为
 * 前端 / Express / Electron 三端共享的唯一类型源。本文件仅做透传，避免一次性
 * 改动十几处旧 import；新代码请直接从 `@/../shared/types` 或经由
 * `@/utils/commands` re-export 引用。
 */

export * from "../../shared/types.js";
