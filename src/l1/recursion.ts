/**
 * 递归深度跟踪（A11）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §三
 * @see ../../docs/mvp/09-l1-implementation.md §循环支持
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase A11
 *
 * 设计（2026-08-20）：
 * - 循环通过**递归 intent 引用 + conditional_skip** 实现（不增加 loop primitive）
 * - 深度跟踪 = 按 intent.type 计数调用链上同名的帧数
 * - enterIntent/exitIntent 成对调用（帧生命周期由主循环管理）
 * - 超限抛 RecursionDepthError（L1 系统防御，不走业务冒泡）
 *
 * 与 execute_intent 解耦（doc 11 反思触发）：
 * - 深度跟踪不进入 execute-intent.ts（该文件保持纯"编译 + 压栈"）
 * - enter/exit 调用点在主循环 processIntentEntry 与 bubbleError
 */

import type { ExecutionState } from './execution-state.js'

/**
 * 默认最大递归深度
 *
 * 循环意图（自引用）的调用链深度上限。
 * 超出说明经验库存在失控递归（作者 bug），防御性终止。
 */
export const DEFAULT_MAX_RECURSION_DEPTH = 1000

/**
 * 递归深度超限错误（L1 系统防御错误）
 *
 * 语义与 L1MaxStepsError 相同：**不走业务冒泡**。
 * 若被 handleError 截获，递归经验可无限重试——防御机制失效。
 * 主循环 catch 中直接抛给调用者（见 l1MainLoop）。
 */
export class RecursionDepthError extends Error {
  constructor(intentName: string, depth: number) {
    super(`Intent '${intentName}' exceeded max recursion depth (${depth})`)
    this.name = 'RecursionDepthError'
  }
}

/**
 * 进入意图：调用链深度 +1
 *
 * @param intentName 意图类型名（intent.type）
 * @param state 执行状态（含 recursionDepth 计数）
 * @param maxDepth 深度上限（默认 DEFAULT_MAX_RECURSION_DEPTH）
 *
 * 超限 → 抛 RecursionDepthError（此时帧 phase 仍为 pending，冒泡不会误 exit）
 */
export function enterIntent(
  intentName: string,
  state: ExecutionState,
  maxDepth: number = DEFAULT_MAX_RECURSION_DEPTH
): void {
  const current = state.recursionDepth.get(intentName) ?? 0
  const next = current + 1
  if (next > maxDepth) {
    throw new RecursionDepthError(intentName, next)
  }
  state.recursionDepth.set(intentName, next)
}

/**
 * 退出意图：调用链深度 -1
 *
 * 语义：
 * - 计数归零 → 删除键（Map 保持干净，便于测试断言）
 * - 计数为负 → 防御：enter/exit 不平衡（调用方 bug），静默忽略
 */
export function exitIntent(intentName: string, state: ExecutionState): void {
  const current = state.recursionDepth.get(intentName) ?? 0
  if (current <= 0) {
    /* v8 ignore next 3 -- 防御代码：enter/exit 成对调用（主循环保证），此处仅防调用方 bug */
    // 不平衡调用：不破坏其他意图的计数，静默返回
    return
  }
  if (current === 1) {
    state.recursionDepth.delete(intentName)
  } else {
    state.recursionDepth.set(intentName, current - 1)
  }
}
