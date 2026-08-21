/**
 * Phase B Tier B05 - 数据处理 ops 测试
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B5
 *
 * 覆盖 5 个 op：
 * - string_replace: 字面量/正则、replace_all、INVALID_REGEX
 * - sort_by: 数字/字符串、升降序、不修改原数组
 * - take_first: 默认 n=1、边界、INVALID_INPUT
 * - increment_counter / decrement_counter: +1/-1、INVALID_INPUT、循环集成
 */

import { describe, expect, test } from 'vitest'
import { l1MainLoop } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { L2Registry } from '../../src/l2/registry.js'
import { isOperationError } from '../../src/l2/errors.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { sortByOp } from '../../src/l2/builtins/sort-by.js'
import { takeFirstOp } from '../../src/l2/builtins/take-first.js'
import { incrementCounterOp } from '../../src/l2/builtins/increment-counter.js'
import { decrementCounterOp } from '../../src/l2/builtins/decrement-counter.js'
import { createProgrammableL3 } from '../../src/mocks/mock-l3.js'

describe('B05: 数据处理 ops', () => {
  // ============== string_replace ==============
  describe('string_replace', () => {
    test('formalSpec', () => {
      expect(stringReplaceOp.name).toBe('string_replace')
      expect(stringReplaceOp.formalSpec.inputs.text.required).toBe(true)
      expect(stringReplaceOp.formalSpec.inputs.find.required).toBe(true)
      expect(stringReplaceOp.formalSpec.inputs.replace.required).toBe(true)
      expect(stringReplaceOp.formalSpec.inputs.regex.required).toBe(false)
      expect(stringReplaceOp.formalSpec.outputs.result.required).toBe(true)
      expect(stringReplaceOp.formalSpec.outputs.count.type).toBe('number')
    })

    test('字面量替换（默认仅第一处）', async () => {
      const result = await stringReplaceOp.execute({
        text: 'hello world hello',
        find: 'hello',
        replace: 'hi'
      })
      expect(result.result).toBe('hi world hello')
      expect(result.count).toBe(1)
    })

    test('字面量全局替换（replace_all=true）', async () => {
      const result = await stringReplaceOp.execute({
        text: 'hello world hello',
        find: 'hello',
        replace: 'hi',
        replace_all: true
      })
      expect(result.result).toBe('hi world hi')
      expect(result.count).toBe(2)
    })

    test('正则替换（仅第一处）', async () => {
      const result = await stringReplaceOp.execute({
        text: 'foo123bar456',
        find: '\\d+',
        replace: '#',
        regex: true
      })
      expect(result.result).toBe('foo#bar456')
      expect(result.count).toBe(1)
    })

    test('正则全局替换', async () => {
      const result = await stringReplaceOp.execute({
        text: 'foo123bar456',
        find: '\\d+',
        replace: '#',
        regex: true,
        replace_all: true
      })
      expect(result.result).toBe('foo#bar#')
      expect(result.count).toBe(2)
    })

    test('未找到 → count=0', async () => {
      const result = await stringReplaceOp.execute({
        text: 'hello',
        find: 'xyz'
      })
      expect(result.result).toBe('hello')
      expect(result.count).toBe(0)
    })

    test('正则语法错误 → INVALID_REGEX', async () => {
      const result = await stringReplaceOp.execute({
        text: 'hello',
        find: '[unclosed',
        replace: 'X',
        regex: true
      })
      expect(isOperationError(result.error)).toBe(true)
      expect((result.error as { code: string }).code).toBe('INVALID_REGEX')
    })

    test('集成：move text → string_replace → result', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        { id: 'mv_t', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: 'hello world' },
          to: { kind: 'internal', name: '$r0' } },
        { id: 'mv_f', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: 'world' },
          to: { kind: 'internal', name: '$r1' } },
        { id: 'mv_r', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: 'there' },
          to: { kind: 'internal', name: '$r2' } },
        { id: 'sr', parentIntentId: null, createdAt: 0, kind: 'execute_op',
          operation: 'string_replace',
          inputs: {
            text: { kind: 'internal', name: '$r0' },
            find: { kind: 'internal', name: '$r1' },
            replace: { kind: 'internal', name: '$r2' }
          },
          outputs: {
            result: { kind: 'internal', name: '$r_result' },
            count: { kind: 'internal', name: '$r_count' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending' }
      ])
      const reg = new L2Registry(); reg.register(stringReplaceOp)
      const state = createInitialState(reg, l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_result')).toBe('hello there')
      expect(state.internalStore.get('$r_count')).toBe(1)
    })
  })

  // ============== sort_by ==============
  describe('sort_by', () => {
    test('formalSpec', () => {
      expect(sortByOp.name).toBe('sort_by')
      expect(sortByOp.formalSpec.inputs.items.required).toBe(true)
      expect(sortByOp.formalSpec.inputs.by.required).toBe(true)
    })

    test('按数字字段升序排序', async () => {
      const items = [
        { name: 'b', age: 30 },
        { name: 'a', age: 20 },
        { name: 'c', age: 25 }
      ]
      const result = await sortByOp.execute({ items, by: 'age' })
      const sorted = result.sorted as Array<{ name: string; age: number }>
      expect(sorted.map(s => s.name)).toEqual(['a', 'c', 'b'])
      expect(result.count).toBe(3)
    })

    test('按数字字段降序（desc=true）', async () => {
      const items = [{ x: 1 }, { x: 3 }, { x: 2 }]
      const result = await sortByOp.execute({ items, by: 'x', desc: true })
      const sorted = result.sorted as Array<{ x: number }>
      expect(sorted.map(s => s.x)).toEqual([3, 2, 1])
    })

    test('按字符串字段排序', async () => {
      const items = [{ k: 'banana' }, { k: 'apple' }, { k: 'cherry' }]
      const result = await sortByOp.execute({ items, by: 'k' })
      const sorted = result.sorted as Array<{ k: string }>
      expect(sorted.map(s => s.k)).toEqual(['apple', 'banana', 'cherry'])
    })

    test('不修改原数组', async () => {
      const original = [{ x: 3 }, { x: 1 }, { x: 2 }]
      const items = [...original]
      await sortByOp.execute({ items, by: 'x' })
      expect(items).toEqual(original)
    })

    test('INVALID_INPUT：非数组', async () => {
      const result = await sortByOp.execute({
        items: 'not an array' as unknown as never[],
        by: 'x'
      })
      expect(isOperationError(result.error)).toBe(true)
      expect((result.error as { code: string }).code).toBe('INVALID_INPUT')
      expect(result.count).toBe(0)
    })

    test('空数组', async () => {
      const result = await sortByOp.execute({ items: [], by: 'x' })
      expect(result.count).toBe(0)
      expect(result.sorted).toEqual([])
    })

    test('集成：sort + take_first（top 3）', async () => {
      const l3 = createProgrammableL3()
      // 顺序：先 mv_items + mv_by + mv_n（输入准备），再 sort + take（处理）
      l3.setChildren('plan', [
        { id: 'mv_items', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: [{ s: 30 }, { s: 10 }, { s: 20 }, { s: 40 }, { s: 5 }] },
          to: { kind: 'internal', name: '$r_items' } },
        { id: 'mv_by', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: 's' },
          to: { kind: 'internal', name: '$r_by' } },
        { id: 'mv_n', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: 3 },
          to: { kind: 'internal', name: '$r_n' } },
        { id: 'sort', parentIntentId: null, createdAt: 0, kind: 'execute_op',
          operation: 'sort_by',
          inputs: {
            items: { kind: 'internal', name: '$r_items' },
            by: { kind: 'internal', name: '$r_by' }
          },
          outputs: {
            sorted: { kind: 'internal', name: '$r_sorted' },
            count: { kind: 'internal', name: '$r_sort_count' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending' },
        { id: 'take', parentIntentId: null, createdAt: 0, kind: 'execute_op',
          operation: 'take_first',
          inputs: {
            items: { kind: 'internal', name: '$r_sorted' },
            n: { kind: 'internal', name: '$r_n' }
          },
          outputs: {
            taken: { kind: 'internal', name: '$r_taken' },
            count: { kind: 'internal', name: '$r_take_count' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending' }
      ])
      const reg = new L2Registry(); reg.register(sortByOp); reg.register(takeFirstOp)
      const state = createInitialState(reg, l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      const taken = state.internalStore.get('$r_taken') as Array<{ s: number }>
      expect(taken.map(t => t.s)).toEqual([5, 10, 20])
      expect(state.internalStore.get('$r_take_count')).toBe(3)
    })
  })

  // ============== take_first ==============
  describe('take_first', () => {
    test('formalSpec', () => {
      expect(takeFirstOp.name).toBe('take_first')
      expect(takeFirstOp.formalSpec.inputs.n.required).toBe(false)
    })

    test('默认 n=1 → 取第一个', async () => {
      const result = await takeFirstOp.execute({ items: [10, 20, 30] })
      expect(result.taken).toEqual([10])
      expect(result.count).toBe(1)
    })

    test('n=3 → 取前 3 个', async () => {
      const result = await takeFirstOp.execute({ items: [1, 2, 3, 4, 5], n: 3 })
      expect(result.taken).toEqual([1, 2, 3])
      expect(result.count).toBe(3)
    })

    test('n > length → 返回全部', async () => {
      const result = await takeFirstOp.execute({ items: [1, 2], n: 10 })
      expect(result.taken).toEqual([1, 2])
      expect(result.count).toBe(2)
    })

    test('n <= 0 → 空数组', async () => {
      const result = await takeFirstOp.execute({ items: [1, 2, 3], n: 0 })
      expect(result.taken).toEqual([])
      expect(result.count).toBe(0)
    })

    test('不修改原数组', async () => {
      const original = [1, 2, 3]
      const items = [...original]
      await takeFirstOp.execute({ items, n: 1 })
      expect(items).toEqual(original)
    })

    test('INVALID_INPUT：非数组', async () => {
      const result = await takeFirstOp.execute({
        items: 42 as unknown as never[]
      })
      expect(isOperationError(result.error)).toBe(true)
      expect((result.error as { code: string }).code).toBe('INVALID_INPUT')
    })

    test('集成', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        { id: 'mv_i', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: [1, 2, 3, 4] },
          to: { kind: 'internal', name: '$r0' } },
        { id: 'mv_n', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: 2 },
          to: { kind: 'internal', name: '$r1' } },
        { id: 'tf', parentIntentId: null, createdAt: 0, kind: 'execute_op',
          operation: 'take_first',
          inputs: {
            items: { kind: 'internal', name: '$r0' },
            n: { kind: 'internal', name: '$r1' }
          },
          outputs: {
            taken: { kind: 'internal', name: '$r_taken' },
            count: { kind: 'internal', name: '$r_count' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending' }
      ])
      const reg = new L2Registry(); reg.register(takeFirstOp)
      const state = createInitialState(reg, l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_taken')).toEqual([1, 2])
      expect(state.internalStore.get('$r_count')).toBe(2)
    })
  })

  // ============== increment_counter / decrement_counter ==============
  describe('counter ops', () => {
    test('increment: 5 → 6', async () => {
      const result = await incrementCounterOp.execute({ value: 5 })
      expect(result.new_value).toBe(6)
      expect(result.error).toBeNull()
    })

    test('increment: 0 → 1', async () => {
      const result = await incrementCounterOp.execute({ value: 0 })
      expect(result.new_value).toBe(1)
    })

    test('increment: INVALID_INPUT (字符串)', async () => {
      const result = await incrementCounterOp.execute({
        value: 'not a number' as unknown as number
      })
      expect(isOperationError(result.error)).toBe(true)
      expect((result.error as { code: string }).code).toBe('INVALID_INPUT')
    })

    test('decrement: 5 → 4', async () => {
      const result = await decrementCounterOp.execute({ value: 5 })
      expect(result.new_value).toBe(4)
    })

    test('decrement: INVALID_INPUT', async () => {
      const result = await decrementCounterOp.execute({
        value: null as unknown as number
      })
      expect(isOperationError(result.error)).toBe(true)
    })

    test('集成：循环计数（inc + 覆盖）', async () => {
      // 模拟一次循环计数：value=2 → inc → new_value=3 → 覆盖回 value
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        { id: 'init', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: 2 },
          to: { kind: 'internal', name: '$r_count' } },
        { id: 'inc', parentIntentId: null, createdAt: 0, kind: 'execute_op',
          operation: 'increment_counter',
          inputs: { value: { kind: 'internal', name: '$r_count' } },
          outputs: {
            new_value: { kind: 'internal', name: '$r_new' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending' },
        { id: 'overwrite', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'internal', name: '$r_new' },
          to: { kind: 'internal', name: '$r_count' } }
      ])
      const reg = new L2Registry(); reg.register(incrementCounterOp); reg.register(decrementCounterOp)
      const state = createInitialState(reg, l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      // value 2 → inc → 3 → 覆盖回 $r_count → 3
      expect(state.internalStore.get('$r_count')).toBe(3)
      expect(state.internalStore.get('$r_new')).toBe(3)
    })
  })
})