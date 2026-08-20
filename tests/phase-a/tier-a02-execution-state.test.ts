/**
 * Phase A Tier A2 - ExecutionState 测试（双区架构版）
 *
 * 验证：
 * 1. createInitialState 返回双区（publicStore + internalStore）
 * 2. RegisterAllocator 分配寄存器
 * 3. stack 基础操作
 * 4. state 是引用类型
 * 5. state.l2 和 state.l3 引用
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  createInitialState,
  isInitialized,
  resetState,
  RegisterAllocator,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { createMockL2 } from '../../src/mocks/mock-l2.js'
import { createMockL3, createSpyL3 } from '../../src/mocks/mock-l3.js'
import type { MoveEntry, StackEntry } from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'

describe('A2: ExecutionState（双区架构版）', () => {
  // ============== createInitialState ==============
  describe('createInitialState', () => {
    test('返回空 stack、publicStore、internalStore', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])

      const state = createInitialState(l2, l3)

      expect(state.stack).toEqual([])
      expect(state.publicStore.size).toBe(0)
      expect(state.internalStore.size).toBe(0)
    })

    test('包含 RegisterAllocator', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])

      const state = createInitialState(l2, l3)

      expect(state.allocator).toBeDefined()
      expect(state.allocator).toBeInstanceOf(RegisterAllocator)
    })

    test('接受 L2Registry 和 L3Service 参数', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])

      const state = createInitialState(l2, l3)

      expect(state.l2).toBe(l2)
      expect(state.l3).toBe(l3)
    })

    test('每次返回新实例（独立 allocator 和双区）', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])

      const s1 = createInitialState(l2, l3)
      const s2 = createInitialState(l2, l3)

      expect(s1).not.toBe(s2)
      expect(s1.publicStore).not.toBe(s2.publicStore)
      expect(s1.internalStore).not.toBe(s2.internalStore)
      expect(s1.allocator).not.toBe(s2.allocator)
    })

    test('isInitialized 检查 state 完整性', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      const state = createInitialState(l2, l3)

      expect(isInitialized(state)).toBe(true)
    })
  })

  // ============== 双区基础操作 ==============
  describe('publicStore（业务数据）', () => {
    let state: ExecutionState

    beforeEach(() => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      state = createInitialState(l2, l3)
    })

    test('set/get 读写', () => {
      state.publicStore.set('output_content', 'hello')
      expect(state.publicStore.get('output_content')).toBe('hello')
    })

    test('业务命名约定（不以 $r 开头）', () => {
      state.publicStore.set('user_config', { x: 1 })
      state.publicStore.set('output_path', '/tmp/x')

      expect(state.publicStore.has('user_config')).toBe(true)
      expect(state.publicStore.has('output_path')).toBe(true)
    })

    test('has 检查', () => {
      state.publicStore.set('a', 1)
      expect(state.publicStore.has('a')).toBe(true)
      expect(state.publicStore.has('missing')).toBe(false)
    })

    test('支持各种 Value 类型', () => {
      state.publicStore.set('s', 'str')
      state.publicStore.set('n', 42)
      state.publicStore.set('b', true)
      state.publicStore.set('o', { key: 'value' })
      state.publicStore.set('arr', [1, 2, 3])

      expect(state.publicStore.get('s')).toBe('str')
      expect(state.publicStore.get('n')).toBe(42)
      expect(state.publicStore.get('o')).toEqual({ key: 'value' })
      expect(state.publicStore.get('arr')).toEqual([1, 2, 3])
    })
  })

  describe('internalStore（寄存器）', () => {
    let state: ExecutionState

    beforeEach(() => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      state = createInitialState(l2, l3)
    })

    test('set/get 读写', () => {
      state.internalStore.set('$r0', 'value')
      expect(state.internalStore.get('$r0')).toBe('value')
    })

    test('寄存器命名约定（$r 开头）', () => {
      state.internalStore.set('$r0', 1)
      state.internalStore.set('$r1', 2)
      state.internalStore.set('$r_err', null)

      expect(state.internalStore.get('$r0')).toBe(1)
      expect(state.internalStore.get('$r1')).toBe(2)
    })

    test('同名寄存器可覆盖（瞬态）', () => {
      state.internalStore.set('$r0', 'old')
      state.internalStore.set('$r0', 'new')
      expect(state.internalStore.get('$r0')).toBe('new')
    })

    test('$r_err 是合法寄存器名', () => {
      state.internalStore.set('$r_err', null)
      expect(state.internalStore.has('$r_err')).toBe(true)
      expect(state.internalStore.get('$r_err')).toBeNull()
    })
  })

  // ============== RegisterAllocator ==============
  describe('RegisterAllocator', () => {
    let allocator: RegisterAllocator

    beforeEach(() => {
      allocator = new RegisterAllocator()
    })

    test('分配新寄存器（递增）', () => {
      expect(allocator.allocate()).toBe('$r0')
      expect(allocator.allocate()).toBe('$r1')
      expect(allocator.allocate()).toBe('$r2')
    })

    test('每次 allocate 返回新名字', () => {
      const r0 = allocator.allocate()
      const r1 = allocator.allocate()
      expect(r0).not.toBe(r1)
    })

    test('errorRegister 是 $r_err（不通过 allocate 分配）', () => {
      expect(RegisterAllocator.errorRegister()).toBe('$r_err')

      allocator.allocate()
      allocator.allocate()

      expect(RegisterAllocator.errorRegister()).toBe('$r_err')
    })

    test('maxAllocated 返回已分配数', () => {
      expect(allocator.maxAllocated()).toBe(0)

      allocator.allocate()
      expect(allocator.maxAllocated()).toBe(1)

      allocator.allocate()
      allocator.allocate()
      expect(allocator.maxAllocated()).toBe(3)
    })

    test('reset 重置计数器', () => {
      allocator.allocate()
      allocator.allocate()
      expect(allocator.maxAllocated()).toBe(2)

      allocator.reset()
      expect(allocator.maxAllocated()).toBe(0)

      expect(allocator.allocate()).toBe('$r0')
    })
  })

  // ============== stack 基础 ==============
  describe('stack 基础操作', () => {
    let state: ExecutionState

    beforeEach(() => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      state = createInitialState(l2, l3)
    })

    test('push/pop', () => {
      const entry = createMoveEntry('m1', 'hello', '$r0')
      state.stack.push(entry)
      expect(state.stack.length).toBe(1)
      expect(state.stack.pop()).toBe(entry)
    })

    test('LIFO 行为', () => {
      const e1 = createMoveEntry('1', 1, '$r0')
      const e2 = createMoveEntry('2', 2, '$r1')
      const e3 = createMoveEntry('3', 3, '$r2')

      state.stack.push(e1)
      state.stack.push(e2)
      state.stack.push(e3)

      expect(state.stack.pop()).toBe(e3)
      expect(state.stack.pop()).toBe(e2)
      expect(state.stack.pop()).toBe(e1)
    })
  })

  // ============== resetState ==============
  describe('resetState', () => {
    test('重置 stack、双区、allocator', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      const state = createInitialState(l2, l3)

      state.publicStore.set('a', 1)
      state.internalStore.set('$r0', 1)
      state.allocator.allocate()
      state.allocator.allocate()

      resetState(state)

      expect(state.stack.length).toBe(0)
      expect(state.publicStore.size).toBe(0)
      expect(state.internalStore.size).toBe(0)
      expect(state.allocator.maxAllocated()).toBe(0)
    })

    test('保留 l2/l3 引用', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      const state = createInitialState(l2, l3)

      resetState(state)

      expect(state.l2).toBe(l2)
      expect(state.l3).toBe(l3)
    })
  })

  // ============== L2/L3 引用工作 ==============
  describe('state.l2 和 state.l3 引用', () => {
    test('state.l2.get 获取 L2 operation', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      const state = createInitialState(l2, l3)

      const op = state.l2.get('mock_op')
      expect(op).toBeDefined()
      expect(op!.name).toBe('mock_op')
    })

    test('state.l3.compile 调用 L3', async () => {
      const { registry: l2 } = createMockL2()
      const l3 = createSpyL3([])
      const state = createInitialState(l2, l3)

      const result = await state.l3.compile({ type: 'test', params: {} })
      expect(result).toEqual([])
      expect(l3.callCount()).toBe(1)
    })
  })
})

// ============== Helper ==============
function createMoveEntry(id: string, value: Value, varName: string): MoveEntry {
  return {
    id,
    parentIntentId: null,
    createdAt: now(),
    kind: 'move',
    from: { kind: 'literal', value },
    to: { kind: 'internal', name: varName }
  }
}