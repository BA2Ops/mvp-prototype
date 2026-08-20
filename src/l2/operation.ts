/**
 * L2 Operation 接口定义
 *
 * @see ../../docs/mvp/06-execution-layer.md §3
 * @see ../../docs/mvp/09-l1-implementation.md §6.1
 *
 * A0 阶段定义最小版本（支持 mock 实现）。
 * 完整版本（带 inputs/outputs schema、context 等）在 Phase B 实现。
 */

import type { Value } from '../l1/types.js'

/**
 * Operation 是 L2 原子操作的接口。
 *
 * 设计原则：
 * - 简单对象形式（无需类继承）
 * - execute 函数负责实际逻辑
 * - inputs/outputs 是 schema 描述（用于文档和校验）
 */
export interface Operation {
  /** operation 唯一名称（如 'file_read'）*/
  name: string

  /** 简短描述 */
  description: string

  /** 输入 schema（key → 字段描述）*/
  inputs: Record<string, FieldSchema>

  /** 输出 schema（key → 字段描述）*/
  outputs: Record<string, FieldSchema>

  /**
   * 执行函数
   * @param inputs 已解析的输入值
   * @returns 输出值
   *
   * 错误处理契约：
   * - 已知错误（可恢复）：返回 { error: {...} } 不 throw
   * - 硬错误（不可恢复）：throw Error
   */
  execute(inputs: Record<string, Value>): Promise<Record<string, Value>>
}

/**
 * 字段 schema 描述
 */
export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'path' | 'any'
  required: boolean
  description?: string
}