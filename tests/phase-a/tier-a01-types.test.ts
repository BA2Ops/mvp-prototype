/**
 * Phase A Tier A1 - Type 定义层测试（双区架构版）
 *
 * 验证：
 * 1. Value 类型
 * 2. Address 3 种 kind：literal / public / internal（原 file kind 已移除）
 * 3. 5 种 StackEntry 可实例化
 * 4. Discriminated union 类型缩窄
 * 5. BaseEntry 共有字段
 * 6. 状态机字段
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
import { assertNever, isInternalAddress, isPublicAddress } from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'

describe('A1: Type 定义层（双区架构版）', () => {
  // ============== Value ==============
  describe('Value 类型', () => {
    test('支持 7 种基本类型', () => {
      const values: Value[] = [
        'string', 42, true, null, undefined, [1, 2, 3], { key: 'value' }
      ]
      expect(values).toHaveLength(7)
    })
  })

  // ============== Address 3 kinds（原 file kind 已移除）==============
  describe('Address 3 种 kind', () => {
    test('literal', () => {
      const addr: Address = { kind: 'literal', value: 'hello' }
      expect(addr.kind).toBe('literal')
    })

    test('public（业务数据，持久）', () => {
      const addr: Address = { kind: 'public', name: 'output_content' }
      expect(addr.kind).toBe('public')
      expect(isPublicAddress(addr)).toBe(true)
    })

    test('internal（寄存器，瞬态）', () => {
      const addr: Address = { kind: 'internal', name: '$r0' }
      expect(addr.kind).toBe('internal')
      expect(isInternalAddress(addr)).toBe(true)
    })

    test('所有 3 种都是 Address 合法实例', () => {
      const addrs: Address[] = [
        { kind: 'literal', value: 42 },
        { kind: 'public', name: 'business_var' },
        { kind: 'internal', name: '$r0' }
      ]
      expect(addrs).toHaveLength(3)
    })

    test('internal name 通常以 $r 开头（约定）', () => {
      const addrs: Address[] = [
        { kind: 'internal', name: '$r0' },
        { kind: 'internal', name: '$r1' },
        { kind: 'internal', name: '$r_err' }
      ]
      for (const a of addrs) {
        expect(a.name.startsWith('$r')).toBe(true)
      }
    })

    test('public name 通常不以 $r 开头（业务命名）', () => {
      const addrs: Address[] = [
        { kind: 'public', name: 'output_content' },
        { kind: 'public', name: 'user_config' },
        { kind: 'public', name: 'file_path' }
      ]
      for (const a of addrs) {
        expect(a.name.startsWith('$r')).toBe(false)
      }
    })
  })

  // ============== 5 种 StackEntry ==============
  describe('5 种 StackEntry', () => {
    test('OpEntry（inputs/outputs 都是 internal）', () => {
      const entry: OpEntry = {
        id: generateId('op'),
        parentIntentId: null,
        createdAt: now(),
        kind: 'execute_op',
        operation: 'file_read',
        inputs: { file_path: { kind: 'internal', name: '$r0' } },
        outputs: { content: { kind: 'internal', name: '$r1' } },
        status: 'pending'
      }
      expect(entry.kind).toBe('execute_op')
      expect(entry.inputs.file_path.kind).toBe('internal')
      expect(entry.outputs.content.kind).toBe('internal')
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
    })

    test('MoveEntry（from/to 可跨区）', () => {
      const entry: MoveEntry = {
        id: generateId('move'),
        parentIntentId: null,
        createdAt: now(),
        kind: 'move',
        from: { kind: 'public', name: 'business_var' },
        to: { kind: 'internal', name: '$r0' }
      }
      expect(entry.kind).toBe('move')
      expect(entry.from.kind).toBe('public')
      expect(entry.to.kind).toBe('internal')
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
    })

    test('ConditionalSkip（conditionAddr 是 internal）', () => {
      const entry: ConditionalSkip = {
        id: generateId('cs'),
        parentIntentId: null,
        createdAt: now(),
        kind: 'conditional_skip',
        conditionAddr: { kind: 'internal', name: '$r_err' },
        n: 2
      }
      expect(entry.kind).toBe('conditional_skip')
      expect(entry.conditionAddr.kind).toBe('internal')
    })
  })

  // ============== Discriminated Union ==============
  describe('Discriminated Union', () => {
    test('通过 kind 字段缩窄', () => {
      const entry: StackEntry = {
        id: generateId('move'),
        parentIntentId: null,
        createdAt: now(),
        kind: 'move',
        from: { kind: 'literal', value: 'x' },
        to: { kind: 'public', name: 'y' }
      }

      if (entry.kind === 'move') {
        expect(entry.from).toBeDefined()
        expect(entry.to).toBeDefined()
      } else {
        throw new Error('expected move kind')
      }
    })

    test('kinds 数组包含所有 5 种', () => {
      const kinds: StackEntry['kind'][] = [
        'execute_op', 'execute_intent', 'move', 'skip_n', 'conditional_skip'
      ]
      expect(kinds).toHaveLength(5)
    })

    test('assertNever 抛出错误', () => {
      const fakeValue = 'fake' as never
      expect(() => assertNever(fakeValue)).toThrow(/Unhandled/)
    })
  })

  // ============== 状态机 ==============
  describe('状态机字段', () => {
    test('OpEntry.status 3 种', () => {
      const statuses: OpEntry['status'][] = ['pending', 'running', 'done']
      expect(statuses).toHaveLength(3)
    })

    test('IntentEntry.phase 4 种', () => {
      const phases: IntentEntry['phase'][] = ['pending', 'awaiting_children', 'done', 'aborted']
      expect(phases).toHaveLength(4)
    })
  })
})