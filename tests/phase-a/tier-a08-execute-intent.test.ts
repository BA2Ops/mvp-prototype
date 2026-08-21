/**
 * Phase A Tier A8 - execute_intent primitive 测试（双区架构版）
 *
 * 验证：
 * 1. 基本调用：L3 返回 children，压栈，pop self
 * 2. 生命周期：pending → awaiting_children → done
 * 3. children 压栈顺序：逆序（先执行最右）
 * 4. children 为空情况
 * 5. L3 compile 抛错（向上传播）
 * 6. 与 mock L3 集成（verify L3.compile 被正确调用）
 * 7. 与 execute_op 嵌套（DAG 编译产物）
 * 8. 与 skip_n / conditional_skip 配合
 * 9. 状态保留
 * 10. IntentEntry 自身字段
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  executeIntent,
  ExecuteIntentError
} from '../../src/l1/primitives/execute-intent.js'
import {
  createInitialState,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { createMockL2 } from '../../src/mocks/mock-l2.js'
import {
  createMockL3,
  createSpyL3,
  createProgrammableL3
} from '../../src/mocks/mock-l3.js'
import type {
  IntentEntry,
  StackEntry,
  RecognizedIntent
} from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'

describe('A8: execute_intent primitive（双区架构版）', () => {
  let state: ExecutionState

  beforeEach(() => {
    const { registry: l2 } = createMockL2()
    const l3 = createMockL3([])
    state = createInitialState(l2, l3)
  })

  // ============== 基本调用 ==============
  describe('基本调用', () => {
    test('调用 L3.compile，children 压栈，pop self', async () => {
      const children: StackEntry[] = [
        { kind: 'skip_n', id: 'c1', parentIntentId: null, createdAt: 0, n: 0 },
        { kind: 'skip_n', id: 'c2', parentIntentId: null, createdAt: 0, n: 1 }
      ]
      const l3 = createMockL3(children)
      state.l3 = l3

      const entry = createIntentEntry({ type: 'test', params: {} })
      state.stack.push(entry)

      await executeIntent(entry, state)

      // 栈变化：entry 被 pop，children 压入（逆序）
      // 栈数组（底→顶）: [c2, c1]；pop 顺序: c1 → c2（children[0] 先执行）
      expect(state.stack.length).toBe(2)
      expect(state.stack[0].id).toBe('c2')  // 栈底（最后执行）
      expect(state.stack[1].id).toBe('c1')  // 栈顶（最先执行）

      // 验证 pop 顺序：先取 c1（children[0]）
      expect(state.stack.pop()?.id).toBe('c1')
      expect(state.stack.pop()?.id).toBe('c2')
    })

    test('children 压栈顺序：children[0] 在栈底', async () => {
      const children: StackEntry[] = [
        { kind: 'skip_n', id: 'first', parentIntentId: null, createdAt: 0, n: 0 },
        { kind: 'skip_n', id: 'middle', parentIntentId: null, createdAt: 0, n: 0 },
        { kind: 'skip_n', id: 'last', parentIntentId: null, createdAt: 0, n: 0 }
      ]
      const l3 = createMockL3(children)
      state.l3 = l3

      const entry = createIntentEntry({ type: 'test', params: {} })
      state.stack.push(entry)

      await executeIntent(entry, state)

      // 逆序压栈（children = [first, middle, last]）
      // 栈数组（底→顶）: [last, middle, first]
      // pop 顺序: first → middle → last（children[0] 先执行）
      expect(state.stack.map(e => e.id)).toEqual(['last', 'middle', 'first'])

      // 验证 pop 顺序
      const popped: string[] = []
      while (state.stack.length > 0) {
        popped.push(state.stack.pop()!.id)
      }
      expect(popped).toEqual(['first', 'middle', 'last'])
    })

    test('空 children：直接完成', async () => {
      const l3 = createMockL3([])
      state.l3 = l3

      const entry = createIntentEntry({ type: 'empty', params: {} })
      state.stack.push(entry)

      await executeIntent(entry, state)

      expect(state.stack.length).toBe(0)
      expect(entry.phase).toBe('done')
    })

    test('L3 compile 接收 intent 和 state 参数', async () => {
      const spy = createSpyL3([])
      state.l3 = spy

      const entry = createIntentEntry({
        type: 'my_intent',
        params: { path: '/tmp/test' }
      })
      state.stack.push(entry)

      await executeIntent(entry, state)

      // spy 应记录 compile 调用
      expect(spy.callCount()).toBe(1)
      const last = spy.lastIntent()
      expect(last?.type).toBe('my_intent')
      expect(last?.params.path).toBe('/tmp/test')
    })
  })

  // ============== IntentEntry 生命周期 ==============
  describe('IntentEntry 生命周期', () => {
    test('pending → awaiting_children → done', async () => {
      const l3 = createMockL3([
        { kind: 'skip_n', id: 'c1', parentIntentId: null, createdAt: 0, n: 0 }
      ])
      state.l3 = l3

      const entry = createIntentEntry({ type: 'test', params: {} })
      state.stack.push(entry)

      expect(entry.phase).toBe('pending')

      await executeIntent(entry, state)

      expect(entry.phase).toBe('done')
    })

    test('phase 字段类型正确', () => {
      const phases: IntentEntry['phase'][] = [
        'pending',
        'awaiting_children',
        'done',
        'aborted'
      ]
      expect(phases).toHaveLength(4)
    })
  })

  // ============== L3 compile 抛错 ==============
  describe('L3 compile 抛错（向上传播）', () => {
    test('L3 抛错时向上传播，不被 catch', async () => {
      const l3: typeof state.l3 = {
        compile: async () => {
          throw new Error('L3 compile failed')
        },
        getExperience: () => null,
        recordFeedback: async () => {},
        listExperiences: () => [],
        recompile: async () => []
      }
      state.l3 = l3

      const entry = createIntentEntry({ type: 'failing', params: {} })
      state.stack.push(entry)

      // 应向上抛
      await expect(executeIntent(entry, state)).rejects.toThrow('L3 compile failed')

      // entry 状态保持 awaiting_children（异常中）
      expect(entry.phase).toBe('awaiting_children')
    })

    test('L3 返回空 children 与抛错是不同路径', async () => {
      const l3Empty = createMockL3([])
      state.l3 = l3Empty

      const entry = createIntentEntry({ type: 'empty', params: {} })
      state.stack.push(entry)

      // 空 children 不抛错
      await expect(executeIntent(entry, state)).resolves.not.toThrow()
      expect(entry.phase).toBe('done')
    })
  })

  // ============== 与 createProgrammableL3 集成 ==============
  describe('与 programmable L3 集成', () => {
    test('按 type 路由到不同 children', async () => {
      const l3 = createProgrammableL3()

      const readChildren: StackEntry[] = [
        { kind: 'skip_n', id: 'read_step', parentIntentId: null, createdAt: 0, n: 0 }
      ]
      const writeChildren: StackEntry[] = [
        { kind: 'skip_n', id: 'write_step1', parentIntentId: null, createdAt: 0, n: 0 },
        { kind: 'skip_n', id: 'write_step2', parentIntentId: null, createdAt: 0, n: 0 }
      ]

      l3.setChildren('read_file', readChildren)
      l3.setChildren('write_file', writeChildren)

      state.l3 = l3

      // 测试 read_file
      const entry1 = createIntentEntry({ type: 'read_file', params: {} })
      state.stack.push(entry1)
      await executeIntent(entry1, state)
      expect(state.stack.map(e => e.id)).toEqual(['read_step'])

      // 清栈
      state.stack.length = 0

      // 测试 write_file（children = [write_step1, write_step2]）
      const entry2 = createIntentEntry({ type: 'write_file', params: {} })
      state.stack.push(entry2)
      await executeIntent(entry2, state)
      // 栈数组（底→顶）: [write_step2, write_step1]；pop 先取 write_step1
      expect(state.stack.map(e => e.id)).toEqual(['write_step2', 'write_step1'])
    })

    test('未注册的 type 路由返回空 children', async () => {
      const l3 = createProgrammableL3()
      state.l3 = l3

      const entry = createIntentEntry({ type: 'unregistered', params: {} })
      state.stack.push(entry)

      await executeIntent(entry, state)

      // 空 children → 直接完成
      expect(entry.phase).toBe('done')
      expect(state.stack.length).toBe(0)
    })
  })

  // ============== 与 execute_op 嵌套（DAG 编译产物）==============
  describe('与 execute_op 嵌套（典型 DAG 编译产物）', () => {
    test('DAG if-then-else 编译产物正确执行', async () => {
      // 模拟 L3 编译 read_or_create_file 产生的序列：
      // 1. file_read (output: $r1, $r_err)
      // 2. conditional_skip($r_err, n=2)
      // 3. execute_op(move, ...)
      // 4. skip_n(1)
      // 5. execute_op(file_write, ...)
      const l3Children: StackEntry[] = [
        { kind: 'execute_op', id: 'op_file_read', parentIntentId: null, createdAt: 0,
          operation: 'mock_op', inputs: { x: { kind: 'internal', name: '$r0' } },
          outputs: { result: { kind: 'internal', name: '$r1' }, error: { kind: 'internal', name: '$r_err' } },
          status: 'pending' },
        { kind: 'conditional_skip', id: 'cs', parentIntentId: null, createdAt: 0,
          conditionAddr: { kind: 'internal', name: '$r_err' }, n: 2 },
        { kind: 'execute_op', id: 'op_move', parentIntentId: null, createdAt: 0,
          operation: 'noop', inputs: {}, outputs: {}, status: 'pending' },
        { kind: 'skip_n', id: 'sn', parentIntentId: null, createdAt: 0, n: 1 },
        { kind: 'execute_op', id: 'op_write', parentIntentId: null, createdAt: 0,
          operation: 'noop', inputs: {}, outputs: {}, status: 'pending' }
      ]
      const l3 = createMockL3(l3Children)
      state.l3 = l3

      const entry = createIntentEntry({
        type: 'read_or_create_file',
        params: { path: '/tmp/test.txt', default_content: '' }
      })
      state.stack.push(entry)

      await executeIntent(entry, state)

      // 验证：5 个 children 全部入栈（逆序）
      // 栈数组（底→顶）: [op_write, sn, op_move, cs, op_file_read]
      // pop 顺序: op_file_read → cs → op_move → sn → op_write（children[0] 先执行）
      expect(state.stack.length).toBe(5)
      expect(state.stack[0].id).toBe('op_write')      // 栈底（最后执行）
      expect(state.stack[4].id).toBe('op_file_read')  // 栈顶（最先执行）
    })
  })

  // ============== 嵌套调用 ==============
  describe('嵌套调用（sub-intent 是 execute_intent）', () => {
    test('嵌套 L3.compile 调用链', async () => {
      // 模拟 while 循环经验：A 调用 A_self
      const selfChildren: StackEntry[] = [
        { kind: 'skip_n', id: 'self_skip', parentIntentId: null, createdAt: 0, n: 1 },
        { kind: 'execute_intent', id: 'self_entry', parentIntentId: null, createdAt: 0,
          intent: { type: 'recursive_exp', params: {} },
          phase: 'pending', children: [] }
      ]

      const l3 = createMockL3(selfChildren)
      state.l3 = l3

      const entry = createIntentEntry({ type: 'recursive_exp', params: {} })
      state.stack.push(entry)

      await executeIntent(entry, state)

      // 栈：entry 被 pop，selfChildren 压入
      // 栈数组（底→顶）: [self_entry, self_skip]
      // pop 顺序: self_skip → self_entry（children[0] 先执行）
      expect(state.stack.length).toBe(2)
      expect(state.stack[0].id).toBe('self_entry')
      expect(state.stack[1].id).toBe('self_skip')
    })
  })

  // ============== 多次连续调用 ==============
  describe('多次连续调用', () => {
    test('连续两个 execute_intent', async () => {
      const l3 = createMockL3([])
      state.l3 = l3

      const entry1 = createIntentEntry({ type: 'first', params: {} })
      const entry2 = createIntentEntry({ type: 'second', params: {} })

      state.stack.push(entry1)
      state.stack.push(entry2)

      // 执行 entry2（栈顶）
      await executeIntent(entry2, state)
      expect(entry2.phase).toBe('done')
      expect(state.stack.length).toBe(1)  // 只剩 entry1

      // 执行 entry1
      await executeIntent(entry1, state)
      expect(entry1.phase).toBe('done')
      expect(state.stack.length).toBe(0)
    })
  })

  // ============== 状态保留 ==============
  describe('状态保留', () => {
    test('不动 publicStore', async () => {
      const l3 = createMockL3([])
      state.l3 = l3
      state.publicStore.set('business_data', 'preserve')

      const entry = createIntentEntry({ type: 'test', params: {} })
      state.stack.push(entry)

      await executeIntent(entry, state)

      expect(state.publicStore.get('business_data')).toBe('preserve')
    })

    test('不动 internalStore', async () => {
      const l3 = createMockL3([])
      state.l3 = l3
      state.internalStore.set('$r0', 'preserve')
      state.internalStore.set('$r_err', null)

      const entry = createIntentEntry({ type: 'test', params: {} })
      state.stack.push(entry)

      await executeIntent(entry, state)

      expect(state.internalStore.get('$r0')).toBe('preserve')
      expect(state.internalStore.has('$r_err')).toBe(true)
    })

    test('不动 allocator', async () => {
      const l3 = createMockL3([])
      state.l3 = l3
      state.allocator.allocate()
      state.allocator.allocate()
      const before = state.allocator.maxAllocated()

      const entry = createIntentEntry({ type: 'test', params: {} })
      state.stack.push(entry)

      await executeIntent(entry, state)

      expect(state.allocator.maxAllocated()).toBe(before)
    })
  })

  // ============== IntentEntry 字段 ==============
  describe('IntentEntry 字段', () => {
    test('id / parentIntentId / createdAt', () => {
      const entry = createIntentEntry({ type: 'test', params: {} })
      expect(entry.id).toBeDefined()
      expect(entry.parentIntentId).toBeNull()
      expect(entry.createdAt).toBeGreaterThan(0)
    })

    test('intent 字段：type + params', () => {
      const entry = createIntentEntry({
        type: 'complex_intent',
        params: { x: 1, y: 'hello', z: { nested: true } }
      })
      expect(entry.intent.type).toBe('complex_intent')
      expect(entry.intent.params.x).toBe(1)
      expect(entry.intent.params.y).toBe('hello')
    })
  })

  // ============== ExecuteIntentError ==============
  describe('ExecuteIntentError', () => {
    test('是 Error 子类', () => {
      const err = new ExecuteIntentError('test')
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('ExecuteIntentError')
      expect(err.message).toBe('test')
    })
  })
})

// ============== Helpers ==============

/**
 * 创建一个 IntentEntry
 */
function createIntentEntry(intent: RecognizedIntent): IntentEntry {
  return {
    id: generateId('intent'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'execute_intent',
    intent,
    phase: 'pending',
    children: []
  }
}