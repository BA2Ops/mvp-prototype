/**
 * Phase A Tier A2 - ExecutionState + resultStore 测试
 *
 * @see ../../docs/mvp/11-prototype-implementation-plan.md §A2
 *
 * 验证：
 * 1. createInitialState 返回空 stack 和 resultStore
 * 2. resultStore 基础操作（set/get/has/delete）
 * 3. stack 基础操作（push/pop/LIFO/peek）
 * 4. state 是引用类型（多 primitive 共享）
 * 5. state 接受 L2/L3 引用
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  createInitialState,
  isInitialized,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { createMockL2 } from '../../src/mocks/mock-l2.js'
import { createMockL3, createSpyL3 } from '../../src/mocks/mock-l3.js'
import type { MoveEntry, OpEntry, StackEntry } from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'

describe('A2: ExecutionState + resultStore', () => {
  // ============== createInitialState ==============
  describe('createInitialState', () => {
    test('返回空 stack 和空 resultStore', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])

      const state = createInitialState(l2, l3)

      expect(state.stack).toEqual([])
      expect(state.resultStore.size).toBe(0)
    })

    test('接受 L2Registry 参数', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])

      const state = createInitialState(l2, l3)

      expect(state.l2).toBe(l2)
      expect(state.l2.has('mock_op')).toBe(true)
      expect(state.l2.has('throwing_op')).toBe(true)
    })

    test('接受 L3Service 参数', () => {
      const { registry: l2 } = createMockL2()
      const children: StackEntry[] = []
      const l3 = createMockL3(children)

      const state = createInitialState(l2, l3)

      expect(state.l3).toBe(l3)
    })

    test('每次调用返回新实例（独立 stack 和 resultStore）', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])

      const s1 = createInitialState(l2, l3)
      const s2 = createInitialState(l2, l3)

      expect(s1).not.toBe(s2)
      expect(s1.stack).not.toBe(s2.stack)
      expect(s1.resultStore).not.toBe(s2.resultStore)
    })

    test('不同 state 互不干扰', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])

      const s1 = createInitialState(l2, l3)
      const s2 = createInitialState(l2, l3)

      s1.resultStore.set('$x', 1)
      s2.resultStore.set('$x', 2)

      expect(s1.resultStore.get('$x')).toBe(1)
      expect(s2.resultStore.get('$x')).toBe(2)
    })

    test('isInitialized 检查 state 完整性', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      const state = createInitialState(l2, l3)

      expect(isInitialized(state)).toBe(true)
    })
  })

  // ============== resultStore 基础操作 ==============
  describe('resultStore 基础操作', () => {
    let state: ExecutionState

    beforeEach(() => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      state = createInitialState(l2, l3)
    })

    test('set/get 读写值', () => {
      state.resultStore.set('$x', 42)
      expect(state.resultStore.get('$x')).toBe(42)
    })

    test('get 不存在的 key 返回 undefined', () => {
      expect(state.resultStore.get('$missing')).toBeUndefined()
    })

    test('has 检查 key 是否存在', () => {
      state.resultStore.set('$x', 42)
      expect(state.resultStore.has('$x')).toBe(true)
      expect(state.resultStore.has('$missing')).toBe(false)
    })

    test('set 覆盖已有值', () => {
      state.resultStore.set('$x', 1)
      state.resultStore.set('$x', 2)
      state.resultStore.set('$x', 3)
      expect(state.resultStore.get('$x')).toBe(3)
    })

    test('delete 移除值', () => {
      state.resultStore.set('$x', 42)
      expect(state.resultStore.has('$x')).toBe(true)

      state.resultStore.delete('$x')
      expect(state.resultStore.has('$x')).toBe(false)
    })

    test('size 反映 entry 数', () => {
      expect(state.resultStore.size).toBe(0)

      state.resultStore.set('$a', 1)
      expect(state.resultStore.size).toBe(1)

      state.resultStore.set('$b', 2)
      expect(state.resultStore.size).toBe(2)

      state.resultStore.delete('$a')
      expect(state.resultStore.size).toBe(1)
    })

    test('支持各种 Value 类型', () => {
      state.resultStore.set('$str', 'hello')
      state.resultStore.set('$num', 42)
      state.resultStore.set('$bool', true)
      state.resultStore.set('$null', null)
      state.resultStore.set('$arr', [1, 2, 3])
      state.resultStore.set('$obj', { key: 'value' })

      expect(state.resultStore.get('$str')).toBe('hello')
      expect(state.resultStore.get('$num')).toBe(42)
      expect(state.resultStore.get('$bool')).toBe(true)
      expect(state.resultStore.get('$null')).toBeNull()
      expect(state.resultStore.get('$arr')).toEqual([1, 2, 3])
      expect(state.resultStore.get('$obj')).toEqual({ key: 'value' })
    })

    test('key 不必以 $ 开头（A2 阶段无校验）', () => {
      // A2 简化：不做 key 格式校验
      // A3+ Address 解析后才有完整规则
      state.resultStore.set('any_key', 42)
      expect(state.resultStore.get('any_key')).toBe(42)
    })

    test('clear 清空所有', () => {
      state.resultStore.set('$x', 1)
      state.resultStore.set('$y', 2)

      state.resultStore.clear()

      expect(state.resultStore.size).toBe(0)
    })
  })

  // ============== stack 基础操作 ==============
  describe('stack 基础操作', () => {
    let state: ExecutionState

    beforeEach(() => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      state = createInitialState(l2, l3)
    })

    test('push 增加 entry（栈长度增加）', () => {
      const entry = createMoveEntry('m1', 1, '$x')

      expect(state.stack.length).toBe(0)

      state.stack.push(entry)

      expect(state.stack.length).toBe(1)
      expect(state.stack[0]).toBe(entry)
    })

    test('pop 移除并返回栈顶', () => {
      const entry = createMoveEntry('m1', 1, '$x')
      state.stack.push(entry)

      const popped = state.stack.pop()

      expect(popped).toBe(entry)
      expect(state.stack.length).toBe(0)
    })

    test('LIFO（后进先出）行为', () => {
      const e1 = createMoveEntry('1', 1, '$a')
      const e2 = createMoveEntry('2', 2, '$b')
      const e3 = createMoveEntry('3', 3, '$c')

      state.stack.push(e1)
      state.stack.push(e2)
      state.stack.push(e3)

      expect(state.stack.pop()).toBe(e3)
      expect(state.stack.pop()).toBe(e2)
      expect(state.stack.pop()).toBe(e1)
      expect(state.stack.length).toBe(0)
    })

    test('peek（不弹出的栈顶查看）', () => {
      const entry = createMoveEntry('m', 1, '$x')
      state.stack.push(entry)

      const top = state.stack[state.stack.length - 1]

      expect(top).toBe(entry)
      expect(state.stack.length).toBe(1)
    })

    test('push 不同类型的 StackEntry', () => {
      const opEntry: OpEntry = {
        id: 'op', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'x', inputs: {}, outputs: {}, status: 'pending'
      }
      const moveEntry = createMoveEntry('m', 1, '$x')
      const skipEntry: StackEntry = {
        id: 's', parentIntentId: null, createdAt: 0,
        kind: 'skip_n', n: 1
      }

      state.stack.push(opEntry)
      state.stack.push(moveEntry)
      state.stack.push(skipEntry)

      expect(state.stack.length).toBe(3)
      expect(state.stack[0].kind).toBe('execute_op')
      expect(state.stack[1].kind).toBe('move')
      expect(state.stack[2].kind).toBe('skip_n')
    })

    test('空栈 pop 返回 undefined', () => {
      expect(state.stack.pop()).toBeUndefined()
      expect(state.stack.length).toBe(0)
    })
  })

  // ============== state 是引用类型 ==============
  describe('state 是引用类型（多 primitive 共享）', () => {
    test('多个 primitive 操作同一 state', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      const state = createInitialState(l2, l3)

      // 模拟 primitive A 设置值
      state.resultStore.set('$x', 10)

      // 模拟 primitive B 读取值
      expect(state.resultStore.get('$x')).toBe(10)

      // 模拟 primitive C 覆盖值
      state.resultStore.set('$x', 20)

      // 模拟 primitive D 读取最新值
      expect(state.resultStore.get('$x')).toBe(20)
    })

    test('多个 entry 可共享 stack', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      const state = createInitialState(l2, l3)

      const e1 = createMoveEntry('1', 1, '$a')
      const e2 = createMoveEntry('2', 2, '$b')
      const e3 = createMoveEntry('3', 3, '$c')

      state.stack.push(e1)
      state.stack.push(e2)
      state.stack.push(e3)

      // 模拟 primitive 处理：依次弹出
      expect(state.stack.pop()).toBe(e3)
      expect(state.stack.pop()).toBe(e2)
      expect(state.stack.pop()).toBe(e1)
    })
  })

  // ============== L2/L3 引用工作 ==============
  describe('state.l2 和 state.l3 引用工作', () => {
    test('可通过 state.l2.get 获取 L2 operation', () => {
      const { registry: l2 } = createMockL2()
      const l3 = createMockL3([])
      const state = createInitialState(l2, l3)

      const op = state.l2.get('mock_op')
      expect(op).toBeDefined()
      expect(op!.name).toBe('mock_op')
    })

    test('可通过 state.l3.compile 调用 L3', async () => {
      const { registry: l2 } = createMockL2()
      const l3 = createSpyL3([])
      const state = createInitialState(l2, l3)

      const result = await state.l3.compile({ type: 'test', params: {} })

      expect(result).toEqual([])
      expect(l3.callCount()).toBe(1)
    })
  })
})

// ============== 测试 helper ==============
function createMoveEntry(id: string, value: number, varName: string): MoveEntry {
  return {
    id,
    parentIntentId: null,
    createdAt: now(),
    kind: 'move',
    from: { kind: 'literal', value },
    to: { kind: 'variable', name: varName }
  }
}