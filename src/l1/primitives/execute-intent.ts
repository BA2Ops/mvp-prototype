/**
 * execute_intent primitive 执行函数（双区架构版）
 *
 * @see ../../docs/mvp/06-execution-layer.md §3.3
 * @see ../../docs/mvp/10-reactive-execution-model.md §三.4
 * @see ../../docs/mvp/12-experience-model.md
 *
 * 完整设计：
 * - 从 IntentEntry 读取 RecognizedIntent
 * - 调 state.l3.compile(intent, state, options?) 获取 children
 * - 把 children 压入指令栈（**逆序**，先执行最右）
 * - IntentEntry 标记 awaiting_children → done
 * - L3 compile 抛错 → 向上传播（propagateHardError）
 *
 * 与 execute_op 的区别：
 * - execute_op: L1 → L2（调 operation.execute）
 * - execute_intent: L1 → L3（调 l3.compile）
 *
 * 与 CPU 类比：
 * - execute_intent = CALL（调用子程序）
 * - L3 = 子程序编译/链接器
 * - children 压栈 = 参数压栈（隐式）
 *
 * 嵌套支持：
 * - sub-intent 是 execute_intent entry（自引用或调用其他经验）
 * - L1 主循环递归调 execute_intent
 * - 栈深度限制由 L1 监控（详见 doc 06 §11）
 *
 * 生命周期：
 * - pending → awaiting_children → done（成功）
 * - pending → awaiting_children → aborted（失败）
 */

import type { IntentEntry, StackEntry } from '../types.js'
import type { ExecutionState } from '../execution-state.js'

/**
 * execute_intent 参数错误
 */
export class ExecuteIntentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecuteIntentError'
  }
}

/**
 * 执行 execute_intent primitive
 *
 * @param entry execute_intent 条目
 * @param state 当前执行状态
 *
 * 行为：
 * 1. 标记 IntentEntry 为 awaiting_children
 * 2. 调 state.l3.compile(entry.intent, state) 获取 children
 * 3. 把 children 压入指令栈（**逆序**）
 * 5. IntentEntry 标 done，pop
 *
 * 错误处理：
 * - L3 compile 抛错 → 向上传播（不 catch，让 propagateHardError 处理）
 * - IntentEntry.intent 不是 RecognizedIntent → ExecuteIntentError（理论上类型保证不会发生）
 * - children 为空 → 正常完成（IntentEntry 标 done，pop）
 */
export async function executeIntent(
  entry: IntentEntry,
  state: ExecutionState
): Promise<void> {
  // ============ Step 1: 标记 awaiting_children ============
  entry.phase = 'awaiting_children'

  // ============ Step 2: 调 L3 compile ============
  // 硬错误会在这里 throw，让外层 catch 处理
  const children = await state.l3.compile(entry.intent, state)

  // ============ Step 3: pop 自身 ============
  // 关键顺序：必须先 pop 自身（entry 在栈顶），再 push children
  // 若先 push children 再 pop，会把刚压入的 children 弹出（pop 移除栈顶）
  state.stack.pop()

  // ============ Step 4: 把 children 压入指令栈（逆序）============
  // 栈是 LIFO，要让 children[0] 先执行，需逆序压入
  // 例如 children = [A, B, C]，栈顺序应该是 [A, B, C]（底→顶）
  // 但 push() 添加到顶部，所以逆序迭代：
  //   push(C) → [C]
  //   push(B) → [B, C]
  //   push(A) → [A, B, C]
  // 这样 pop() 先取出 A，符合"先执行 children[0]"
  for (let i = children.length - 1; i >= 0; i--) {
    state.stack.push(children[i])
  }

  // ============ Step 5: 标记 done ============
  entry.phase = 'done'
}