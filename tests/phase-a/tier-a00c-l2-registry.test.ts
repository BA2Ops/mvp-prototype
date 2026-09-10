/**
 * Phase A Tier A0c - L2Registry 测试
 *
 * 验证：
 * 1. 基本注册和获取
 * 2. 重复注册抛错
 * 3. 获取不存在的返回 undefined
 * 4. has/list/clear 方法
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { L2Registry } from '../../src/l2/registry.js'
import type { Operation } from '../../src/l2/operation.js'

describe('A0c: L2Registry', () => {
  let registry: L2Registry

  beforeEach(() => {
    registry = new L2Registry()
  })

  // ============== 基本操作 ==============
  describe('基本操作', () => {
    test('register + get', () => {
      const op = createMockOp('test_op')
      registry.register(op)

      const retrieved = registry.get('test_op')
      expect(retrieved).toBe(op)
    })

    test('get 不存在返回 undefined', () => {
      expect(registry.get('nonexistent')).toBeUndefined()
    })

    test('has 检查注册状态', () => {
      const op = createMockOp('test_op')
      registry.register(op)

      expect(registry.has('test_op')).toBe(true)
      expect(registry.has('nonexistent')).toBe(false)
    })

    test('重复注册同名 op 抛错', () => {
      const op1 = createMockOp('duplicate_op')
      const op2 = createMockOp('duplicate_op')

      registry.register(op1)

      expect(() => registry.register(op2)).toThrow(/already registered/)
      expect(() => registry.register(op2)).toThrow(/duplicate_op/)
    })

    test('重复注册不覆盖原 op', () => {
      const op1 = createMockOp('test_op', 'first')
      const op2 = createMockOp('test_op', 'second')

      registry.register(op1)

      try {
        registry.register(op2)
      } catch {
        // 预期抛错
      }

      // 原 op 仍存在
      expect(registry.get('test_op')).toBe(op1)
    })
  })

  // ============== list ==============
  describe('list', () => {
    test('空 registry 返回空数组', () => {
      expect(registry.list()).toEqual([])
    })

    test('返回所有注册名', () => {
      registry.register(createMockOp('op_a'))
      registry.register(createMockOp('op_b'))
      registry.register(createMockOp('op_c'))

      const names = registry.list()
      expect(names).toHaveLength(3)
      expect(names).toContain('op_a')
      expect(names).toContain('op_b')
      expect(names).toContain('op_c')
    })

    test('list 是数组（不是 Set）', () => {
      registry.register(createMockOp('op_x'))

      const result = registry.list()
      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ============== clear ==============
  describe('clear', () => {
    test('清空所有 registration', () => {
      registry.register(createMockOp('op_a'))
      registry.register(createMockOp('op_b'))
      expect(registry.list()).toHaveLength(2)

      registry.clear()

      expect(registry.list()).toEqual([])
      expect(registry.has('op_a')).toBe(false)
    })

    test('清空后可以重新注册同名 op', () => {
      registry.register(createMockOp('op_a'))
      registry.clear()
      // 不抛错
      expect(() => registry.register(createMockOp('op_a'))).not.toThrow()
      expect(registry.has('op_a')).toBe(true)
    })
  })

  // ============== 集成 ==============
  describe('集成场景', () => {
    test('MVP 内置 8 个 op 注册', () => {
      const ops = [
        'file_read', 'file_write', 'glob_match', 'grep_search',
        'shell_exec', 'string_replace', 'evaluate_expr', 'evaluate_collection'
      ]

      for (const name of ops) {
        registry.register(createMockOp(name))
      }

      expect(registry.list()).toHaveLength(8)
      for (const name of ops) {
        expect(registry.has(name)).toBe(true)
      }
    })
  })
})

// ============== Helpers ==============
function createMockOp(name: string, description = 'mock'): Operation {
  return {
    name,
    description,
    formalSpec: { inputs: {}, outputs: {} },
    execute: async () => ({})
  }
}