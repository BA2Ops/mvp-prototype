/**
 * Phase A Tier A3c - AddressError code 字段验证
 *
 * 验证设计意图：
 * - AddressError.code 保留原始错误信息（ENOENT, EACCES 等）
 * - DAG 条件分支可通过 $error.code 决策
 * - 不破坏现有行为
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  resolveAddress,
  writeAddress,
  AddressError
} from '../../src/l1/address-resolver.js'
import {
  createInitialState,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { createMockL2 } from '../../src/mocks/mock-l2.js'
import { createMockL3 } from '../../src/mocks/mock-l3.js'

describe('A3c: AddressError code 字段（file kind 相关用例已移除，其余编程错误/语义错误码验证保留）', () => {
  let state: ExecutionState

  beforeEach(() => {
    const { registry: l2 } = createMockL2()
    const l3 = createMockL3([])
    state = createInitialState(l2, l3)
  })

  // ============== 编程错误 ==============
  describe('编程错误', () => {
    test('写入 literal: code = LITERAL_WRITE', async () => {
      try {
        await writeAddress(
          { kind: 'literal', value: 'x' },
          'value',
          state
        )
        expect.fail('应该抛错')
      } catch (err) {
        expect(err).toBeInstanceOf(AddressError)
        expect((err as AddressError).code).toBe('LITERAL_WRITE')
      }
    })
  })

  // ============== 语义错误 ==============
  describe('语义错误', () => {
    test('public 不存在: code = VARIABLE_NOT_FOUND', async () => {
      try {
        await resolveAddress({ kind: 'public', name: 'missing' }, state)
        expect.fail('应该抛错')
      } catch (err) {
        expect(err).toBeInstanceOf(AddressError)
        expect((err as AddressError).code).toBe('VARIABLE_NOT_FOUND')
      }
    })

    test('internal 不存在: code = VARIABLE_NOT_FOUND', async () => {
      try {
        await resolveAddress({ kind: 'internal', name: '$r99' }, state)
        expect.fail('应该抛错')
      } catch (err) {
        expect(err).toBeInstanceOf(AddressError)
        expect((err as AddressError).code).toBe('VARIABLE_NOT_FOUND')
      }
    })
  })


  // ============== AddressError 实例属性 ==============
  describe('AddressError 实例', () => {
    test('code 是 readonly', () => {
      const err = new AddressError('test', 'TEST_CODE')
      expect(err.code).toBe('TEST_CODE')
      expect(err.message).toBe('test')
      expect(err.name).toBe('AddressError')
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(AddressError)
    })

    test('code 可选（不传则为 undefined）', () => {
      const err = new AddressError('test')
      expect(err.code).toBeUndefined()
    })
  })
})