/**
 * Phase A Tier A1 - Type 定义层测试
 *
 * @see ../../docs/mvp/11-prototype-implementation-plan.md §A1
 *
 * 验证：
 * 1. Value 类型支持所有基本类型
 * 2. Address 3 种 kind 可实例化
 * 3. 5 种 StackEntry 可实例化
 * 4. Discriminated union 通过 kind 缩窄
 * 5. assertNever 严格穷尽检查
 * 6. BaseEntry 共有字段
 * 7. 状态机字段（status / phase）
 */

import { describe, test, expect } from 'vitest'
import type {
  StackEntry,
  Address,
  Value,
  OpEntry,
  IntentEntry,
  MoveEntry,
  SkipN,
  ConditionalSkip
} from '../../src/l1/types.js'
import { assertNever } from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'

describe('A1: Type 定义层', () => {
  // ============== Value 类型 ==============
  describe('Value 类型', () => {
    test('支持 7 种基本类型', () => {
      const values: Value[] = [
        'string',
        42,
        true,
        null,
        undefined,
        [1, 2, 3],
        { key: 'value' }
      ]
      expect(values).toHaveLength(7)
    })

    test('Value 数组支持嵌套', () => {
      const nested: Value = [
        [1, 2, [3, 4]],
        { items: [{ name: 'a' }, { name: 'b' }] },
        'plain'
      ]
      expect(Array.isArray(nested)).toBe(true)
      expect(Array.isArray((nested as Value[])[0])).toBe(true)
    })

    test('Value 对象支持嵌套', () => {
      const nested: Value = {
        level1: {
          level2: {
            level3: 'deep'
          }
        }
      }
      expect(typeof nested).toBe('object')
    })
  })

  // ============== Address 类型 ==============
  describe('Address 类型（3 种 kind）', () => {
    test('literal address 持有 Value', () => {
      const addr: Address = { kind: 'literal', value: 'hello' }
      expect(addr.kind).toBe('literal')
      if (addr.kind === 'literal') {
        expect(addr.value).toBe('hello')
      }
    })

    test('literal address 持有各种 Value', () => {
      const literals: Address[] = [
        { kind: 'literal', value: 'string' },
        { kind: 'literal', value: 42 },
        { kind: 'literal', value: true },
        { kind: 'literal', value: null },
        { kind: 'literal', value: [1, 2, 3] },
        { kind: 'literal', value: { nested: 'object' } }
      ]
      expect(literals).toHaveLength(6)
    })

    test('variable address 持有 name', () => {
      const addr: Address = { kind: 'variable', name: '$result' }
      expect(addr.kind).toBe('variable')
      if (addr.kind === 'variable') {
        expect(addr.name).toBe('$result')
      }
    })

    test('variable name 约定以 $ 开头', () => {
      // 设计约束：variable name 以 $ 开头（与 $env.* 区分）
      const addr: Address = { kind: 'variable', name: '$x' }
      expect(addr.name.startsWith('$')).toBe(true)
    })

    test('file address 持有 path', () => {
      const addr: Address = { kind: 'file', path: '/tmp/test.txt' }
      expect(addr.kind).toBe('file')
      if (addr.kind === 'file') {
        expect(addr.path).toBe('/tmp/test.txt')
      }
    })

    test('3 种 kind 都是 Address 合法实例', () => {
      const addrs: Address[] = [
        { kind: 'literal', value: 42 },
        { kind: 'variable', name: '$x' },
        { kind: 'file', path: '/tmp/x' }
      ]
      expect(addrs).toHaveLength(3)
    })
  })

  // ============== 5 种 StackEntry ==============
  describe('5 种 StackEntry 可实例化', () => {
    test('OpEntry', () => {
      const entry: OpEntry = {
        id: generateId('op'),
        parentIntentId: null,
        createdAt: now(),
        kind: 'execute_op',
        operation: 'file_read',
        inputs: { path: { kind: 'file', path: '/tmp/x' } },
        outputs: { content: { kind: 'variable', name: '$c' } },
        status: 'pending'
      }
      expect(entry.kind).toBe('execute_op')
      expect(entry.operation).toBe('file_read')
      expect(entry.status).toBe('pending')
    })

    test('IntentEntry', () => {
      const entry: IntentEntry = {
        id: generateId('intent'),
        parentIntentId: null,
        createdAt: now(),
        kind: 'execute_intent',
        intent: { type: 'test', params: {} },
        phase: 'pending',
        children: []
      }
      expect(entry.kind).toBe('execute_intent')
      expect(entry.phase).toBe('pending')
      expect(entry.children).toEqual([])
    })

    test('MoveEntry', () => {
      const entry: MoveEntry = {
        id: generateId('move'),
        parentIntentId: null,
        createdAt: now(),
        kind: 'move',
        from: { kind: 'literal', value: 'hello' },
        to: { kind: 'variable', name: '$x' }
      }
      expect(entry.kind).toBe('move')
      expect(entry.from.kind).toBe('literal')
      expect(entry.to.kind).toBe('variable')
    })

    test('SkipN', () => {
      const entry: SkipN = {
        id: generateId('skip'),
        parentIntentId: null,
        createdAt: now(),
        kind: 'skip_n',
        n: 3
      }
      expect(entry.kind).toBe('skip_n')
      expect(entry.n).toBe(3)
    })

    test('ConditionalSkip', () => {
      const entry: ConditionalSkip = {
        id: generateId('cs'),
        parentIntentId: null,
        createdAt: now(),
        kind: 'conditional_skip',
        conditionAddr: { kind: 'variable', name: '$cond' },
        n: 2
      }
      expect(entry.kind).toBe('conditional_skip')
      expect(entry.conditionAddr.kind).toBe('variable')
      expect(entry.n).toBe(2)
    })

    test('所有 5 种可放入 StackEntry[] 数组', () => {
      const entries: StackEntry[] = [
        {
          id: 'op', parentIntentId: null, createdAt: 1,
          kind: 'execute_op',
          operation: 'x', inputs: {}, outputs: {}, status: 'pending'
        },
        {
          id: 'int', parentIntentId: null, createdAt: 2,
          kind: 'execute_intent',
          intent: { type: 'x', params: {} },
          phase: 'pending', children: []
        },
        {
          id: 'mv', parentIntentId: null, createdAt: 3,
          kind: 'move',
          from: { kind: 'literal', value: 1 },
          to: { kind: 'variable', name: '$x' }
        },
        {
          id: 'sk', parentIntentId: null, createdAt: 4,
          kind: 'skip_n', n: 1
        },
        {
          id: 'cs', parentIntentId: null, createdAt: 5,
          kind: 'conditional_skip',
          conditionAddr: { kind: 'variable', name: '$x' },
          n: 1
        }
      ]
      expect(entries).toHaveLength(5)
    })
  })

  // ============== Discriminated Union ==============
  describe('Discriminated Union（类型缩窄）', () => {
    test('通过 kind 字段进行类型缩窄', () => {
      const entries: StackEntry[] = [
        {
          id: 'm', parentIntentId: null, createdAt: 1,
          kind: 'move',
          from: { kind: 'literal', value: 'x' },
          to: { kind: 'variable', name: '$y' }
        }
      ]

      for (const entry of entries) {
        switch (entry.kind) {
          case 'execute_op':
            // TypeScript 知道 entry 是 OpEntry
            expect(entry.operation).toBeDefined()
            break
          case 'execute_intent':
            expect(entry.intent).toBeDefined()
            break
          case 'move':
            // TypeScript 知道 entry 是 MoveEntry，from/to 可访问
            expect(entry.from).toBeDefined()
            expect(entry.to).toBeDefined()
            break
          case 'skip_n':
            expect(entry.n).toBeDefined()
            break
          case 'conditional_skip':
            expect(entry.conditionAddr).toBeDefined()
            break
          default:
            return assertNever(entry)
        }
      }
    })

    test('assertNever 抛出错误', () => {
      // 模拟一个不在 union 中的值
      const fakeValue = 'fake' as never
      expect(() => assertNever(fakeValue)).toThrow(/Unhandled/)
    })

    test('kinds 数组包含所有 5 种', () => {
      const kinds: StackEntry['kind'][] = [
        'execute_op',
        'execute_intent',
        'move',
        'skip_n',
        'conditional_skip'
      ]
      expect(kinds).toHaveLength(5)
    })
  })

  // ============== BaseEntry 共有字段 ==============
  describe('BaseEntry 共有字段', () => {
    test('所有 StackEntry 都有 id, parentIntentId, createdAt', () => {
      const entries: StackEntry[] = [
        {
          id: 'op1', parentIntentId: null, createdAt: 1000,
          kind: 'execute_op',
          operation: 'x', inputs: {}, outputs: {}, status: 'pending'
        },
        {
          id: 'i1', parentIntentId: 'parent', createdAt: 2000,
          kind: 'execute_intent',
          intent: { type: 'x', params: {} },
          phase: 'pending', children: []
        },
        {
          id: 'm1', parentIntentId: null, createdAt: 3000,
          kind: 'move',
          from: { kind: 'literal', value: 1 },
          to: { kind: 'variable', name: '$x' }
        },
        {
          id: 's1', parentIntentId: null, createdAt: 4000,
          kind: 'skip_n', n: 1
        },
        {
          id: 'c1', parentIntentId: null, createdAt: 5000,
          kind: 'conditional_skip',
          conditionAddr: { kind: 'variable', name: '$x' },
          n: 1
        }
      ]

      for (const e of entries) {
        expect(e.id).toBeDefined()
        expect(typeof e.id).toBe('string')
        expect(e.parentIntentId).toBeDefined()
        expect(typeof e.createdAt).toBe('number')
        expect(e.createdAt).toBeGreaterThan(0)
      }
    })

    test('parentIntentId 可以是 null（根 entry）', () => {
      const root: StackEntry = {
        id: 'r', parentIntentId: null, createdAt: 1,
        kind: 'move',
        from: { kind: 'literal', value: 1 },
        to: { kind: 'variable', name: '$x' }
      }
      expect(root.parentIntentId).toBeNull()
    })

    test('parentIntentId 可以是 string（子 entry）', () => {
      const child: StackEntry = {
        id: 'c', parentIntentId: 'parent-id', createdAt: 1,
        kind: 'move',
        from: { kind: 'literal', value: 1 },
        to: { kind: 'variable', name: '$x' }
      }
      expect(child.parentIntentId).toBe('parent-id')
    })
  })

  // ============== 状态机字段 ==============
  describe('状态机字段', () => {
    test('OpEntry.status 3 种状态', () => {
      const statuses: OpEntry['status'][] = ['pending', 'running', 'done']
      expect(statuses).toHaveLength(3)
    })

    test('OpEntry 状态转换：pending → running → done', () => {
      const op: OpEntry = {
        id: '1', parentIntentId: null, createdAt: 1,
        kind: 'execute_op',
        operation: 'x', inputs: {}, outputs: {}, status: 'pending'
      }
      expect(op.status).toBe('pending')

      op.status = 'running'
      expect(op.status).toBe('running')

      op.status = 'done'
      expect(op.status).toBe('done')
    })

    test('IntentEntry.phase 4 种状态', () => {
      const phases: IntentEntry['phase'][] = [
        'pending',
        'awaiting_children',
        'done',
        'aborted'
      ]
      expect(phases).toHaveLength(4)
    })

    test('IntentEntry 状态转换：pending → awaiting_children → done', () => {
      const intent: IntentEntry = {
        id: '1', parentIntentId: null, createdAt: 1,
        kind: 'execute_intent',
        intent: { type: 'x', params: {} },
        phase: 'pending', children: []
      }
      expect(intent.phase).toBe('pending')

      intent.phase = 'awaiting_children'
      expect(intent.phase).toBe('awaiting_children')

      intent.phase = 'done'
      expect(intent.phase).toBe('done')
    })

    test('IntentEntry 可以被 aborted（硬错误传播）', () => {
      const intent: IntentEntry = {
        id: '1', parentIntentId: null, createdAt: 1,
        kind: 'execute_intent',
        intent: { type: 'x', params: {} },
        phase: 'awaiting_children', children: []
      }
      intent.phase = 'aborted'
      expect(intent.phase).toBe('aborted')
    })
  })

  // ============== IntentEntry 详细行为 ==============
  describe('IntentEntry 详细行为', () => {
    test('children 数组用于存放编译后的子 entries', () => {
      const child1: MoveEntry = {
        id: 'c1', parentIntentId: 'p', createdAt: 1,
        kind: 'move',
        from: { kind: 'literal', value: 1 },
        to: { kind: 'variable', name: '$x' }
      }
      const child2: OpEntry = {
        id: 'c2', parentIntentId: 'p', createdAt: 2,
        kind: 'execute_op',
        operation: 'x', inputs: {}, outputs: {}, status: 'pending'
      }
      const parent: IntentEntry = {
        id: 'p', parentIntentId: null, createdAt: 0,
        kind: 'execute_intent',
        intent: { type: 'parent', params: {} },
        phase: 'awaiting_children',
        children: [child1, child2]
      }

      expect(parent.children).toHaveLength(2)
      expect(parent.children[0].kind).toBe('move')
      expect(parent.children[1].kind).toBe('execute_op')
    })

    test('intent 可以是 RecognizedIntent 或 StandardIntent', () => {
      const recognized: RecognizedIntent = { type: 'read_file', params: { path: '/x' } }
      const standard: StandardIntent = {
        name: 'read_file',
        description: '...',
        inputs: {},
        outputs: {},
        children: []
      }

      const intent1: IntentEntry = {
        id: '1', parentIntentId: null, createdAt: 0,
        kind: 'execute_intent',
        intent: recognized,
        phase: 'pending', children: []
      }
      const intent2: IntentEntry = {
        id: '2', parentIntentId: null, createdAt: 0,
        kind: 'execute_intent',
        intent: standard,
        phase: 'pending', children: []
      }

      expect(intent1.intent.type).toBe('read_file')
      expect(intent2.intent.name).toBe('read_file')
    })
  })
})