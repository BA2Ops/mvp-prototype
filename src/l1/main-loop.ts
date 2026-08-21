/**
 * L1 调度器主循环（5-case dispatch + 异常冒泡，双区架构版）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §三
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase A9/A10
 *
 * 职责：
 * - 接收根意图 + ExecutionState
 * - 压入根意图 entry（帧）
 * - 循环 dispatch 栈顶 entry（5-case 严格穷尽）
 * - 栈空 → 执行完成
 *
 * 异常冒泡（2026-08-20 修订，错误处置权在 L3）：
 * - 任何 primitive 抛出的异常由主循环 catch
 * - 异常信息写入 $r_err（errorToOperationError）
 * - 从栈顶向上弹出 entries，直到遇到 handleError=true 的 IntentEntry 帧
 *   - 遇到 → 截获：pop 该帧，继续执行其后指令（后续指令读 $r_err 判断）
 *   - 无 → 递归冒泡到栈空 → 抛给 mainLoop 调用者
 * - 弹出过程中，被穿过的 IntentEntry 帧标记 phase='aborted'
 *
 * 与 CPU 类比：
 * - l1MainLoop = CPU 取指-译码-执行循环
 * - execute_intent = CALL（帧保留）
 * - handleError 帧 = 异常处理器（try 块）
 * - 异常冒泡 = 异常展开（unwinding）
 */

import type { RecognizedIntent, StackEntry, IntentEntry, Value } from './types.js'
import type { ExecutionState } from './execution-state.js'
import { assertNever, isIntentEntry } from './types.js'
import { generateId, now } from './id.js'
import { ERROR_REGISTER, errorToOperationError } from '../l2/errors.js'
import { DEFAULT_MAX_RECURSION_DEPTH, enterIntent, exitIntent, RecursionDepthError } from './recursion.js'
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
 * 无异常处理器时冒泡到顶层的错误
 */
export class UnhandledError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message)
    this.name = 'UnhandledError'
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

  /**
   * 最大递归深度（循环意图安全网，A11）
   *
   * 默认 DEFAULT_MAX_RECURSION_DEPTH（1000）。
   * 超限抛 RecursionDepthError（L1 系统防御，不走业务冒泡）。
   */
  maxRecursionDepth?: number
}

/**
 * 创建根意图 entry（帧）
 *
 * @param intent 根意图
 * @param handleError 根层是否截获异常（默认 false：异常冒泡给调用者）
 * @returns 压入栈的 IntentEntry（phase: pending）
 */
