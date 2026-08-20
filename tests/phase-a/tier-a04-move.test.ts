/**
 * Phase A Tier A4 - move primitive 测试（双区架构版）
 *
 * 验证：
 * 1. 基本 move：各种 Address 组合
 * 2. 跨区 move（literal → internal, internal → public, public → internal 等）
 * 3. 各种 Value 类型
 * 4. 栈行为
 * 5. 错误处理（写入 literal 抛错）
 * 6. 多次执行场景
 */

import { describe, test, expect, beforeEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import { executeMove } from '../../src/l1/primitives/move.js'
import {
  createInitialState,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { createMockL2 } from '../../src/mocks/mock-l2.js'
import { createMockL3 } from '../../src/mocks/mock-l3.js'
import { AddressError } from '../../src/l1/address-resolver.js'
import type { MoveEntry, Address } from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'

const FIXTURES_DIR = 'tests/fixtures/a4'

describe('A4: move primitive（双区架构版）', () => {
  let state: ExecutionState

  beforeEach(async () => {
    const { registry: l2 } = createMockL2()
    const l3 = createMockL3([])
    state = createInitialState(l2, l3)
    await fs.mkdir(FIXTURES_DIR, { recursive: true })
  })

  // ============== 跨区 move ==============
  describe('跨区 move', () => {
    test('literal → internal（常量加载到寄存器）', async () => {
      await executeMove(
        move({ kind: 'literal', value: 'hello' }, { kind: 'internal', name: '$r0' }),
        state
      )

      expect(state.internalStore.get('$r0')).toBe('hello')
    })

    test('internal → public（寄存器保存到业务）', async () => {
      state.internalStore.set('$r0', 'result_data')

      await executeMove(
        move({ kind: 'internal', name: '$r0' }, { kind: 'public', name: 'output_content' }),
        state
      )

      expect(state.publicStore.get('output_content')).toBe('result_data')
    })

    test('public → internal（业务加载到寄存器）', async () => {
      state.publicStore.set('business_var', 'business_value')

      await executeMove(
        move({ kind: 'public', name: 'business_var' }, { kind: 'internal', name: '$r0' }),
        state
      )

      expect(state.internalStore.get('$r0')).toBe('business_value')
    })

    test('file → internal', async () => {
      const filePath = path.join(FIXTURES_DIR, 'source.txt')
      await fs.writeFile(filePath, 'file data')

      await executeMove(
        move({ kind: 'file', path: filePath }, { kind: 'internal', name: '$r0' }),
        state
      )

      expect(state.internalStore.get('$r0')).toBe('file data')
    })

    test('internal → file', async () => {
      const filePath = path.join(FIXTURES_DIR, 'output.txt')
      state.internalStore.set('$r0', 'to write')

      await executeMove(
        move({ kind: 'internal', name: '$r0' }, { kind: 'file', path: filePath }),
        state
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('to write')
    })

    test('public → file（业务数据写到文件）', async () => {
      const filePath = path.join(FIXTURES_DIR, 'business-output.txt')
      state.publicStore.set('config', 'business data')

      await executeMove(
        move({ kind: 'public', name: 'config' }, { kind: 'file', path: filePath }),
        state
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('business data')
    })
  })

  // ============== 同区 move ==============
  describe('同区 move', () => {
    test('internal → internal（寄存器重命名）', async () => {
      state.internalStore.set('$r0', 'value')

      await executeMove(
        move({ kind: 'internal', name: '$r0' }, { kind: 'internal', name: '$r1' }),
        state
      )

      expect(state.internalStore.get('$r0')).toBe('value')  // 不变
      expect(state.internalStore.get('$r1')).toBe('value')
    })

    test('public → public（业务变量重命名）', async () => {
      state.publicStore.set('old_name', 'data')

      await executeMove(
        move({ kind: 'public', name: 'old_name' }, { kind: 'public', name: 'new_name' }),
        state
      )

      expect(state.publicStore.get('old_name')).toBe('data')  // 不变
      expect(state.publicStore.get('new_name')).toBe('data')
    })
  })

  // ============== 各种 Value ==============
  describe('各种 Value 类型', () => {
    test('数字', async () => {
      await executeMove(
        move({ kind: 'literal', value: 42 }, { kind: 'internal', name: '$r0' }),
        state
      )
      expect(state.internalStore.get('$r0')).toBe(42)
    })

    test('null', async () => {
      await executeMove(
        move({ kind: 'literal', value: null }, { kind: 'internal', name: '$r0' }),
        state
      )
      expect(state.internalStore.get('$r0')).toBeNull()
    })

    test('数组和对象', async () => {
      await executeMove(
        move({ kind: 'literal', value: [1, 2, 3] }, { kind: 'internal', name: '$r0' }),
        state
      )
      expect(state.internalStore.get('$r0')).toEqual([1, 2, 3])

      await executeMove(
        move({ kind: 'literal', value: { a: 1 } }, { kind: 'internal', name: '$r1' }),
        state
      )
      expect(state.internalStore.get('$r1')).toEqual({ a: 1 })
    })
  })

  // ============== 栈行为 ==============
  describe('栈行为', () => {
    test('成功时弹栈', async () => {
      state.stack.push({
        id: 'pre', parentIntentId: null, createdAt: 0,
        kind: 'move',
        from: { kind: 'literal', value: 1 },
        to: { kind: 'internal', name: '$r0' }
      })

      const entry = move(
        { kind: 'literal', value: 'hello' },
        { kind: 'internal', name: '$r1' }
      )
      state.stack.push(entry)

      expect(state.stack.length).toBe(2)
      await executeMove(entry, state)
      expect(state.stack.length).toBe(1)
    })

    test('失败时不弹栈', async () => {
      const entry = move(
        { kind: 'internal', name: '$missing' },
        { kind: 'internal', name: '$r0' }
      )
      state.stack.push(entry)

      await expect(executeMove(entry, state)).rejects.toThrow()
      expect(state.stack.length).toBe(1)
    })
  })

  // ============== 错误处理 ==============
  describe('错误处理', () => {
    test('source 不存在抛 AddressError', async () => {
      const entry = move(
        { kind: 'internal', name: '$missing' },
        { kind: 'internal', name: '$r0' }
      )

      await expect(executeMove(entry, state)).rejects.toThrow(AddressError)
    })

    test('source public 不存在抛错', async () => {
      const entry = move(
        { kind: 'public', name: 'missing' },
        { kind: 'internal', name: '$r0' }
      )

      await expect(executeMove(entry, state)).rejects.toThrow(AddressError)
    })

    test('写入 literal 抛错（设计约束）', async () => {
      const entry = move(
        { kind: 'literal', value: 'x' },
        { kind: 'literal', value: 'y' }
      )

      await expect(executeMove(entry, state)).rejects.toThrow(AddressError)
      await expect(executeMove(entry, state)).rejects.toThrow(/literal/)
    })

    test('错误时状态不变（atomic）', async () => {
      state.internalStore.set('$r0', 'pre-existing')

      const entry = move(
        { kind: 'internal', name: '$missing' },
        { kind: 'internal', name: '$r0' }
      )

      await expect(executeMove(entry, state)).rejects.toThrow()

      expect(state.internalStore.get('$r0')).toBe('pre-existing')
    })
  })

  // ============== 多次执行 ==============
  describe('多次执行场景', () => {
    test('链式：literal → $r0 → $r1 → public', async () => {
      // literal → $r0
      await executeMove(
        move({ kind: 'literal', value: 'chain' }, { kind: 'internal', name: '$r0' }),
        state
      )
      // $r0 → $r1
      await executeMove(
        move({ kind: 'internal', name: '$r0' }, { kind: 'internal', name: '$r1' }),
        state
      )
      // $r1 → public
      await executeMove(
        move({ kind: 'internal', name: '$r1' }, { kind: 'public', name: 'final_output' }),
        state
      )

      expect(state.internalStore.get('$r0')).toBe('chain')
      expect(state.internalStore.get('$r1')).toBe('chain')
      expect(state.publicStore.get('final_output')).toBe('chain')
    })

    test('同名寄存器覆盖', async () => {
      state.internalStore.set('$r0', 'v1')
      await executeMove(
        move({ kind: 'internal', name: '$r0' }, { kind: 'internal', name: '$r1' }),
        state
      )
      // 现在 $r1 = v1, $r0 = v1

      state.internalStore.set('$r0', 'v2')
      await executeMove(
        move({ kind: 'internal', name: '$r0' }, { kind: 'internal', name: '$r1' }),
        state
      )
      // 现在 $r1 = v2（被覆盖）

      expect(state.internalStore.get('$r1')).toBe('v2')
    })
  })
})

// ============== Helper ==============
function move(from: Address, to: Address): MoveEntry {
  return {
    id: generateId('m'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'move',
    from,
    to
  }
}