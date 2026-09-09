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
  // CRR P2/T-2.2: post-bindings 写入 publicStore 是“best-effort”。
  // - post-bindings 在 abort/error 路径下可能读不到源 register(未执行)
  // - 地址解析包一个软握把:from.kind='internal' 且 to.kind='public' 且 source missing → warn + skip
  // - 其他场景走原有严格语义(会抛 AddressError)
  if (
    entry.from.kind === 'internal' &&
    entry.to.kind === 'public' &&
    !state.internalStore.has(entry.from.name)
  ) {
    console.warn(
      `[CRR T-2.2] post-bindings move skipped: source register '${entry.from.name}' not found ` +
      `(target publicStore key '${entry.to.name}') — likely from error/abort path`
    )
    state.stack.pop()
    return
  }
  // C6: 输出卸载 move (物理输出槽 → 业务变量) 的 best-effort 处理。
  // - op 抛硬错误时未写出物理输出槽($S<scope>.out<k>)
  // - 编译器在 compileOp 生成的卸载 move 标记 bestEffort=true
  // - 源缺失时跳过(错误已由 bubbleError 写入 $err),业务变量保持原值
  if (
    entry.bestEffort &&
    entry.from.kind === 'internal' &&
    !state.internalStore.has(entry.from.name)
  ) {
    state.stack.pop()
    return
  }
  const value = await resolveAddress(entry.from, state)
  await writeAddress(entry.to, value, state)
  state.stack.pop()
}