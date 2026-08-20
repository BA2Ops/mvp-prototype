/**
 * L3 Service 接口（生产代码）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §四
 * @see ../../docs/mvp/07-intent-library.md
 *
 * A2 阶段定义最小版本（只包含 compile 方法）。
 * 完整接口（含 register intent 等）将在 Phase C 实现。
 */

import type { RecognizedIntent, StackEntry } from '../l1/types.js'

/**
 * L3 Service 接口
 *
 * 职责：
 * - compile(intent) → 返回该意图展开后的 StackEntry[]
 * - L1 在执行 execute_intent 时调此方法
 *
 * 设计原则：
 * - L3 是被调 service，不是编译阶段
 * - 每次 compile 返回新 entries（带新 ID）
 * - 不持有执行状态（每次调用独立）
 */
export interface L3Service {
  /**
   * 编译意图为子 entries
   *
   * @param intent 已识别意图或标准意图
   * @returns 子指令栈条目数组
   */
  compile(intent: RecognizedIntent): Promise<StackEntry[]>
}