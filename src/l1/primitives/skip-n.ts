/**
 * skip_n primitive 执行函数
 *
 * @see ../../docs/mvp/06-execution-layer.md §3.4
 * @see ../../docs/mvp/10-reactive-execution-model.md §三.5
 *
 * 行为：
 * - 弹出 self + n 个后续 entry（总 n+1 个）
 * - 如果栈不足，则弹空为止（graceful）
 *
 * MVP 约束：仅支持前向跳转（n >= 0）
 *
 * 典型用法（DAG if-then-else）：
 * - conditional_skip 后，skip_n 用来"无条件跳过另一支"
 * - 编译示例：
 *     [op, conditional_skip(N), else_block, skip_n(M), then_block]
 *   执行：
 *     - 条件为真：conditional_skip 跳过 else_block + skip_n
 *     - 条件为假：执行 else_block，然后 skip_n(M) 跳过 then_block
 */

import type { SkipN } from '../types.js'
import type { ExecutionState } from '../execution-state.js'
import { isIntentEntry } from '../types.js'

/**
 * 错误：skip_n 参数非法
 */
export class SkipNError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkipNError'
  }
}

/**
 * 执行 skip_n primitive
 *
 * @param entry skip_n 条目
 * @param state 当前执行状态
 *
 * 行为：
 * 1. 校验 n >= 0（MVP 约束）
 * 2. 循环 (n+1) 次 pop（如果栈空则提前退出）
 * 3. **不跨帧**：遇到 IntentEntry 帧停止弹出（保护调用帧结构）
 *
 * 错误处理：
 * - n < 0：抛 SkipNError（MVP 范围外）
 * - 栈不足：不抛错（graceful，弹空为止）
 */
export async function executeSkipN(
  entry: SkipN,
  state: ExecutionState
): Promise<void> {
  if (entry.n < 0) {
    throw new SkipNError(
      `skip_n.n must be >= 0 (MVP: only forward jumps), got ${entry.n}`
    )
  }

  // 弹出 self + n 个 entry（总 n+1 个）
  // 如果栈不足，弹空为止（graceful）
  // 如果遇到 IntentEntry 帧，停止弹出（不跨帧，保护调用边界）
  const totalPops = entry.n + 1
  for (let i = 0; i < totalPops; i++) {
    if (state.stack.length === 0) break
    // 不跨帧：弹出前检查栈顶是否是帧
    if (isIntentEntry(state.stack[state.stack.length - 1])) break
    state.stack.pop()
  }
}