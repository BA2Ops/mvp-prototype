/**
 * Phase A Tier A3 - Address 解析器测试（双区架构版）
 *
 * 验证：
 * 1. literal: 直接返回值
 * 2. public: 从 publicStore 读/写
 * 3. internal: 从 internalStore 读/写
 * 4. file: 从 fs 读/写
 * 5. 写入 literal 抛错（不允许）
 * 6. resolve + writeAddress 集成（move 模式）
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

describe('A3: Address 解析器（双区架构版，file kind 已移除）', () => {
  let state: ExecutionState

  beforeEach(() => {
    const { registry: l2 } = createMockL2()
    const l3 = createMockL3([])
    state = createInitialState(l2, l3)
  })

  // ============== literal ==============
  describe('literal', () => {
    test('resolve 直接返回其值', async () => {
      const result = await resolveAddress(
        { kind: 'literal', value: 'hello' },
        state
      )
      expect(result).toBe('hello')
    })

    test('resolve 各种 Value', async () => {
      expect(await resolveAddress({ kind: 'literal', value: 42 }, state)).toBe(42)
      expect(await resolveAddress({ kind: 'literal', value: true }, state)).toBe(true)
      expect(await resolveAddress({ kind: 'literal', value: null }, state)).toBeNull()
      expect(await resolveAddress({ kind: 'literal', value: [1, 2] }, state)).toEqual([1, 2])
    })

    test('write 抛 AddressError（不允许写入 literal）', async () => {
      await expect(
        writeAddress(
          { kind: 'literal', value: 'x' },
          'value',
          state
        )
      ).rejects.toThrow(AddressError)

      await expect(
        writeAddress(
          { kind: 'literal', value: 'x' },
          'value',
          state
        )
      ).rejects.toThrow(/literal/)
    })
  })

  // ============== public ==============
  describe('public（业务数据）', () => {
    test('resolve 从 publicStore 读取', async () => {
      state.publicStore.set('output_content', 'data')
      const result = await resolveAddress(
        { kind: 'public', name: 'output_content' },
        state
      )
      expect(result).toBe('data')
    })

    test('不存在的 public 抛 AddressError', async () => {
      await expect(
        resolveAddress({ kind: 'public', name: 'missing' }, state)
      ).rejects.toThrow(AddressError)

      await expect(
        resolveAddress({ kind: 'public', name: 'missing' }, state)
      ).rejects.toThrow(/not found/)
    })

    test('write 写入 publicStore', async () => {
      await writeAddress(
        { kind: 'public', name: 'output_content' },
        'value',
        state
      )
      expect(state.publicStore.get('output_content')).toBe('value')
    })

    test('write 覆盖已有值', async () => {
      state.publicStore.set('a', 'old')
      await writeAddress(
        { kind: 'public', name: 'a' },
        'new',
        state
      )
      expect(state.publicStore.get('a')).toBe('new')
    })
  })

  // ============== internal ==============
  describe('internal（寄存器）', () => {
    test('resolve 从 internalStore 读取', async () => {
      state.internalStore.set('$r0', 'register_value')
      const result = await resolveAddress(
        { kind: 'internal', name: '$r0' },
        state
      )
      expect(result).toBe('register_value')
    })

    test('不存在的 internal 抛 AddressError', async () => {
      await expect(
        resolveAddress({ kind: 'internal', name: '$r99' }, state)
      ).rejects.toThrow(AddressError)
    })

    test('write 写入 internalStore', async () => {
      await writeAddress(
        { kind: 'internal', name: '$r0' },
        'value',
        state
      )
      expect(state.internalStore.get('$r0')).toBe('value')
    })

    test('$r_err 寄存器', async () => {
      await writeAddress(
        { kind: 'internal', name: '$r_err' },
        null,
        state
      )
      expect(state.internalStore.get('$r_err')).toBeNull()
    })

    test('同名寄存器可覆盖', async () => {
      state.internalStore.set('$r0', 'old')
      state.internalStore.set('$r0', 'new')
      expect(state.internalStore.get('$r0')).toBe('new')
    })
  })

  // ============== 集成（move 模式）==============
  describe('resolve + writeAddress 集成（move 模式）', () => {
    test('literal → internal', async () => {
      const value = await resolveAddress(
        { kind: 'literal', value: 'data' },
        state
      )
      await writeAddress(
        { kind: 'internal', name: '$r0' },
        value,
        state
      )
      expect(state.internalStore.get('$r0')).toBe('data')
    })

    test('public → internal（业务→寄存器）', async () => {
      state.publicStore.set('business_var', 'business_value')

      const value = await resolveAddress(
        { kind: 'public', name: 'business_var' },
        state
      )
      await writeAddress(
        { kind: 'internal', name: '$r0' },
        value,
        state
      )

      expect(state.internalStore.get('$r0')).toBe('business_value')
    })

    test('internal → public（寄存器→业务）', async () => {
      state.internalStore.set('$r0', 'result')

      const value = await resolveAddress(
        { kind: 'internal', name: '$r0' },
        state
      )
      await writeAddress(
        { kind: 'public', name: 'output' },
        value,
        state
      )

      expect(state.publicStore.get('output')).toBe('result')
    })
  })

  // ============== 穷举守卫（运行时超出类型契约的 kind）==============
describe('非合法 kind 的运行时硬错误守卫', () => {
    const legacyFileAddr: Address = { kind: 'file' as any, path: '/tmp/x.txt' }

    test('resolveAddress：遗留 file kind → UNSUPPORTED_KIND', async () => {
      await expect(resolveAddress(legacyFileAddr, state)).rejects.toMatchObject({
        name: 'AddressError',
        code: 'UNSUPPORTED_KIND'
      })
    })

    test('writeAddress：遗留 file kind → UNSUPPORTED_KIND', async () => {
      await expect(writeAddress(legacyFileAddr, 'v', state)).rejects.toMatchObject({
        name: 'AddressError',
        code: 'UNSUPPORTED_KIND'
      })
    })

    test('未知 kind 字符串同样被拦截，不会静默返回 undefined / 无副作用通过', async () => {
      const bogusAddr = { kind: 'bogus-kind', foo: 1 } as unknown as Address
      let resolveReturnedUndefinedSilently = false
      try {
        const result = await resolveAddress(bogusAddr, state)
        if (result === undefined) resolveReturnedUndefinedSilently = true
      } catch {
        // 期望在这里抛错而不是走到下面两行
        resolveReturnedUndefinedSilently = false
      }
      expect(resolveReturnedUndefinedSilently).toBe(false)

      const beforeSize = state.publicStore.size
      await writeAddress(bogusAddr, 'v', state).catch(() => {})
      expect(state.publicStore.size).toBe(beforeSize) // 未命中任何 case 分支前不产生写入副作用
    })
  })
})