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
 *
 * 错误码保留（2026-08-20 设计反馈）：
 * - AddressError 现在保留原始 err.code（如 'ENOENT', 'EACCES'）
 * - DAG 条件分支可通过 $error.code 决策（如 file_read 不存在 vs 权限拒绝）
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
 *
 * code 字段语义：
 * - 'LITERAL_WRITE'：尝试写入 literal（编程错误）
 * - 'VARIABLE_NOT_FOUND'：public/internal 不存在
 * - 'FILE_NOT_FOUND'：文件不存在（ENOENT）
 * - 'FILE_PERMISSION_DENIED'：权限拒绝（EACCES）
 * - 'FILE_IO_ERROR'：其他文件系统错误
 * - 原始 fs 错误码（如 'ENOENT'）会透传
 * - undefined：编程错误或不可分类
 */
export class AddressError extends Error {
  /** 错误分类（用于 DAG 条件分支决策） */
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'AddressError'
    this.code = code
  }
}

/**
 * 从任意 thrown 值提取 (message, code)
 *
 * 处理 3 种情况：
 * 1. Error 子类：取 .message 和 .code（如果有）—— True 分支已覆盖
 * 2. 非 Error 对象：String() 转换，code 设为 'NON_ERROR_THROW' —— False 分支防御性未覆盖
 *
 * @see docs/dev-log/2026-08-20-coverage-reflection.md 理解为什么 false 分支故意不测试
 */
function extractErrorInfo(err: unknown): { message: string; code: string | undefined } {
  // True 分支：Node.js fs/promises 总是 throw Error 子类（ENOENT, EACCES 等）
  //
  // 下面 if 块是防御性非 Error 抛出分支：
  // 仅当有人 mock fs/promises 并 throw 非 Error（违反 fs 契约），或 Promise 被外部篡改时才会执行。
  // 生产环境不会发生，写测试需用 vi.doMock 违反 fs 契约，
  // 属于"为了覆盖率而存在"的测试，不是为了验证代码正确性。
  // 保留此分支作为防御性兑底，详见 docs/dev-log/2026-08-20-coverage-reflection.md
  /* v8 ignore start */
  if (!(err instanceof Error)) {
    return { message: String(err), code: 'NON_ERROR_THROW' }
  }
  /* v8 ignore stop */

  const hasCode = 'code' in err && typeof (err as { code?: unknown }).code === 'string'

  /* v8 ignore next 1 -- Error 但无 string code 的极少见情况（防御） */
  const code = hasCode ? (err as { code: string }).code : undefined
  return { message: err.message, code }
}

/**
 * 解析 Address 到 Value
 *
 * @param addr Address（4 种 kind）
 * @param state ExecutionState
 * @returns Value
 *
 * @throws AddressError（包含原始错误码如果有）
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
        throw new AddressError(
          `Public variable not found: ${addr.name}`,
          'VARIABLE_NOT_FOUND'
        )
      }
      return state.publicStore.get(addr.name)!

    case 'internal':
      if (!state.internalStore.has(addr.name)) {
        throw new AddressError(
          `Internal register not found: ${addr.name}`,
          'VARIABLE_NOT_FOUND'
        )
      }
      return state.internalStore.get(addr.name)!

    case 'file':
      try {
        return await fs.readFile(addr.path, 'utf-8')
      } catch (err) {
        const { message, code } = extractErrorInfo(err)
        throw new AddressError(
          `Failed to read file '${addr.path}': ${message}`,
          code
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
 * @throws AddressError（包含原始错误码如果有）
 */
export async function writeAddress(
  addr: Address,
  value: Value,
  state: ExecutionState
): Promise<void> {
  switch (addr.kind) {
    case 'literal':
      throw new AddressError(
        'Cannot write to literal address (literal is read-only)',
        'LITERAL_WRITE'
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
        const { message, code } = extractErrorInfo(err)
        throw new AddressError(
          `Failed to write file '${addr.path}': ${message}`,
          code
        )
      }
      break
  }
}