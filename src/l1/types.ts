/**
 * L1 核心类型定义
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §二
 * @see ../../docs/mvp/09-l1-implementation.md §5.1
 *
 * 注意：本文件将在 A1 完整定义所有类型。
 * A0 阶段只定义 mock 需要的最小子集。
 */

// ============== Value（基本值类型）==============
export type Value =
  | string
  | number
  | boolean
  | null
  | undefined
  | Value[]
  | { [key: string]: Value }

// ============== Address（地址类型，3 种 kind）==============
export type Address =
  | { kind: 'literal'; value: Value }
  | { kind: 'variable'; name: string }
  | { kind: 'file'; path: string }

// ============== StackEntry 基础字段 ==============
export interface BaseEntry {
  id: string
  parentIntentId: string | null
  createdAt: number
}

// ============== 5 种 StackEntry（暂时只声明用于 mock）==============
// 完整定义在 A1
export interface OpEntry extends BaseEntry {
  kind: 'execute_op'
  // 其他字段在 A1 定义
}

export interface IntentEntry extends BaseEntry {
  kind: 'execute_intent'
  // 其他字段在 A1 定义
}

// ============== RecognizedIntent（L3 输入）==============
export interface RecognizedIntent {
  type: string
  params: Record<string, unknown>
}