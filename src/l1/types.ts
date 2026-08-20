/**
 * L1 核心类型定义（完整版 - A1）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §二
 * @see ../../docs/mvp/09-l1-implementation.md §5.1
 * @see ../../docs/mvp/06-execution-layer.md §3
 *
 * 本文件定义 L1 调度器的所有核心类型：
 * - Value：基本值类型
 * - Address：3 种地址（literal/variable/file）
 * - RecognizedIntent / StandardIntent：意图类型
 * - 5 种 StackEntry（OpEntry/IntentEntry/MoveEntry/SkipN/ConditionalSkip）
 * - StackEntry union
 * - assertNever helper
 */

// ============== Value ==============
/**
 * 基本值类型
 *
 * 支持：
 * - string、number、boolean、null、undefined
 * - Value[]（数组）
 * - { [key: string]: Value }（对象）
 */
export type Value =
  | string
  | number
  | boolean
  | null
  | undefined
  | Value[]
  | { [key: string]: Value }

// ============== Address（3 种 kind）==============
/**
 * 地址类型 - 用于 resolve 和 write
 *
 * 三种 kind：
 * - literal：直接值（常量）
 * - variable：从 resultStore 读取/写入
 * - file：从文件读取/写入文件
 */
export type Address =
  | { kind: 'literal'; value: Value }
  | { kind: 'variable'; name: string }
  | { kind: 'file'; path: string }

// ============== Intent 类型 ==============
/**
 * LLM 识别后的意图（已结构化）
 */
export interface RecognizedIntent {
  type: string
  params: Record<string, unknown>
}

/**
 * 标准意图定义（L3 输入）
 *
 * A1 阶段定义最小版本（children 暂为 unknown[]）。
 * 完整 child 结构（op/sub_intent/if）在 Phase C 实现。
 */
export interface StandardIntent {
  name: string
  description: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  children: unknown[]
}

// ============== BaseEntry（所有 StackEntry 共有字段）==============
/**
 * 指令栈条目的基础字段
 *
 * - id：唯一标识符
 * - parentIntentId：所属父意图的 id（用于错误传播等）
 * - createdAt：创建时间戳（用于调试、trace）
 */
export interface BaseEntry {
  id: string
  parentIntentId: string | null
  createdAt: number
}

// ============== OpEntry ==============
/**
 * execute_op primitive 的栈条目
 *
 * 用于调度 L2 operation 的原子执行。
 */
export interface OpEntry extends BaseEntry {
  kind: 'execute_op'
  /** L2 operation 名称（如 'file_read', 'file_write'）*/
  operation: string
  /** 输入参数：key → Address（值来源）*/
  inputs: Record<string, Address>
  /** 输出参数：key → Address（值写入位置）*/
  outputs: Record<string, Address>
  /** 执行状态 */
  status: 'pending' | 'running' | 'done'
}

// ============== IntentEntry ==============
/**
 * execute_intent primitive 的栈条目
 *
 * 用于调度 L3 service 分解意图。
 *
 * phase 状态机：
 * - pending：刚进入，等待调 L3.compile
 * - awaiting_children：children 已压栈，等待所有完成
 * - done：所有 children 完成，正常结束
 * - aborted：被硬错误中止
 */
export interface IntentEntry extends BaseEntry {
  kind: 'execute_intent'
  /** 意图内容（已识别或标准）*/
  intent: RecognizedIntent | StandardIntent
  /** 生命周期阶段 */
  phase: 'pending' | 'awaiting_children' | 'done' | 'aborted'
  /** 编译后的子 entries */
  children: StackEntry[]
}

// ============== MoveEntry ==============
/**
 * move primitive 的栈条目
 *
 * 从源地址读取值，写入目标地址。
 * 不调用任何 L2/L3，是纯数据操作。
 */
export interface MoveEntry extends BaseEntry {
  kind: 'move'
  /** 源地址 */
  from: Address
  /** 目标地址 */
  to: Address
}

// ============== SkipN ==============
/**
 * skip_n primitive 的栈条目
 *
 * 无条件跳过后续 n 个 entries（自身 + n 个 = n+1 个）。
 * 用于实现线性序列跳过。
 */
export interface SkipN extends BaseEntry {
  kind: 'skip_n'
  /** 跳过后续 entry 数（self + n = n+1 个总弹出）*/
  n: number
}

// ============== ConditionalSkip ==============
/**
 * conditional_skip primitive 的栈条目
 *
 * 根据条件值决定：
 * - 真：跳过后续 n 个（self + n = n+1 个总弹出）
 * - 假：只弹出 self（执行后续）
 *
 * 用于实现 if-then-else 的条件分支。
 */
export interface ConditionalSkip extends BaseEntry {
  kind: 'conditional_skip'
  /** 条件值所在的 Address（必须指向一个 variable）*/
  conditionAddr: Address
  /** 条件为真时跳过的 entry 数 */
  n: number
}

// ============== StackEntry（5 kinds union）==============
/**
 * L1 调度器支持的 5 种指令条目
 *
 * 这是 discriminated union，通过 kind 字段进行类型缩窄。
 *
 * CPU ISA 类比（参考 doc 06 §13）：
 * - execute_op    → ALU op (ADD, MUL, ...)
 * - execute_intent → CALL subroutine
 * - move          → MOV / LOAD / STORE
 * - skip_n        → UNCOND JMP
 * - conditional_skip → BRANCH (条件跳转)
 */
export type StackEntry =
  | OpEntry
  | IntentEntry
  | MoveEntry
  | SkipN
  | ConditionalSkip

// ============== Exhaustiveness Helper ==============
/**
 * TypeScript 严格穷尽检查助手
 *
 * 在 switch 的 default 分支调用，确保所有 kind 都被处理。
 * 如果新增了 kind 但未处理，编译会报错（类型不兼容）。
 *
 * @example
 * ```typescript
 * switch (entry.kind) {
 *   case 'execute_op': ...
 *   case 'execute_intent': ...
 *   // ...
 *   default:
 *     return assertNever(entry)
 * }
 * ```
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`)
}

// ============== Type Guards（可选辅助）==============
/**
 * 检查是否为 OpEntry
 */
export function isOpEntry(entry: StackEntry): entry is OpEntry {
  return entry.kind === 'execute_op'
}

/**
 * 检查是否为 IntentEntry
 */
export function isIntentEntry(entry: StackEntry): entry is IntentEntry {
  return entry.kind === 'execute_intent'
}

/**
 * 检查是否为 MoveEntry
 */
export function isMoveEntry(entry: StackEntry): entry is MoveEntry {
  return entry.kind === 'move'
}

/**
 * 检查是否为 SkipN
 */
export function isSkipN(entry: StackEntry): entry is SkipN {
  return entry.kind === 'skip_n'
}

/**
 * 检查是否为 ConditionalSkip
 */
export function isConditionalSkip(entry: StackEntry): entry is ConditionalSkip {
  return entry.kind === 'conditional_skip'
}