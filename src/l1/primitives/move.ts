/**
 * move primitive 执行函数（双区架构版）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §三
 * @see ../../docs/mvp/06-execution-layer.md §3
 *
 * 完整设计：
 * - move 是唯一的数据搬运桥梁
 * - from 可以是 literal/public/internal/file
 * - to 不能是 literal（AddressError）
 * - 失败时不弹栈（保留 entry 供错误处理）
 */

import type { MoveEntry } from '../types.js'
import type { ExecutionState } from '../execution-state.js'
import { resolveAddress, writeAddress } from '../address-resolver.js'

/**
 * 执行 move primitive
 *
 * @param entry move 条目
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
 *   - 包括"写入 literal"（设计约束）
 */
export async function executeMove(
  entry: MoveEntry,
  state: ExecutionState
): Promise<void> {
  const value = await resolveAddress(entry.from, state)
  await writeAddress(entry.to, value, state)
  state.stack.pop()
}