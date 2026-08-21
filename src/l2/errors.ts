/**
 * L2 标准错误结构
 *
 * @see ../../docs/mvp/06-execution-layer.md §3
 * @see ../../docs/mvp/10-reactive-execution-model.md §三.硬错误
 *
 * 所有 L2 operation 的 error 输出必须遵守此结构（如果该 op 有 error 输出）。
 *
 * 设计原则：
 * - 标准化：所有 op 使用相同结构，便于上层处理
 * - 自描述：包含 op 名、时间戳，便于调试
 * - 轻量：不强制 details（可选）
 */

import type { Value } from '../l1/types.js'

/**
 * 标准 OperationError 结构
 *
 * 写入 $r_err 寄存器的值（如果 op 有 error 输出）。
 *
 * 成功时：error = null
 * 失败时：error = OperationError
 */
export interface OperationError {
  /** 错误代码（如 'ENOENT', 'EACCES', 'PARSE_FAILED'）*/
  code: string

  /** 人类可读的错误消息 */
  message: string

  /** 产生此错误的 operation 名称 */
  op: string

  /** 错误产生时间戳（毫秒）*/
  timestamp: number

  /** 可选的额外上下文（必须是 Value，保证可写入 internalStore）*/
  details?: Value
}

/**
 * 创建标准 OperationError
 *
 * @param code 错误代码
 * @param message 错误消息
 * @param op operation 名称
 * @param details 可选额外上下文（必须是 Value）
 */
export function createOperationError(
  code: string,
  message: string,
  op: string,
  details?: Value
): OperationError {
  return {
    code,
    message,
    op,
    timestamp: Date.now(),
    details
  }
}

/**
 * 检查是否为标准 OperationError
 */
export function isOperationError(value: unknown): value is OperationError {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.code === 'string' &&
    typeof obj.message === 'string' &&
    typeof obj.op === 'string' &&
    typeof obj.timestamp === 'number'
  )
}

/**
 * 常见错误代码常量
 *
 * L2 ops 应该使用这些常量（而不是自己编造字符串）。
 */
export const ErrorCodes = {
  // 文件系统错误
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_PERMISSION_DENIED: 'FILE_PERMISSION_DENIED',
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',

  // 通用错误
  INVALID_INPUT: 'INVALID_INPUT',
  EXEC_FAILED: 'EXEC_FAILED',
  TIMEOUT: 'TIMEOUT'
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes] | string

/**
 * 特殊保留寄存器名：全局错误寄存器
 *
 * 所有 op 的 error 输出都写到 $r_err（如果该 op 有 error 输出）。
 * $r_err 是全局共享的，最后一个 op 写入的 error 会覆盖之前的。
 */
export const ERROR_REGISTER = '$r_err'

/**
 * 把任意异常转换为标准 OperationError
 *
 * 用于 L1 异常冒泡截获时写入 $r_err（异常消息寄存器）。
 *
 * 设计原则（2026-08-20 修订）：
 * - 解释执行下，错误处置权在 L3（通过 handleError 标志）
 * - 异常冒泡截获时，L1 把异常转为 OperationError 写入 $r_err
 * - 后续指令（catch 逻辑）通过 $r_err 内容判断处理路径
 * - 保留原始错误码（如 ENOENT）：Error 对象上的 code 字段优先
 *
 * @param err 任意异常
 * @param op 产生异常的操作名（默认 'l1'）
 * @returns 标准 OperationError
 */
export function errorToOperationError(
  err: unknown,
  op: string = 'l1'
): OperationError {
  if (isOperationError(err)) {
    // 已经是 OperationError（如 L2 op 主动返回的结构化错误）
    return err
  }

  const e = err instanceof Error ? err : new Error(String(err))
  const rawCode = (e as { code?: unknown }).code

  return {
    // 保留原始错误码（ENOENT/EACCES 等），无则用通用码
    code: typeof rawCode === 'string' && rawCode.length > 0 ? rawCode : 'EXCEPTION',
    message: e.message,
    op,
    timestamp: Date.now()
  }
}