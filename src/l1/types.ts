/**
 * L1 核心类型定义（双区架构版）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §二
 * @see ../../docs/mvp/09-l1-implementation.md §5.1
 * @see ../../docs/mvp/06-execution-layer.md §3
 *
 * 完整设计（基于 2026-08-20 重大架构反馈）：
 *
 * 1. Address 4 kinds：
 *    - literal：常量（仅作 move 源）
 *    - public：业务数据（持久，业务命名）
 *    - internal：寄存器（瞬态，形参命名）
 *    - file：外部存储（文件）
 *
 * 2. 双区存储：
 *    - publicStore：业务数据
 *    - internalStore：寄存器
 *
 * 3. 每个 op 的 input/output 独立寄存器（不共享）
 *
 * 4. 错误寄存器 $r_err（全局共享）
 *
 * 5. Primitive 约束：
 *    - move：可读写任何（literal 除外作为目标）
 *    - execute_op：只能读写 internal
 *    - execute_intent：只能读写 internal
 *    - conditional_skip：条件必须是 internal
 *    - skip_n：无地址访问
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

// ============== Address（3 种 kind）==============
/**
 * 地址类型
 *
 * 三种 kind：
 * - literal：常量值（只作为 move 源）
 * - public：公共数据区（业务命名，持久）
 * - internal：内部寄存器（寄存器名，瞬态）
 *
 * 注：原先还有第 4 种 kind='file'（把文件系统当作可寻址存储，move(file→X)/move(X→file)
 * 直接读写盘）。后来架构上明确"IO 职责一律由 L2 op 承担"（execute_op('file_read')/
 * ('write_file')），L1 本身不再做任何 fs IO，故 file kind 被移除。详见 l1-design/02-instructions/move.md。
 *
 * 设计原则：
 * - literal 必须通过 move 命名后才能被 execute_op 使用
 * - execute_op 只能读写 internal（不允许 literal/public）
 * - move 是唯一跨越数据区的桥梁
 */
export type Address =
  | { kind: 'literal'; value: Value }
  | { kind: 'public'; name: string }
  | { kind: 'internal'; name: string }

// ============== Intent 类型 ==============
/**
 * LLM 识别后的意图（已结构化）
 */
export interface RecognizedIntent {
  type: string
  params: Record<string, unknown>
}

// ============== BaseEntry ==============
/**
 * 指令栈条目的基础字段
 */
export interface BaseEntry {
  id: string
  parentIntentId: string | null
  createdAt: number
}

// ============== 5 种 StackEntry ==============
/**
 * execute_op primitive 的栈条目
 *
 * 约束：
 * - inputs 只能是 internal kind 的 Address
 * - outputs 只能是 internal kind 的 Address
 */
export interface OpEntry extends BaseEntry {
  kind: 'execute_op'
  /** L2 operation 名称（如 'file_read', 'file_write'）*/
  operation: string
  /** 输入参数：key → Address（仅 internal）*/
  inputs: Record<string, Address>
  /** 输出参数：key → Address（仅 internal）*/
  outputs: Record<string, Address>
  /** 执行状态 */
  status: 'pending' | 'running' | 'done'
}

/**
 * execute_intent primitive 的栈条目
 */
export interface IntentEntry extends BaseEntry {
  kind: 'execute_intent'
  /** 意图内容（Experience ID + params，由 L4 LLM 标准化） */
  intent: RecognizedIntent
  /** 生命周期阶段 */
  phase: 'pending' | 'awaiting_children' | 'done' | 'aborted'
  /** 编译后的子 entries */
  children: StackEntry[]
  /**
   * 异常处理标志（L3 编译时设置）
   *
   * true  = 本经验内的异常由后续指令检查 $r_err 处理（L1 不冒泡，截获在此层）
   * false = 默认：异常由 L1 递归向上冒泡（弹出本层序列，直到遇到 handleError 层）
   *
   * 这是解释执行的错误处置权来源：是否捕捉/处理错误由 L3 的经验决定，
   * 而非 L2 op 自己决定。
   */
  handleError: boolean
  /**
   * CRR Frame Scope ID (T-1.5)
   *
   * 当 CompileOptions.useFixedSlotConvention=true 时由 compiler 分配,
   * main-loop 在 enterIntent 时 enterScope / exitIntent 时 exitScope,
   * bubbleError abortFrame 也必须对称 exitScope (R-1🔴高)。
   *
   * legacy path (useFixedSlotConvention=false) 保持 undefined,
   * main-loop 不调用 FrameScopeAllocator。
   */
  scopeId?: string
  /**
   * CRR P3/T-3.2: registerOutput binding — 这些 input key 已被父 compile 生成的
   * binding move 提前填充到 $r_input_<k>,bindInputs 不再生成 literal sidecar move.
   */
  prefilledInputKeys?: Set<string>
}

/**
 * move primitive 的栈条目
 *
 * 约束：
 * - from 可以是 literal/public/internal/file
 * - to 不能是 literal
 */
export interface MoveEntry extends BaseEntry {
  kind: 'move'
  /** 源地址 */
  from: Address
  /** 目标地址（不能是 literal）*/
  to: Address
}

/**
 * skip_n primitive 的栈条目
 */
export interface SkipN extends BaseEntry {
  kind: 'skip_n'
  /** 跳过后续 entry 数（self + n = n+1 个总弹出）*/
  n: number
}

/**
 * conditional_skip primitive 的栈条目
 *
 * 约束：conditionAddr 必须是 internal
 */
export interface ConditionalSkip extends BaseEntry {
  kind: 'conditional_skip'
  /** 条件值所在的 Address（必须指向 internal）*/
  conditionAddr: Address
  /** 条件为真时跳过的 entry 数 */
  n: number
}

/**
 * L1 调度器支持的 5 种指令条目（discriminated union）
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
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`)
}

// ============== Type Guards ==============
export function isOpEntry(entry: StackEntry): entry is OpEntry {
  return entry.kind === 'execute_op'
}

export function isIntentEntry(entry: StackEntry): entry is IntentEntry {
  return entry.kind === 'execute_intent'
}

export function isMoveEntry(entry: StackEntry): entry is MoveEntry {
  return entry.kind === 'move'
}

export function isSkipN(entry: StackEntry): entry is SkipN {
  return entry.kind === 'skip_n'
}

export function isConditionalSkip(entry: StackEntry): entry is ConditionalSkip {
  return entry.kind === 'conditional_skip'
}

// ============== Address 类型守卫 ==============
export function isLiteralAddress(addr: Address): addr is { kind: 'literal'; value: Value } {
  return addr.kind === 'literal'
}

export function isPublicAddress(addr: Address): addr is { kind: 'public'; name: string } {
  return addr.kind === 'public'
}

export function isInternalAddress(addr: Address): addr is { kind: 'internal'; name: string } {
  return addr.kind === 'internal'
}