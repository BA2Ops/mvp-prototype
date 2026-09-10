/**
 * Phase B Tier B08 - evaluate_collection 集合表达式求值测试
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 *
 * 覆盖:
 * - 基础运算符:sort/filter/map/take/slice/unique/concat/length/contains/head/flatten
 * - 聚合运算符:group_by/count_by
 * - 管道语义:pipe 多阶段链式处理
 * - 错误处理:INVALID_INPUT、VARIABLE_NOT_FOUND
 * - 集成:l1MainLoop + evaluate_collection
 */

import { describe, expect, test } from 'vitest'
import { l1MainLoop } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { L2Registry } from '../../src/l2/registry.js'
import { isOperationError } from '../../src/l2/errors.js'
import { evaluateCollectionOp } from '../../src/l2/builtins/evaluate-collection.js'
import type { CollectionExpr } from '../../src/l2/builtins/evaluate-collection.js'
import { createProgrammableL3 } from '../../src/mocks/mock-l3.js'

// ============== 辅助 ==============

async function evalCollection(expr: CollectionExpr) {
  // evaluate_collection 需要 state 来读 var,这里用 literal 表达式不需要 var 读取
  // 但 execute 仍然要求 state,所以创建一个最小化的 state
  const reg = new L2Registry()
  reg.register(evaluateCollectionOp)
  const l3 = createProgrammableL3()
  const state = createInitialState(reg, l3)
  return evaluateCollectionOp.execute({ expr }, state)
}

async function evalCollectionWithState(expr: CollectionExpr, env: Record<string, string> = {}) {
  const reg = new L2Registry()
  reg.register(evaluateCollectionOp)
  const l3 = createProgrammableL3()
  l3.setChildren('plan', [
    { id: 'mv_expr', parentIntentId: null, createdAt: 0, kind: 'move',
      from: { kind: 'literal', value: expr }, to: { kind: 'internal', name: '$r0' } },
    { id: 'mv_env', parentIntentId: null, createdAt: 0, kind: 'move',
      from: { kind: 'literal', value: env }, to: { kind: 'internal', name: '$r_env' } },
    { id: 'ev', parentIntentId: null, createdAt: 0, kind: 'execute_op',
      operation: 'evaluate_collection',
      inputs: {
        expr: { kind: 'internal', name: '$r0' },
        env: { kind: 'internal', name: '$r_env' }
      },
      outputs: {
        result: { kind: 'internal', name: '$r_result' },
        count: { kind: 'internal', name: '$r_count' },
        error: { kind: 'internal', name: '$r_err' }
      },
      status: 'pending' }
  ])
  const state = createInitialState(reg, l3)
  await l1MainLoop({ type: 'plan', params: {} }, state)
  return {
    result: state.internalStore.get('$r_result'),
    count: state.internalStore.get('$r_count'),
    error: state.internalStore.get('$r_err')
  }
}

const lit = (value: unknown): CollectionExpr => ({ type: 'literal', value: value as never })
const v = (name: string): CollectionExpr => ({ type: 'var', name })
const op = (name: string, ...args: CollectionExpr[]): CollectionExpr =>
  ({ type: 'op', name: name as never, args })

// ============== 测试 ==============

