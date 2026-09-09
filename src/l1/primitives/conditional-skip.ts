/**
 * conditional_skip primitive 执行函数（双区架构版）
 *
 * @see ../../docs/mvp/06-execution-layer.md §3.5
 * @see ../../docs/mvp/10-reactive-execution-model.md §三.6
 *
 * 完整设计：
 * - 从 internalStore 读取 conditionAddr 指向的值（双区架构约束）
 * - conditionAddr 必须是 internal kind（运行时校验）
 * - truthy 判断：
 *     null/undefined → false
 *     boolean → 本身
 *     number → !== 0
 *     string → 非空
 *     array/object → 非空
 * - truthy → 弹出 self + n 个后续 entry（总 n+1 个）
 * - falsy → 仅弹出 self
 * - 栈不足时 graceful（弹空为止）
 *
 * MVP 约束：n >= 0（仅前向跳转）
 *
 * 与 x86 Jcc 的类比：
 * - conditional_skip = Jcc（读标志/寄存器判断）
 * - conditionAddr 指向的 internal 寄存器 = FLAGS 寄存器（隐式传递）
 * - 条件值由前面的 execute_op（CMP/AND 等）写入
 *
 * DAG 典型用法：
 *   [op(file_read, outputs: {content: $r1, error: $r_err}),
 *    conditional_skip($r_err, n=2),  // 有错误跳 else
 *    ...else block...
 *    skip_n(1),                     // 跳 then
 *    ...then block...]
 */

import type { ConditionalSkip } from '../types.js'
import type { ExecutionState } from '../execution-state.js'
import { isInternalAddress, isIntentEntry } from '../types.js'

/**
 * conditional_skip 参数错误
 */
export class ConditionalSkipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConditionalSkipError'
  }
}

/**
 * 判断值是否为 truthy
 *
 * 规则（与 doc 06 §3.5 一致）：
 * - null / undefined → false
 * - boolean → value
 * - number → !== 0
 * - string → length > 0
 * - array → length > 0
 * - object → Object.keys(obj).length > 0
 * - 其他 → Boolean(value)
 */
export function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value.length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') {
    const isEmpty = Object.keys(value as object).length === 0
    return !isEmpty
  }
  /* v8 ignore next 3 -- 防御性兑底 + vitest v8 的 `}` 闭合分支误报 */
  return Boolean(value)
}

/**
 * 执行 conditional_skip primitive
 *
 * @param entry conditional_skip 条目
 * @param state 当前执行状态
 *
 * 行为：
 * 1. 校验 conditionAddr.kind === 'internal'（双区架构约束）
 * 2. 校验 n >= 0（MVP 约束）
 * 3. 从 internalStore 读取 conditionAddr.name 的值
 * 4. truthy 判断
 * 5. 根据结果弹出 self + （可选）n 个后续 entry
 *
 * 错误处理：
 * - conditionAddr 不是 internal → 抛 ConditionalSkipError
 * - n < 0 → 抛 ConditionalSkipError
 * - 内部寄存器不存在 → 返回 falsy（graceful，符合 "条件不满足" 语义）
 *
 * 注意：内部寄存器不存在**不抛错**，因为这等价于"条件值未初始化"，
 * 在 DAG 早期（顺序执行前）理论上不应发生，但若发生则视为 falsy 跳过。
 */
export async function executeConditionalSkip(
  entry: ConditionalSkip,
  state: ExecutionState
): Promise<void> {
  // ============ Step 1: 校验 conditionAddr kind ============
  if (!isInternalAddress(entry.conditionAddr)) {
    throw new ConditionalSkipError(
      `conditional_skip.conditionAddr must be internal (got '${entry.conditionAddr.kind}'). ` +
      `Use move to copy from literal/public first.`
    )
  }

  // ============ Step 2: 校验 n >= 0 ============
  if (entry.n < 0) {
    throw new ConditionalSkipError(
      `conditional_skip.n must be >= 0 (MVP: only forward jumps), got ${entry.n}`
    )
  }

  // ============ Step 3: 读取条件值 ============
  const regName = entry.conditionAddr.name
  const condValue = state.internalStore.get(regName)

  // 内部寄存器不存在视为 falsy（graceful）
  // 不抛错，因为：
  //   1. 这等价于"条件值未初始化"，DAG 顺序执行下不应发生
  //   2. 抛错会让 DAG 在小错误上完全崩溃
  //   3. 等价于 falsy → 跳过 self（继续执行下一条 entry），符合"条件不满足"语义

  // ============ Step 4: truthy 判断 ============
  const truthy = isTruthy(condValue)

  // ============ Step 5: 弹栈 ============
  if (truthy) {
    // 条件为真：弹出 self + n 个后续 entry
    // 帧边界保护（A11 细化）：
    //   - pending 帧（未开始的子调用）：允许跳过 —— 循环终止需要跳过 execute_intent(self)
    //   - awaiting_children / aborted 帧（执行中/已结束）：停止弹出（保护调用边界）
    const totalPops = entry.n + 1
    for (let i = 0; i < totalPops; i++) {
      if (state.stack.length === 0) break
      const top = state.stack[state.stack.length - 1]
      if (isIntentEntry(top) && top.phase !== 'pending') break
      state.stack.pop()
    }
  } else {
    // 条件为假：仅弹出 self
    state.stack.pop()
  }
}