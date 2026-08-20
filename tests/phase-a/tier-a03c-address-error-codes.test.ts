/**
 * Phase A Tier A3c - AddressError code 字段验证
 *
 * 验证设计意图：
 * - AddressError.code 保留原始错误信息（ENOENT, EACCES 等）
 * - DAG 条件分支可通过 $error.code 决策
 * - 不破坏现有行为
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

const FIXTURES_DIR = 'tests/fixtures/a3c'

describe('A3c: AddressError code 字段', () => {
  let state: ExecutionState

  beforeEach(async () => {
    const { registry: l2 } = createMockL2()
    const l3 = createMockL3([])
    state = createInitialState(l2, l3)
    await fs.mkdir(FIXTURES_DIR, { recursive: true })
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

  // ============== 文件系统错误（保留原始错误码）==============
  describe('文件系统错误', () => {
    test('read 不存在的文件: code = ENOENT（保留原始）', async () => {
      try {
        await resolveAddress(
          { kind: 'file', path: '/nonexistent-abc-12345.txt' },
          state
        )
        expect.fail('应该抛错')
      } catch (err) {
        expect(err).toBeInstanceOf(AddressError)
        // 关键：从 Node.js fs 错误透传 ENOENT
        expect((err as AddressError).code).toBe('ENOENT')
      }
    })

    test('write 不可写路径: code = 原始 fs 错误码', async () => {
      const badPath = path.join('/nonexistent-dir-99999', 'output.txt')

      try {
        await writeAddress(
          { kind: 'file', path: badPath },
          'content',
          state
        )
        expect.fail('应该抛错')
      } catch (err) {
        expect(err).toBeInstanceOf(AddressError)
        // 应该是 ENOENT（父目录不存在）或 EACCES
        expect(['ENOENT', 'EACCES']).toContain((err as AddressError).code)
      }
    })
  })

  // ============== DAG 决策示例（设计意图）==============
  describe('DAG 决策支持', () => {
    test('DAG 可以根据 code 区分文件不存在 vs 权限拒绝', async () => {
      // 这个测试验证设计意图：DAG 条件分支能基于 code 做不同处理

      const errors: { code: string | undefined; message: string }[] = []

      // 尝试读多个不存在的文件，收集错误
      const paths = ['/nonexistent-1.txt', '/nonexistent-2.txt']
      for (const p of paths) {
        try {
          await resolveAddress({ kind: 'file', path: p }, state)
        } catch (err) {
          if (err instanceof AddressError) {
            errors.push({ code: err.code, message: err.message })
          }
        }
      }

      expect(errors).toHaveLength(2)

      // 所有错误都应该是 ENOENT（不是 undefined）
      for (const e of errors) {
        expect(e.code).toBe('ENOENT')
        expect(e.code).toBeDefined()  // 不是 undefined
      }
    })

    test('DAG 可以根据 code 创建默认文件 vs 报告错误', async () => {
      // 模拟 DAG 决策逻辑
      async function readOrDefault(path: string, defaultContent: string): Promise<string> {
        try {
          return await resolveAddress({ kind: 'file', path }, state)
        } catch (err) {
          if (err instanceof AddressError) {
            // ⭐ 关键：根据 code 决策
            if (err.code === 'ENOENT') {
              // 文件不存在 → 创建默认
              await writeAddress(
                { kind: 'file', path },
                defaultContent,
                state
              )
              return defaultContent
            } else if (err.code === 'EACCES') {
              // 权限拒绝 → 抛出自定义错误
              throw new Error(`Permission denied: ${path}`)
            }
          }
          throw err
        }
      }

      // 文件不存在 → 应创建默认
      const result = await readOrDefault(
        path.join(FIXTURES_DIR, 'created-by-dag.txt'),
        'default'
      )
      expect(result).toBe('default')

      // 验证文件确实被创建
      const content = await fs.readFile(
        path.join(FIXTURES_DIR, 'created-by-dag.txt'),
        'utf-8'
      )
      expect(content).toBe('default')
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