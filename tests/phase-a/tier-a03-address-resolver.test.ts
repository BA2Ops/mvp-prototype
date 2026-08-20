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
import * as fs from 'fs/promises'
import * as path from 'path'
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

const FIXTURES_DIR = 'tests/fixtures/a3'

describe('A3: Address 解析器（双区架构版）', () => {
  let state: ExecutionState

  beforeEach(async () => {
    const { registry: l2 } = createMockL2()
    const l3 = createMockL3([])
    state = createInitialState(l2, l3)
    await fs.mkdir(FIXTURES_DIR, { recursive: true })
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

  // ============== file ==============
  describe('file', () => {
    test('resolve 从 fs 读取', async () => {
      const filePath = path.join(FIXTURES_DIR, 'read.txt')
      await fs.writeFile(filePath, 'file content')

      const result = await resolveAddress(
        { kind: 'file', path: filePath },
        state
      )
      expect(result).toBe('file content')
    })

    test('不存在的 file 抛 AddressError', async () => {
      await expect(
        resolveAddress({ kind: 'file', path: '/nonexistent-12345.txt' }, state)
      ).rejects.toThrow(AddressError)
    })

    test('write 写入文件', async () => {
      const filePath = path.join(FIXTURES_DIR, 'output.txt')
      await writeAddress(
        { kind: 'file', path: filePath },
        'written content',
        state
      )
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('written content')
    })

    test('write 不可写路径抛 AddressError', async () => {
      // 尝试写入不存在的目录下的文件
      const badPath = '/nonexistent-dir-12345/output.txt'

      await expect(
        writeAddress(
          { kind: 'file', path: badPath },
          'content',
          state
        )
      ).rejects.toThrow(AddressError)

      await expect(
        writeAddress(
          { kind: 'file', path: badPath },
          'content',
          state
        )
      ).rejects.toThrow(/Failed to write file/)
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

    test('file → internal → public（完整数据流）', async () => {
      const filePath = path.join(FIXTURES_DIR, 'data.txt')
      await fs.writeFile(filePath, 'flow data')

      // file → internal
      const v1 = await resolveAddress(
        { kind: 'file', path: filePath },
        state
      )
      await writeAddress(
        { kind: 'internal', name: '$r0' },
        v1,
        state
      )

      // internal → public
      const v2 = await resolveAddress(
        { kind: 'internal', name: '$r0' },
        state
      )
      await writeAddress(
        { kind: 'public', name: 'final_output' },
        v2,
        state
      )

      expect(state.internalStore.get('$r0')).toBe('flow data')
      expect(state.publicStore.get('final_output')).toBe('flow data')
    })
  })
})