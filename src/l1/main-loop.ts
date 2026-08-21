/**
 * L1 调度器主循环（5-case dispatch，双区架构版）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §三
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase A9
 *
 * 职责：
 * - 接收根意图 + ExecutionState
 * - 压入根意图 entry
 * - 循环 dispatch 栈顶 entry（5-case 严格穷尽）
 * - 栈空 → 执行完成
 *
 * 错误处理（A9 骨架版）：
 * - 硬错误直接向上传播（不 catch）
 * - A10 将接入 propagateHardError 做栈清理
 *
 * 与 CPU 类比：
 * - l1MainLoop = CPU 取指-译码-执行循环
 * - execute_intent = CALL（L3 编译子程序，压入 children）
 * - 栈空 = 程序结束（HLT）
 */

import type { RecognizedIntent, StackEntry } from './types.js'
import type { ExecutionState } from './execution-state.js'
import { assertNever } from './types.js'
import { generateId, now } from './id.js'
import { executeMove } from './primitives/move.js'
import { executeOp } from './primitives/execute-op.js'
import { executeIntent } from './primitives/execute-intent.js'
import { executeSkipN } from './primitives/skip-n.js'
import { executeConditionalSkip } from './primitives/conditional-skip.js'

/**
 * L1 主循环错误（防御：步数超限）
 */
export class L1MaxStepsError extends Error {
  constructor(steps: number) {
    super(`L1 main loop exceeded max steps (${steps})`)
    this.name = 'L1MaxStepsError'
  }
}

/**
 * L1 主循环运行选项
 */
export interface L1RunOptions {
  /**
   * 最大指令步数（防止意外无限循环）
   *
   * MVP 无反向跳转（skip_n 仅前向），理论上必然终止；
   * 此选项是防御性保护（如递归经验导致的深展开）。
   * 默认无限制。
   */
  maxSteps?: number
}

/**
 * 创建根意图 entry
 *
 * @param intent 根意图
 * @returns 压入栈的 IntentEntry（phase: pending）
 */
export function createRootIntentEntry(
  intent: RecognizedIntent
): StackEntry {
  return {
    id: generateId('intent'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'execute_intent',
    intent,
    phase: 'pending',
    children: []
  }
}

/**
 * L1 主循环：执行根意图直到栈空
 *
 * @param rootIntent 根意图（type + params）
 * @param state ExecutionState（必须已初始化）
 * @param options 运行选项（maxSteps 等）
 *
 * 流程：
 * 1. 压入根意图 entry
 * 2. 循环：peek 栈顶 → switch(kind) dispatch
 * 3. 栈空 → 完成
 *
 * 终止保证：
 * - MVP 无反向跳转，每次迭代要么 pop（move/op/intent/skip/cond-skip）
 *   要么 push 有限 children（intent）
 * - maxSteps 防御意外深展开
 */
export async function l1MainLoop(
  rootIntent: RecognizedIntent,
  state: ExecutionState,
  options?: L1RunOptions
): Promise<void> {
  // ============ Step 1: 压入根意图 ============
  state.stack.push(createRootIntentEntry(rootIntent))

  // ============ Step 2: 主循环 ============
  let steps = 0

  while (state.stack.length > 0) {
    // 防御：步数超限（避免意外无限循环）
    if (options?.maxSteps !== undefined && steps >= options.maxSteps) {
      throw new L1MaxStepsError(steps)
    }
    steps++

    // 取栈顶（下一个要执行的 entry）
    const top = state.stack[state.stack.length - 1]

    // ====== 5-case 严格穷尽 dispatch ======
    switch (top.kind) {
      case 'move':
        await executeMove(top, state)
        break

      case 'execute_op':
        await executeOp(top, state)
        break

      case 'execute_intent':
        await executeIntent(top, state)
        break

      case 'skip_n':
        await executeSkipN(top, state)
        break

      case 'conditional_skip':
        await executeConditionalSkip(top, state)
        break

      default:
        /* v8 ignore next 2 -- 防御代码：编译期穷尽检查，运行时不可达（TS 保证 5 种 kind 全部处理）*/
        // 编译期穷尽检查：新增 primitive kind 必须在此处理
        assertNever(top)
    }
  }
}