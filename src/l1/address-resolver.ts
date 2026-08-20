/**
 * L1 Address 解析器（双区架构版）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §二
 * @see ../../docs/mvp/06-execution-layer.md §3
 *
 * 完整设计：
 * - 4 种 Address kind 的解析
 * - literal：仅作为源
 * - public：从 publicStore 读/写
 * - internal：从 internalStore 读/写
 * - file：从 fs 读/写
 *
 * 错误处理：
 * - 已知错误（缺失 variable、文件不存在）：抛 AddressError
 * - 调用方（A9 main loop 或 A10 propagateHardError）决定如何处理
 */

import * as fs from 'fs/promises'
import type { Address, Value } from './types.js'
import type { ExecutionState } from './execution-state.js'

/**
 * Address 解析错误
 *
 * 抛出场景：
 * - 读取不存在的 public variable
 * - 读取不存在的 internal register
 * - 读取不存在的 file
 * - 写入 literal（不允许）
 * - 文件系统 IO 错误
 */
export class AddressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AddressError'
  }
}

/**
 * 解析 Address 到 Value
 *
 * @param addr Address（4 种 kind）
 * @param state ExecutionState
 * @returns Value
 *
 * @throws AddressError
 */
export async function resolveAddress(
  addr: Address,
  state: ExecutionState
): Promise<Value> {
  switch (addr.kind) {
    case 'literal':
      return addr.value

    case 'public':
      if (!state.publicStore.has(addr.name)) {
        throw new AddressError(`Public variable not found: ${addr.name}`)
      }
      return state.publicStore.get(addr.name)!

    case 'internal':
      if (!state.internalStore.has(addr.name)) {
        throw new AddressError(`Internal register not found: ${addr.name}`)
      }
      return state.internalStore.get(addr.name)!

    case 'file':
      try {
        return await fs.readFile(addr.path, 'utf-8')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new AddressError(
          `Failed to read file '${addr.path}': ${message}`
        )
      }
  }
}

/**
 * 写入 Value 到 Address
 *
 * @param addr Address
 * @param value 要写入的 Value
 * @param state ExecutionState
 *
 * @throws AddressError（写入 literal 不允许）
 */
export async function writeAddress(
  addr: Address,
  value: Value,
  state: ExecutionState
): Promise<void> {
  switch (addr.kind) {
    case 'literal':
      throw new AddressError(
        'Cannot write to literal address (literal is read-only)'
      )

    case 'public':
      state.publicStore.set(addr.name, value)
      break

    case 'internal':
      state.internalStore.set(addr.name, value)
      break

    case 'file':
      try {
        await fs.writeFile(addr.path, String(value))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new AddressError(
          `Failed to write file '${addr.path}': ${message}`
        )
      }
      break
  }
}