describe('B08: evaluate_collection', () => {

  describe('formalSpec', () => {
    test('基础字段', () => {
      expect(evaluateCollectionOp.name).toBe('evaluate_collection')
      expect(evaluateCollectionOp.formalSpec.inputs.expr.required).toBe(true)
      expect(evaluateCollectionOp.formalSpec.inputs.env.required).toBe(false)
      expect(evaluateCollectionOp.formalSpec.outputs.result.required).toBe(true)
      expect(evaluateCollectionOp.formalSpec.outputs.count.type).toBe('number')
      expect(evaluateCollectionOp.formalSpec.outputs.error.register).toBe('$r_err')
    })
  })

  describe('sort', () => {
    test('按数字字段升序', async () => {
      const r = await evalCollection(
        op('sort', lit([{ x: 3 }, { x: 1 }, { x: 2 }]), lit('x'))
      )
      expect((r.result as Array<{ x: number }>).map(i => i.x)).toEqual([1, 2, 3])
      expect(r.count).toBe(3)
    })

    test('按数字字段降序', async () => {
      const r = await evalCollection(
        op('sort', lit([{ x: 1 }, { x: 3 }, { x: 2 }]), lit('x'), lit(true))
      )
      expect((r.result as Array<{ x: number }>).map(i => i.x)).toEqual([3, 2, 1])
    })

    test('按字符串字段排序', async () => {
      const r = await evalCollection(
        op('sort', lit([{ k: 'banana' }, { k: 'apple' }, { k: 'cherry' }]), lit('k'))
      )
      expect((r.result as Array<{ k: string }>).map(i => i.k)).toEqual(['apple', 'banana', 'cherry'])
    })

    test('不修改原数组', async () => {
      const original = [{ x: 3 }, { x: 1 }, { x: 2 }]
      const r = await evalCollection(op('sort', lit(original), lit('x')))
      expect(original).toEqual([{ x: 3 }, { x: 1 }, { x: 2 }])
      expect((r.result as Array<{ x: number }>).map(i => i.x)).toEqual([1, 2, 3])
    })
  })

  describe('filter', () => {
    test('按字段值过滤', async () => {
      const r = await evalCollection(
        op('filter', lit([{ s: 'a' }, { s: 'b' }, { s: 'a' }]), lit('s'), lit('a'))
      )
      expect(r.count).toBe(2)
      expect((r.result as Array<{ s: string }>).map(i => i.s)).toEqual(['a', 'a'])
    })

    test('无匹配 → 空数组', async () => {
      const r = await evalCollection(
        op('filter', lit([{ x: 1 }, { x: 2 }]), lit('x'), lit(99))
      )
      expect(r.result).toEqual([])
      expect(r.count).toBe(0)
    })
  })

  describe('map (字段提取)', () => {
    test('提取字段', async () => {
      const r = await evalCollection(
        op('map', lit([{ name: 'a', age: 1 }, { name: 'b', age: 2 }]), lit('name'))
      )
      expect(r.result).toEqual(['a', 'b'])
      expect(r.count).toBe(2)
    })

    test('字段不存在 → null', async () => {
      const r = await evalCollection(
        op('map', lit([{ a: 1 }, { b: 2 }]), lit('c'))
      )
      expect(r.result).toEqual([null, null])
    })
  })

  describe('take', () => {
    test('取前 n 个', async () => {
      const r = await evalCollection(op('take', lit([1, 2, 3, 4, 5]), lit(3)))
      expect(r.result).toEqual([1, 2, 3])
      expect(r.count).toBe(3)
    })

    test('n > length → 返回全部', async () => {
      const r = await evalCollection(op('take', lit([1, 2]), lit(10)))
      expect(r.result).toEqual([1, 2])
      expect(r.count).toBe(2)
    })

    test('n <= 0 → 空数组', async () => {
      const r = await evalCollection(op('take', lit([1, 2, 3]), lit(0)))
      expect(r.result).toEqual([])
      expect(r.count).toBe(0)
    })
  })

  describe('slice', () => {
    test('切片 [1, 3)', async () => {
      const r = await evalCollection(op('slice', lit([1, 2, 3, 4, 5]), lit(1), lit(3)))
      expect(r.result).toEqual([2, 3])
      expect(r.count).toBe(2)
    })
  })

  describe('unique', () => {
    test('整体去重', async () => {
      const r = await evalCollection(op('unique', lit([1, 2, 2, 3, 1, 3])))
      expect(r.result).toEqual([1, 2, 3])
      expect(r.count).toBe(3)
    })

    test('按字段去重', async () => {
      const r = await evalCollection(
        op('unique', lit([{ k: 'a' }, { k: 'b' }, { k: 'a' }]), lit('k'))
      )
      expect(r.count).toBe(2)
      expect((r.result as Array<{ k: string }>).map(i => i.k)).toEqual(['a', 'b'])
    })
  })

  describe('group_by', () => {
    test('按字段分组', async () => {
      const r = await evalCollection(
        op('group_by', lit([{ g: 'a', v: 1 }, { g: 'b', v: 2 }, { g: 'a', v: 3 }]), lit('g'))
      )
      expect(r.count).toBe(2)
      const groups = r.result as Record<string, unknown[]>
      expect(groups.a).toEqual([{ g: 'a', v: 1 }, { g: 'a', v: 3 }])
      expect(groups.b).toEqual([{ g: 'b', v: 2 }])
    })
  })

  describe('count_by', () => {
    test('按字段计数', async () => {
      const r = await evalCollection(
        op('count_by', lit([{ g: 'a' }, { g: 'b' }, { g: 'a' }]), lit('g'))
      )
      expect(r.result).toEqual({ a: 2, b: 1 })
      expect(r.count).toBe(2)
    })
  })

  describe('concat', () => {
    test('拼接多个列表', async () => {
      const r = await evalCollection(op('concat', lit([1, 2]), lit([3, 4]), lit([5])))
      expect(r.result).toEqual([1, 2, 3, 4, 5])
      expect(r.count).toBe(5)
    })

    test('空参数 → 空数组', async () => {
      const r = await evalCollection(op('concat'))
      expect(r.result).toEqual([])
      expect(r.count).toBe(0)
    })
  })

  describe('length', () => {
    test('列表长度', async () => {
      const r = await evalCollection(op('length', lit([1, 2, 3])))
      expect(r.result).toBe(3)
      expect(r.count).toBe(0)
    })

    test('字符串长度', async () => {
      const r = await evalCollection(op('length', lit('hello')))
      expect(r.result).toBe(5)
    })
  })

  describe('contains', () => {
    test('包含元素', async () => {
      const r = await evalCollection(op('contains', lit([1, 2, 3]), lit(2)))
      expect(r.result).toBe(true)
    })

    test('不包含元素', async () => {
      const r = await evalCollection(op('contains', lit([1, 2, 3]), lit(99)))
      expect(r.result).toBe(false)
    })
  })

  describe('head', () => {
    test('首元素', async () => {
      const r = await evalCollection(op('head', lit([1, 2, 3])))
      expect(r.result).toBe(1)
    })

    test('空数组 → null', async () => {
      const r = await evalCollection(op('head', lit([])))
      expect(r.result).toBe(null)
    })
  })

  describe('flatten', () => {
    test('展平一层', async () => {
      const r = await evalCollection(op('flatten', lit([[1, 2], [3, 4], [5]])))
      expect(r.result).toEqual([1, 2, 3, 4, 5])
      expect(r.count).toBe(5)
    })

    test('混合元素', async () => {
      const r = await evalCollection(op('flatten', lit([[1, 2], 3, [4]])))
      expect(r.result).toEqual([1, 2, 3, 4])
    })
  })

  describe('pipe (管道)', () => {
    test('sort → take (top 3)', async () => {
      const expr: CollectionExpr = {
        type: 'pipe',
        source: lit([{ s: 30 }, { s: 10 }, { s: 20 }, { s: 40 }, { s: 5 }]),
        stages: [
          { op: 'sort', args: [lit('s')] },
          { op: 'take', args: [lit(3)] }
        ]
      }
      const r = await evalCollection(expr)
      expect((r.result as Array<{ s: number }>).map(i => i.s)).toEqual([5, 10, 20])
      expect(r.count).toBe(3)
    })

    test('sort → filter → take', async () => {
      const expr: CollectionExpr = {
        type: 'pipe',
        source: lit([{ x: 1, t: 'a' }, { x: 2, t: 'b' }, { x: 3, t: 'a' }, { x: 4, t: 'a' }]),
        stages: [
          { op: 'sort', args: [lit('x'), lit(true)] },
          { op: 'filter', args: [lit('t'), lit('a')] },
          { op: 'take', args: [lit(2)] }
        ]
      }
      const r = await evalCollection(expr)
      expect((r.result as Array<{ x: number }>).map(i => i.x)).toEqual([4, 3])
      expect(r.count).toBe(2)
    })

    test('map → unique (字段提取后去重)', async () => {
      const expr: CollectionExpr = {
        type: 'pipe',
        source: lit([{ k: 'a' }, { k: 'b' }, { k: 'a' }, { k: 'c' }, { k: 'b' }]),
        stages: [
          { op: 'map', args: [lit('k')] },
          { op: 'unique', args: [] }
        ]
      }
      const r = await evalCollection(expr)
      expect(r.result).toEqual(['a', 'b', 'c'])
      expect(r.count).toBe(3)
    })
  })

  describe('var 读取', () => {
    test('从寄存器读取列表', async () => {
      const expr: CollectionExpr = op('sort', v('$r_items'), lit('x'))
      const r = await evalCollectionWithState(expr)
      // $r_items 未设置 → VARIABLE_NOT_FOUND
      expect(isOperationError(r.error)).toBe(true)
    })
  })

  describe('错误处理', () => {
    test('sort 非数组 → INVALID_INPUT', async () => {
      const r = await evalCollection(op('sort', lit('not array'), lit('x')))
      expect(isOperationError(r.error)).toBe(true)
      expect((r.error as { code: string }).code).toBe('INVALID_INPUT')
    })

    test('filter 参数不足 → INVALID_INPUT', async () => {
      const r = await evalCollection(op('filter', lit([1, 2])))
      expect(isOperationError(r.error)).toBe(true)
      expect((r.error as { code: string }).code).toBe('INVALID_INPUT')
    })

    test('未知 op → INVALID_INPUT', async () => {
      const r = await evalCollection(op('unknown_op', lit([1, 2])))
      expect(isOperationError(r.error)).toBe(true)
      expect((r.error as { code: string }).code).toBe('INVALID_INPUT')
    })
  })

  describe('集成:l1MainLoop', () => {
    test('sort + take 管道', async () => {
      const expr: CollectionExpr = {
        type: 'pipe',
        source: v('$r_items'),
        stages: [
          { op: 'sort', args: [lit('s')] },
          { op: 'take', args: [lit(2)] }
        ]
      }
      const reg = new L2Registry()
      reg.register(evaluateCollectionOp)
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        { id: 'mv_items', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: [{ s: 30 }, { s: 10 }, { s: 20 }] },
          to: { kind: 'internal', name: '$r_items' } },
        { id: 'mv_expr', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: expr }, to: { kind: 'internal', name: '$r0' } },
        { id: 'mv_env', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: { items: '$r_items' } },
          to: { kind: 'internal', name: '$r_env' } },
        { id: 'ev', parentIntentId: null, createdAt: 0, kind: 'execute_op',
          operation: 'evaluate_collection',
          inputs: {
            expr: { kind: 'internal', name: '$r0' },
            env: { kind: 'internal', name: '$r_env' }
          },
          outputs: {
            result: { kind: 'internal', name: '$r_result' },
            count: { kind: 'internal', name: '$r_count' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending' }
      ])
      const state = createInitialState(reg, l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      const result = state.internalStore.get('$r_result') as Array<{ s: number }>
      expect(result.map(i => i.s)).toEqual([10, 20])
      expect(state.internalStore.get('$r_count')).toBe(2)
    })
  })
})
