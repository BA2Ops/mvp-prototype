/**
 * move primitive 执行函数
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §三
 * @see ../../docs/mvp/06-execution-layer.md §3
 * @see ../../docs/mvp/09-l1-implementation.md §5
 *
 * 职责：
 * - 从 entry.from 读取值
 * - 写入 entry.to
 * - 成功后弹出栈顶
 *
 * CPU 类比：MOV / LOAD / STORE
 */

import type { MoveEntry } from '../types.js'
import type { ExecutionState } from '../execution-state.js'
import { resolveAddress, writeAddress } from '../address-resolver.js'

/**
 * 执行 move primitive
 *
 * @param entry move 条目（含 from / to Address）
 * @param state 当前执行状态
 *
 * 行为：
 * 1. resolveAddress(entry.from, state) → value
 * 2. writeAddress(entry.to, value, state)
 * 3. state.stack.pop()（仅在成功时）
 *
 * 错误处理：
 * - resolveAddress 抛 AddressError → 不弹栈，向上抛
 * - writeAddress 抛 AddressError → 不弹栈，向上抛
 * - 调用方（A9 main loop 或 A10 错误传播）决定如何处理
 *
 * 设计原则：
 * - move 是纯数据搬运，不调任何 L2/L3
 * - 错误时不弹栈：保留 entry 供错误处理 / 调试
 * - 不修改 entry 本身（id、parentIntentId 等保持不变）
 */
export async function executeMove(
  entry: MoveEntry,
  state: ExecutionState
): Promise<void> {
  const value = await resolveAddress(entry.from, state)
  await writeAddress(entry.to, value, state)
  state.stack.pop()
}