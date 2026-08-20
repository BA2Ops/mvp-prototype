/**
 * Phase A Tier A1c - 标准 OperationError 结构测试
 *
 * 验证：
 * 1. OperationError 字段必填
 * 2. createOperationError 创建标准错误
 * 3. isOperationError 类型守卫
 * 4. ERROR_REGISTER 常量
 * 5. ErrorCodes 常量
 */

import { describe, test, expect } from 'vitest'
import {
  createOperationError,
  isOperationError,
  ERROR_REGISTER,
  ErrorCodes
} from '../../src/l2/errors.js'

describe('A1c: 标准 OperationError 结构', () => {
  // ============== OperationError 字段必填 ==============
  describe('OperationError 字段', () => {
    test('包含 4 个必填字段', () => {
      const err = createOperationError('ENOENT', 'file not found', 'file_read')

      expect(err.code).toBe('ENOENT')
      expect(err.message).toBe('file not found')
      expect(err.op).toBe('file_read')
      expect(err.timestamp).toBeGreaterThan(0)
    })

    test('details 字段可选', () => {
      const err = createOperationError(
        'PARSE_FAILED',
        'invalid JSON',
        'json_parse',
        { line: 5 }
      )

      expect(err.details).toEqual({ line: 5 })
    })

    test('timestamp 是 number 类型', () => {
      const err = createOperationError('CODE', 'msg', 'op')
      expect(typeof err.timestamp).toBe('number')
    })

    test('createOperationError 自动设置 timestamp', () => {
      const before = Date.now()
      const err = createOperationError('CODE', 'msg', 'op')
      const after = Date.now()

      expect(err.timestamp).toBeGreaterThanOrEqual(before)
      expect(err.timestamp).toBeLessThanOrEqual(after)
    })
  })

  // ============== isOperationError 类型守卫 ==============
  describe('isOperationError 类型守卫', () => {
    test('合法 OperationError 返回 true', () => {
      const err = createOperationError('CODE', 'msg', 'op')
      expect(isOperationError(err)).toBe(true)
    })

    test('null 返回 false', () => {
      expect(isOperationError(null)).toBe(false)
    })

    test('undefined 返回 false', () => {
      expect(isOperationError(undefined)).toBe(false)
    })

    test('string 返回 false', () => {
      expect(isOperationError('error')).toBe(false)
    })

    test('缺失字段的对象返回 false', () => {
      expect(isOperationError({ code: 'X' })).toBe(false)
      expect(isOperationError({ code: 'X', message: 'm' })).toBe(false)
      expect(isOperationError({ code: 'X', message: 'm', op: 'o' })).toBe(false)
    })

    test('错误类型字段返回 false', () => {
      const wrong = {
        code: 123, // should be string
        message: 'm',
        op: 'o',
        timestamp: 0
      }
      expect(isOperationError(wrong)).toBe(false)
    })
  })

  // ============== ERROR_REGISTER 常量 ==============
  describe('ERROR_REGISTER 常量', () => {
    test('值是 $r_err', () => {
      expect(ERROR_REGISTER).toBe('$r_err')
    })
  })

  // ============== ErrorCodes 常量 ==============
  describe('ErrorCodes 常量', () => {
    test('包含常见错误代码', () => {
      expect(ErrorCodes.FILE_NOT_FOUND).toBe('FILE_NOT_FOUND')
      expect(ErrorCodes.FILE_PERMISSION_DENIED).toBe('FILE_PERMISSION_DENIED')
      expect(ErrorCodes.EXEC_FAILED).toBe('EXEC_FAILED')
    })

    test('所有值都是字符串', () => {
      for (const code of Object.values(ErrorCodes)) {
        expect(typeof code).toBe('string')
      }
    })
  })
})