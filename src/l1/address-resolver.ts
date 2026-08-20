/**
 * L1 Address 解析器
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §二
 * @see ../../docs/mvp/06-execution-layer.md §3
 *
 * 职责：
 * - resolveAddress(addr, state): 根据 Address 读取 Value
 * - writeAddress(addr, value, state): 根据 Address 写入 Value
 *
 * 三种 Address kind：
 * - literal: 直接返回值/拒绝写入
 * - variable: 从/到 resultStore 读写
 * - file: 从/到文件系统读写
 */

import * as fs from 'fs/promises'
import type { Address, Value } from './types.js'
import type { ExecutionState } from './execution-state.js'

/**
 * Address 解析错误
 *
 * 抛出场景：
 * - 读取不存在的 variable
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
 * 根据 Address.kind 分发：
 * - literal: 直接返回其值
 * - variable: 从 resultStore 读取
 * - file: 从文件系统读取（utf-8）
 *
 * @throws AddressError 当 variable 不存在或文件读取失败
 */
export async function resolveAddress(
  addr: Address,
  state: ExecutionState
): Promise<Value> {
  switch (addr.kind) {
    case 'literal':
      return addr.value

    case 'variable':
      if (!state.resultStore.has(addr.name)) {
        throw new AddressError(`Variable not found: ${addr.name}`)
      }
      return state.resultStore.get(addr.name)!

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
 * 根据 Address.kind 分发：
 * - literal: 抛错（不能写入常量）
 * - variable: 写入 resultStore
 * - file: 写入文件系统（非字符串值通过 String() 转换）
 *
 * @throws AddressError 当写入 literal 或文件写入失败
 */
export async function writeAddress(
  addr: Address,
  value: Value,
  state: ExecutionState
): Promise<void> {
  switch (addr.kind) {
    case 'literal':
      throw new AddressError('Cannot write to literal address')

    case 'variable':
      state.resultStore.set(addr.name, value)
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