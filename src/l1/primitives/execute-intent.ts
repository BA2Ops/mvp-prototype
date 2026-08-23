/**
 * execute_intent primitive 执行函数（帧保留版）
 *
 * @see ../../docs/mvp/06-execution-layer.md §3.3
 * @see ../../docs/mvp/10-reactive-execution-model.md §三.4
 * @see ../../docs/mvp/12-experience-model.md
 *
 * 2026-08-20 修订：帧保留语义（错误处置权在 L3）
 *
 * 完整设计：
 * - **IntentEntry 保留在指令栈中作为调用帧**（不一次性 pop）
 * - pending：调 state.l3.compile(intent, state) 获取 children，压入帧之上
 * - children 执行完后，栈顶回到 IntentEntry（awaiting_children）→ 主循环标记 done + pop
 * - 帧是异常冒泡的边界：handleError 标志决定异常在此截获还是继续向上
 *
 * 与 execute_op 的区别：
 * - execute_op: L1 → L2（调 operation.execute，一次完成）
 * - execute_intent: L1 → L3（调 l3.compile，展开为子序列）
 *
 * 与 CPU 类比：
 * - execute_intent = CALL（压入返回地址帧）
 * - children = 子程序体
 * - 帧保留 = 调用栈帧（异常展开沿帧向上）
 * - handleError = 该帧注册了异常处理器（try 块）
 *
 * 生命周期：
 * - pending → awaiting_children → done（正常完成）
 * - pending → awaiting_children → aborted（异常冒泡截获/穿过）
 */

import type { IntentEntry } from '../types.js'
import type { ExecutionState } from '../execution-state.js'
import type { CompileOptions } from '../../l3/experience.js'
import { isCrrNewPathEnabled } from '../main-loop.js'

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
 * CRR T-1.5/T-1.6: 为当前 frame 计算 CompileOptions
 *
 * 主循环 T-1.5 入口已根据 crrNewPathEnabled() 决定是否 enterScope,
 * executeIntent 需传递相应 CompileOptions 给 L3 compile —— 否则 compile 看不到 useFixedSlotConvention,
 * 会产生 legacy 产物 ($r_argtmp_N 等),与 frame.scopeId 不一致,导致 U_max 口径崩溃。
 *
 * 判定逻辑:
 *   - frame.scopeId !== undefined → 启用 new path
 *   - 否则 legacy (默认 false 路径)
 *
 * P2+ 接入: options 走 service 传递 / frame metadata (避免全局开关)
 */
function getCompileOptionsForFrame(_entry: IntentEntry): CompileOptions | undefined {
  if (isCrrNewPathEnabled()) {
    return { useFixedSlotConvention: true }
  }
  return undefined
}

/**
 * 执行 execute_intent primitive（pending 阶段）
 *
 * @param entry execute_intent 条目（phase 必须为 pending）
 * @param state 当前执行状态
 *
 * 行为：
 * 1. 标记 awaiting_children
 * 2. 调 state.l3.compile(entry.intent, state) 获取 children
 * 3. 把 children 压入指令栈（**逆序**，children[0] 先执行）
 * 4. **不 pop 自身**——帧保留，等待 children 完成后由主循环收尾
 *
 * 错误处理（2026-08-20 修订）：
 * - L3 compile 抛错 → 向上传播（由主循环 catch → 异常冒泡机制处理）
 * - 本层是否截获异常由 entry.handleError 决定（主循环冒泡时判断）
 *
 * 注意：children 压入后，栈中顺序为 [entry(帧), ...children]（entry 在底）。
 * 所有 children 执行完毕后栈顶回到 entry，主循环检测 phase==='awaiting_children'
 * 且 children 已全部弹出 → 标记 done + pop。
 */
export async function executeIntent(
  entry: IntentEntry,
  state: ExecutionState
): Promise<void> {
  // ============ Step 1: 标记 awaiting_children ============
  entry.phase = 'awaiting_children'

  // ============ Step 2: 调 L3 compile ============
  // 异常会在这里 throw，由主循环 catch（冒泡机制）处理
  const children = await state.l3.compile(entry.intent, state, getCompileOptionsForFrame(entry))
  entry.children = children

  // ============ Step 3: 把 children 压入指令栈（逆序）============
  // 栈是 LIFO，要让 children[0] 先执行，需逆序压入
  // children = [A, B, C] → push(C) → push(B) → push(A)
  // 栈（底→顶）: [entry, C, B, A] → pop 顺序 A → B → C ✓
  for (let i = children.length - 1; i >= 0; i--) {
    state.stack.push(children[i])
  }
  // 注意：不 pop 自身（帧保留）
}