/**
 * Phase B Tier B05 - 数据处理 ops 测试
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B5
 *
 * 覆盖 4 个 op：
 * - string_replace: 字面量/正则、replace_all、INVALID_REGEX
 * - evaluate_collection: sort/take 等集合运算(原 sort_by/take_first 已迁移)
 * - increment_counter / decrement_counter: +1/-1、INVALID_INPUT、循环集成
 */

import { describe, expect, test } from 'vitest'
import { l1MainLoop } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { L2Registry } from '../../src/l2/registry.js'
import { isOperationError } from '../../src/l2/errors.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { evaluateCollectionOp } from '../../src/l2/builtins/evaluate-collection.js'
import type { CollectionExpr } from '../../src/l2/builtins/evaluate-collection.js'
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

  // ============== evaluate_collection (原 sort_by/take_first 已迁移) ==============
  describe('evaluate_collection', () => {
    // 辅助:构造集合表达式
    const lit = (value: unknown): CollectionExpr => ({ type: 'literal', value: value as never })
    const op = (name: string, ...args: CollectionExpr[]): CollectionExpr =>
      ({ type: 'op', name: name as never, args })

    // 创建带 state 的执行环境(evaluate_collection 需要 state)
    async function evalCollection(expr: CollectionExpr) {
      const reg = new L2Registry()
      reg.register(evaluateCollectionOp)
      const l3 = createProgrammableL3()
      const state = createInitialState(reg, l3)
      return evaluateCollectionOp.execute({ expr }, state)
    }

    test('formalSpec', () => {
      expect(evaluateCollectionOp.name).toBe('evaluate_collection')
      expect(evaluateCollectionOp.formalSpec.inputs.expr.required).toBe(true)
      expect(evaluateCollectionOp.formalSpec.outputs.result.required).toBe(true)
      expect(evaluateCollectionOp.formalSpec.outputs.count.type).toBe('number')
    })

    test('sort: 按数字字段升序排序', async () => {
      const r = await evalCollection(
        op('sort', lit([{ name: 'b', age: 30 }, { name: 'a', age: 20 }, { name: 'c', age: 25 }]), lit('age'))
      )
      const sorted = r.result as Array<{ name: string; age: number }>
      expect(sorted.map(s => s.name)).toEqual(['a', 'c', 'b'])
      expect(r.count).toBe(3)
    })

    test('sort: 按数字字段降序（desc=true）', async () => {
      const r = await evalCollection(
        op('sort', lit([{ x: 1 }, { x: 3 }, { x: 2 }]), lit('x'), lit(true))
      )
      const sorted = r.result as Array<{ x: number }>
      expect(sorted.map(s => s.x)).toEqual([3, 2, 1])
    })

    test('sort: 按字符串字段排序', async () => {
      const r = await evalCollection(
        op('sort', lit([{ k: 'banana' }, { k: 'apple' }, { k: 'cherry' }]), lit('k'))
      )
      const sorted = r.result as Array<{ k: string }>
      expect(sorted.map(s => s.k)).toEqual(['apple', 'banana', 'cherry'])
    })

    test('sort: 不修改原数组', async () => {
      const original = [{ x: 3 }, { x: 1 }, { x: 2 }]
      const r = await evalCollection(op('sort', lit(original), lit('x')))
      expect(original).toEqual([{ x: 3 }, { x: 1 }, { x: 2 }])
      expect((r.result as Array<{ x: number }>).map(s => s.x)).toEqual([1, 2, 3])
    })

    test('sort: INVALID_INPUT（非数组）', async () => {
      const r = await evalCollection(op('sort', lit('not an array'), lit('x')))
      expect(isOperationError(r.error)).toBe(true)
      expect((r.error as { code: string }).code).toBe('INVALID_INPUT')
    })

    test('sort: 空数组', async () => {
      const r = await evalCollection(op('sort', lit([]), lit('x')))
      expect(r.count).toBe(0)
      expect(r.result).toEqual([])
    })

    test('take: 默认行为（n=1 → 取第一个）', async () => {
      const r = await evalCollection(op('take', lit([10, 20, 30]), lit(1)))
      expect(r.result).toEqual([10])
      expect(r.count).toBe(1)
    })

    test('take: n=3 → 取前 3 个', async () => {
      const r = await evalCollection(op('take', lit([1, 2, 3, 4, 5]), lit(3)))
      expect(r.result).toEqual([1, 2, 3])
      expect(r.count).toBe(3)
    })

    test('take: n > length → 返回全部', async () => {
      const r = await evalCollection(op('take', lit([1, 2]), lit(10)))
      expect(r.result).toEqual([1, 2])
      expect(r.count).toBe(2)
    })

    test('take: n <= 0 → 空数组', async () => {
      const r = await evalCollection(op('take', lit([1, 2, 3]), lit(0)))
      expect(r.result).toEqual([])
      expect(r.count).toBe(0)
    })

    test('集成：sort + take 管道（top 3）', async () => {
      const expr: CollectionExpr = {
        type: 'pipe',
        source: lit([{ s: 30 }, { s: 10 }, { s: 20 }, { s: 40 }, { s: 5 }]),
        stages: [
          { op: 'sort', args: [lit('s')] },
          { op: 'take', args: [lit(3)] }
        ]
      }
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        { id: 'mv_expr', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: expr },
          to: { kind: 'internal', name: '$r0' } },
        { id: 'ev', parentIntentId: null, createdAt: 0, kind: 'execute_op',
          operation: 'evaluate_collection',
          inputs: { expr: { kind: 'internal', name: '$r0' } },
          outputs: {
            result: { kind: 'internal', name: '$r_result' },
            count: { kind: 'internal', name: '$r_count' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending' }
      ])
      const reg = new L2Registry(); reg.register(evaluateCollectionOp)
      const state = createInitialState(reg, l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      const result = state.internalStore.get('$r_result') as Array<{ s: number }>
      expect(result.map(t => t.s)).toEqual([5, 10, 20])
      expect(state.internalStore.get('$r_count')).toBe(3)
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