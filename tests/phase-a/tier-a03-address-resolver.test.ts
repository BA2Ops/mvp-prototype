/**
 * Phase A Tier A3 - Address 解析器测试
 *
 * @see ../../docs/mvp/11-prototype-implementation-plan.md §A3
 *
 * 验证：
 * 1. literal address 直接返回值
 * 2. variable address 从 resultStore 读取
 * 3. file address 从文件系统读取（真实 fs）
 * 4. writeAddress 到 variable / file
 * 5. writeAddress 到 literal 抛错
 * 6. variable 不存在抛错
 * 7. resolve + writeAddress 集成（move 模式）
 */

import { describe, test, expect, beforeEach, afterAll } from 'vitest'
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

describe('A3: Address 解析器', () => {
  let state: ExecutionState

  beforeEach(async () => {
    const { registry: l2 } = createMockL2()
    const l3 = createMockL3([])
    state = createInitialState(l2, l3)

    // 确保 fixtures 目录存在
    await fs.mkdir(FIXTURES_DIR, { recursive: true })
  })

  afterAll(async () => {
    // 清理 fixtures（可选）
    // await fs.rm(FIXTURES_DIR, { recursive: true, force: true })
  })

  // ============== literal address ==============
  describe('literal address（直接返回值）', () => {
    test('返回字符串值', async () => {
      const result = await resolveAddress(
        { kind: 'literal', value: 'hello' },
        state
      )
      expect(result).toBe('hello')
    })

    test('返回数字值', async () => {
      const result = await resolveAddress(
        { kind: 'literal', value: 42 },
        state
      )
      expect(result).toBe(42)
    })

    test('返回布尔值', async () => {
      const result = await resolveAddress(
        { kind: 'literal', value: true },
        state
      )
      expect(result).toBe(true)
    })

    test('返回 null 值', async () => {
      const result = await resolveAddress(
        { kind: 'literal', value: null },
        state
      )
      expect(result).toBeNull()
    })

    test('返回数组值', async () => {
      const arr: number[] = [1, 2, 3]
      const result = await resolveAddress(
        { kind: 'literal', value: arr },
        state
      )
      expect(result).toEqual([1, 2, 3])
    })

    test('返回对象值', async () => {
      const obj = { key: 'value', num: 42 }
      const result = await resolveAddress(
        { kind: 'literal', value: obj },
        state
      )
      expect(result).toEqual({ key: 'value', num: 42 })
    })

    test('literal 不读 resultStore（即使同名）', async () => {
      // 即使 resultStore 有同名 key，literal 仍返回其值
      state.resultStore.set('$x', 'from_store')

      const result = await resolveAddress(
        { kind: 'literal', value: 'from_literal' },
        state
      )

      expect(result).toBe('from_literal')
    })
  })

  // ============== variable address ==============
  describe('variable address（从 resultStore 读取）', () => {
    test('从 resultStore 读取值', async () => {
      state.resultStore.set('$x', 42)

      const result = await resolveAddress(
        { kind: 'variable', name: '$x' },
        state
      )

      expect(result).toBe(42)
    })

    test('variable 不存在抛 AddressError', async () => {
      await expect(
        resolveAddress(
          { kind: 'variable', name: '$missing' },
          state
        )
      ).rejects.toThrow(AddressError)

      await expect(
        resolveAddress(
          { kind: 'variable', name: '$missing' },
          state
        )
      ).rejects.toThrow(/not found/)
    })

    test('支持各种 Value 类型', async () => {
      state.resultStore.set('$str', 'hello')
      state.resultStore.set('$num', 42)
      state.resultStore.set('$bool', false)
      state.resultStore.set('$arr', [1, 2])
      state.resultStore.set('$obj', { a: 1 })

      expect(await resolveAddress(
        { kind: 'variable', name: '$str' }, state
      )).toBe('hello')

      expect(await resolveAddress(
        { kind: 'variable', name: '$num' }, state
      )).toBe(42)

      expect(await resolveAddress(
        { kind: 'variable', name: '$bool' }, state
      )).toBe(false)

      expect(await resolveAddress(
        { kind: 'variable', name: '$arr' }, state
      )).toEqual([1, 2])

      expect(await resolveAddress(
        { kind: 'variable', name: '$obj' }, state
      )).toEqual({ a: 1 })
    })

    test('null 值与缺失值的区别', async () => {
      // null 是有值（只是值为 null）
      state.resultStore.set('$null', null)
      const result = await resolveAddress(
        { kind: 'variable', name: '$null' }, state
      )
      expect(result).toBeNull()

      // $missing 不存在，抛错
      await expect(
        resolveAddress(
          { kind: 'variable', name: '$missing' }, state
        )
      ).rejects.toThrow()
    })
  })

  // ============== file address ==============
  describe('file address（从文件系统读取）', () => {
    test('从文件读取内容', async () => {
      const filePath = path.join(FIXTURES_DIR, 'read.txt')
      await fs.writeFile(filePath, 'file content')

      const result = await resolveAddress(
        { kind: 'file', path: filePath },
        state
      )

      expect(result).toBe('file content')
    })

    test('文件不存在抛 AddressError', async () => {
      const filePath = path.join(FIXTURES_DIR, 'nonexistent-12345.txt')

      await expect(
        resolveAddress(
          { kind: 'file', path: filePath },
          state
        )
      ).rejects.toThrow(AddressError)
    })

    test('读取多行文件', async () => {
      const filePath = path.join(FIXTURES_DIR, 'multiline.txt')
      const content = 'line1\nline2\nline3\n'
      await fs.writeFile(filePath, content)

      const result = await resolveAddress(
        { kind: 'file', path: filePath },
        state
      )

      expect(result).toBe(content)
    })

    test('读取 JSON 文件（返回字符串）', async () => {
      const filePath = path.join(FIXTURES_DIR, 'data.json')
      await fs.writeFile(filePath, JSON.stringify({ key: 'value' }))

      const result = await resolveAddress(
        { kind: 'file', path: filePath },
        state
      )

      expect(result).toBe('{"key":"value"}')
    })

    test('空文件返回空字符串', async () => {
      const filePath = path.join(FIXTURES_DIR, 'empty.txt')
      await fs.writeFile(filePath, '')

      const result = await resolveAddress(
        { kind: 'file', path: filePath },
        state
      )

      expect(result).toBe('')
    })
  })

  // ============== writeAddress to variable ==============
  describe('writeAddress to variable（写入 resultStore）', () => {
    test('写入到 resultStore', async () => {
      await writeAddress(
        { kind: 'variable', name: '$x' },
        'value',
        state
      )

      expect(state.resultStore.get('$x')).toBe('value')
    })

    test('覆盖已有值', async () => {
      state.resultStore.set('$x', 'old')

      await writeAddress(
        { kind: 'variable', name: '$x' },
        'new',
        state
      )

      expect(state.resultStore.get('$x')).toBe('new')
    })

    test('支持各种 Value 类型', async () => {
      await writeAddress(
        { kind: 'variable', name: '$str' },
        'hello', state
      )
      await writeAddress(
        { kind: 'variable', name: '$num' },
        42, state
      )
      await writeAddress(
        { kind: 'variable', name: '$bool' },
        true, state
      )
      await writeAddress(
        { kind: 'variable', name: '$arr' },
        [1, 2, 3], state
      )
      await writeAddress(
        { kind: 'variable', name: '$obj' },
        { a: 1 }, state
      )

      expect(state.resultStore.get('$str')).toBe('hello')
      expect(state.resultStore.get('$num')).toBe(42)
      expect(state.resultStore.get('$bool')).toBe(true)
      expect(state.resultStore.get('$arr')).toEqual([1, 2, 3])
      expect(state.resultStore.get('$obj')).toEqual({ a: 1 })
    })

    test('可写入 null', async () => {
      await writeAddress(
        { kind: 'variable', name: '$x' },
        null, state
      )

      expect(state.resultStore.has('$x')).toBe(true)
      expect(state.resultStore.get('$x')).toBeNull()
    })
  })

  // ============== writeAddress to file ==============
  describe('writeAddress to file（写入文件系统）', () => {
    test('写入到文件', async () => {
      const filePath = path.join(FIXTURES_DIR, 'output.txt')

      await writeAddress(
        { kind: 'file', path: filePath },
        'written content',
        state
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('written content')
    })

    test('覆盖已有文件', async () => {
      const filePath = path.join(FIXTURES_DIR, 'overwrite.txt')
      await fs.writeFile(filePath, 'old content')

      await writeAddress(
        { kind: 'file', path: filePath },
        'new content',
        state
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('new content')
    })

    test('数字值通过 String() 转换', async () => {
      const filePath = path.join(FIXTURES_DIR, 'num.txt')

      await writeAddress(
        { kind: 'file', path: filePath },
        42,
        state
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('42')
    })

    test('布尔值通过 String() 转换', async () => {
      const filePath = path.join(FIXTURES_DIR, 'bool.txt')

      await writeAddress(
        { kind: 'file', path: filePath },
        true,
        state
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('true')
    })

    test('写入到嵌套目录中的文件', async () => {
      const nestedDir = path.join(FIXTURES_DIR, 'nested')
      const filePath = path.join(nestedDir, 'deep.txt')
      await fs.mkdir(nestedDir, { recursive: true })

      await writeAddress(
        { kind: 'file', path: filePath },
        'deep content',
        state
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('deep content')
    })
  })

  // ============== writeAddress to literal ==============
  describe('writeAddress to literal（拒绝写入）', () => {
    test('抛 AddressError', async () => {
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

  // ============== 集成测试（move 模式）==============
  describe('resolve + writeAddress 集成（move 模式）', () => {
    test('writeAddress to variable 后 resolveAddress 读取', async () => {
      await writeAddress(
        { kind: 'variable', name: '$x' },
        'written',
        state
      )

      const result = await resolveAddress(
        { kind: 'variable', name: '$x' },
        state
      )

      expect(result).toBe('written')
    })

    test('file → variable 的 move（读取文件后存到 variable）', async () => {
      const filePath = path.join(FIXTURES_DIR, 'source.txt')
      await fs.writeFile(filePath, 'moved content')

      const value = await resolveAddress(
        { kind: 'file', path: filePath },
        state
      )

      await writeAddress(
        { kind: 'variable', name: '$moved' },
        value,
        state
      )

      expect(state.resultStore.get('$moved')).toBe('moved content')
    })

    test('variable → file 的 move（读取 variable 后写到文件）', async () => {
      const filePath = path.join(FIXTURES_DIR, 'dest.txt')

      state.resultStore.set('$source', 'to be written')

      const value = await resolveAddress(
        { kind: 'variable', name: '$source' },
        state
      )

      await writeAddress(
        { kind: 'file', path: filePath },
        value,
        state
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('to be written')
    })

    test('literal → variable 的 move', async () => {
      await writeAddress(
        { kind: 'variable', name: '$x' },
        'from literal',
        state
      )

      const result = await resolveAddress(
        { kind: 'variable', name: '$x' },
        state
      )

      expect(result).toBe('from literal')
    })
  })
})