export function createRootIntentEntry(
  intent: RecognizedIntent,
  handleError: boolean = false
): StackEntry {
  return {
    id: generateId('intent'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'execute_intent',
    intent,
    phase: 'pending',
    children: [],
    handleError
  }
}

/**
 * 处理 execute_intent 条目（双 phase 状态机）
 *
 * @param top 栈顶 IntentEntry
 * @param state 执行状态
 *
 * pending：首次遇到 → compile + push children（帧保留）
 * awaiting_children：children 全部执行完（栈顶回到帧）→ done + pop
 */
async function processIntentEntry(
  top: IntentEntry,
  state: ExecutionState,
  maxRecursionDepth: number
): Promise<void> {
  if (top.phase === 'pending') {
    // A11：激活帧前先登记递归深度（超限抛 RecursionDepthError，此时 phase 仍 pending，
    // 冒泡时不会误判为已 enter 的帧——见 abortFrame）
    enterIntent(top.intent.type, state, maxRecursionDepth)
    await executeIntent(top, state)
    return
  }

  if (top.phase === 'awaiting_children') {
    // children 已全部执行完（栈顶回到帧）
    // 注：异常冒泡会直接把帧 pop 并标记 aborted（且 exitIntent），因此到达这里的
    // awaiting_children 帧必然正常完成了 children
    exitIntent(top.intent.type, state)
    top.phase = 'done'
    state.stack.pop()
    return
  }

  // aborted：不应在主循环中再次遇到（冒泡时已被 pop）
  /* v8 ignore next 3 -- 防御代码：aborted 帧在冒泡时已被弹出，运行时不可达 */
  throw new Error(`execute_intent frame in unexpected phase: ${top.phase}`)
}

/**
 * 释放帧（abort）：exitIntent + 标记 aborted
 *
 * 冒泡弹出帧时的统一收尾：
 * - phase 'pending'：未 enter（processIntentEntry 未处理过），只标记 aborted
 * - phase 'awaiting_children'：已 enter（compile 过），需 exitIntent 平衡计数
 * - phase 'aborted'：防御（不应重复释放）
 */
function abortFrame(entry: StackEntry, state: ExecutionState): void {
  if (isIntentEntry(entry)) {
    if (entry.phase === 'awaiting_children') {
      exitIntent(entry.intent.type, state)
    } else {
      /* v8 ignore next 2 -- 防御代码：aborted 帧只被释放一次；pending 帧未 enter 无需 exit */
      // pending：未 enter；aborted：已释放——均无需 exitIntent
    }
    entry.phase = 'aborted'
  }
}

/**
 * 异常冒泡（错误处置权在 L3）
 *
 * 语义（用户 2026-08-20 确认）：
 * - 异常点 entry（栈顶）首先弹出
 * - 从栈顶向下找**最近的 handleError 帧**（handler）
 * - 无 handler → 全部弹出（标记 aborted）→ 返回 false（调用者处理）
 * - 有 handler → 保留 handler 帧及其调用链（栈底方向），
 *   以及 handler 的剩余 children（catch 逻辑，位于 handler 之上的非帧 entries）；
 *   弹出 handler 之上的无标志帧链（异常子树）
 *
 * 栈结构约定：
 *   帧的 children 压栈时紧贴帧之上；执行顺序 = 从栈顶向栈底
 *   [.., handlerFrame, handlerChildren..., childFrame(无标志), childChildren..., op(异常点)]
 *
 * @param err 原始异常
 * @param state 执行状态
 * @returns true = 异常被某层截获（主循环继续）；false = 无处理器（调用者处理）
 */
export async function bubbleError(
  err: unknown,
  state: ExecutionState
): Promise<boolean> {
  // ============ Step 1: 异常信息写入 $r_err ============
  // 后续指令（catch 逻辑）通过 $r_err 内容判断处理路径
  // 注：OperationError 是合法业务数据（满足 Value 语义），但 TS interface
  //     无 index signature，赋给 Value 需要断言
  state.internalStore.set(
    ERROR_REGISTER,
    errorToOperationError(err) as unknown as Value
  )

  // ============ Step 2: 弹出异常点 entry ============
  // 主循环 catch 时栈顶即抛错者（primitive 抛错时未 pop）
  // 异常点可能是帧（如 L3 compile 抛错）→ 需释放（exitIntent + aborted）
  if (state.stack.length > 0) {
    const popped = state.stack.pop()
    if (popped) abortFrame(popped, state)
  }

  // ============ Step 3: 从栈顶向下找最近的 handleError 帧 ============
  let handlerIndex = -1
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const e = state.stack[i]
    if (isIntentEntry(e) && e.handleError) {
      handlerIndex = i
      break
    }
  }

  // ============ Step 4: 无 handler → 全部弹出，返回 false ============
  if (handlerIndex === -1) {
    for (const e of state.stack) {
      abortFrame(e, state)
    }
    state.stack.length = 0
    return false
  }

  // ============ Step 5: 有 handler → 保留 handler 调用链 + handler 剩余 children ============
  // 保留：[0..handlerIndex]（handler 及其调用链）
  const keepIds = new Set<string>()
  for (let i = 0; i <= handlerIndex; i++) {
    keepIds.add(state.stack[i].id)
  }

  // handler 之上（栈顶方向）：mode 切换
  // keep  = handler 的剩余 children（catch 逻辑，保留）
  // drop  = 无标志帧及其 children（异常子树，弹出）
  let mode: 'keep' | 'drop' = 'keep'
  for (let i = handlerIndex + 1; i < state.stack.length; i++) {
    const e = state.stack[i]
    if (isIntentEntry(e)) {
      if (!e.handleError) {
        // 无标志帧：弹出（其 children 也 drop）→ 释放（exitIntent + aborted）
        abortFrame(e, state)
        mode = 'drop'
      }
      // 防御：handler 之上不应再出现 handler（最近的 handler 已找到）
      /* v8 ignore next 3 -- 防御代码：栈顶向下第一个 handler 之后的 handler 帧不可能出现 */
      else {
        mode = 'keep'
      }
    } else if (mode === 'keep') {
      // handler 的剩余 children：保留（catch 逻辑）
      keepIds.add(e.id)
    }
    // drop 模式下的非帧 entry：不加入 keepIds（弹出）
  }

  // ============ Step 6: 重建栈 ============
  state.stack = state.stack.filter(e => keepIds.has(e.id))
  return true
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
 * 3. 任何异常 → bubbleError（冒泡/截获）
 * 4. 栈空 → 完成
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
    // 注：此检查在 try 之外——L1MaxStepsError 是系统错误，
    //     不应被业务冒泡（handleError）截获，直接抛给调用者
    if (options?.maxSteps !== undefined && steps >= options.maxSteps) {
      throw new L1MaxStepsError(steps)
    }
    steps++

    // 取栈顶（下一个要执行的 entry）
    const top = state.stack[state.stack.length - 1]

    try {
      // ====== 5-case 严格穷尽 dispatch ======
      switch (top.kind) {
        case 'move':
          await executeMove(top, state)
          break

        case 'execute_op':
          await executeOp(top, state)
          break

        case 'execute_intent':
          await processIntentEntry(top, state, options?.maxRecursionDepth ?? DEFAULT_MAX_RECURSION_DEPTH)
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
    } catch (err) {
      // ====== L1 系统防御错误：不走业务冒泡 ======
      // RecursionDepthError 与 L1MaxStepsError 同类：若被 handleError 截获，
      // 递归经验可无限重试 → 防御机制失效。直接抛给调用者。
      if (err instanceof RecursionDepthError) {
        throw err
      }
      // ====== 异常冒泡：处置权在 L3（handleError 标志）======
      const handled = await bubbleError(err, state)
      if (!handled) {
        // 无任何层截获 → 抛给 mainLoop 调用者
        throw new UnhandledError(
          `Unhandled error in L1 main loop: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
      }
      // 截获：$r_err 已写入异常信息，继续主循环（后续指令判断）
    }
  }
}