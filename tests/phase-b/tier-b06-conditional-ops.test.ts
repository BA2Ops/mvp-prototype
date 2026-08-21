/**
 * Phase B Tier B06 - 条件计算 op 族测试
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2.1
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B6
 *
 * 覆盖 12 个 op（7 文件）：
 * - equals / not_equals（equals.ts）
 * - gt / lt（gt.ts）
 * - gte / lte（gte.ts）
 * - and / or / not（and.ts）
 * - is_truthy / is_empty（is-truthy.ts）
 * - extract_error_code（extract-error-code.ts）
 *
 * 集成测试：
 * - 循环条件：gte($count, 3) 模拟 doc 10 §6.5
 * - 错误码提取 + 组合判断
 */

import { describe, expect, test } from 'vitest'
import { l1MainLoop } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { L2Registry } from '../../src/l2/registry.js'
import { isOperationError } from '../../src/l2/errors.js'
import { equalsOp, notEqualsOp } from '../../src/l2/builtins/equals.js'
import { gtOp, ltOp } from '../../src/l2/builtins/gt.js'
import { gteOp, lteOp } from '../../src/l2/builtins/gte.js'
import { andOp, orOp, notOp } from '../../src/l2/builtins/and.js'
import { isTruthyOp, isEmptyOp } from '../../src/l2/builtins/is-truthy.js'
import { extractErrorCodeOp } from '../../src/l2/builtins/extract-error-code.js'
import { createProgrammableL3 } from '../../src/mocks/mock-l3.js'
import type { Intent } from '../../src/l1/types.js'

/** 构造 execute_op intent 的 helper */
function mkExecOp(
  id: string,
  op: string,
  inputs: Record<string, Intent['inputs'] extends Record<string, infer V> | undefined ? never : never> = {} as never,
  outputNames: Record<string, string> = {}
): Intent {
  return {
    id,
    parentIntentId: null,
    createdAt: 0,
    kind: 'execute_op',
    operation: op,
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([k, v]) => [k, v as never])
    ),
    outputs: Object.fromEntries(
      Object.entries(outputNames).map(([k, v]) => [k, { kind: 'internal', name: v } as never])
    ),
    status: 'pending'
  }
}

/** 构造 move intent */
function mkMove(id: string, value: unknown, target: string): Intent {
  return {
    id,
    parentIntentId: null,
    createdAt: 0,
    kind: 'move',
    from: { kind: 'literal', value },
    to: { kind: 'internal', name: target }
  }
}

/** 注册所有条件 op */
function buildRegistry(): L2Registry {
  const r = new L2Registry()
  r.register(equalsOp); r.register(notEqualsOp)
  r.register(gtOp); r.register(ltOp)
  r.register(gteOp); r.register(lteOp)
  r.register(andOp); r.register(orOp); r.register(notOp)
  r.register(isTruthyOp); r.register(isEmptyOp)
  r.register(extractErrorCodeOp)
  return r
}

describe('B06: 条件计算 op 族', () => {
  // ============== equals / not_equals ==============
  describe('equals / not_equals', () => {
    test('formalSpec', () => {
      expect(equalsOp.name).toBe('equals')
      expect(equalsOp.formalSpec.outputs.result.type).toBe('boolean')
      expect(notEqualsOp.name).toBe('not_equals')
    })

    test('数字相等', async () => {
      const r = await equalsOp.execute({ a: 5, b: 5 })
      expect(r.result).toBe(true)
    })

    test('数字不等', async () => {
      const r = await equalsOp.execute({ a: 5, b: 6 })
      expect(r.result).toBe(false)
    })

    test('字符串相等', async () => {
      const r = await equalsOp.execute({ a: 'foo', b: 'foo' })
      expect(r.result).toBe(true)
    })

    test('严格相等（无类型转换）', async () => {
      const r = await equalsOp.execute({ a: 5, b: '5' })
      expect(r.result).toBe(false)
    })

    test('null === undefined', async () => {
      const r = await equalsOp.execute({ a: null, b: undefined })
      expect(r.result).toBe(false)
    })

    test('not_equals: 5 != 6', async () => {
      const r = await notEqualsOp.execute({ a: 5, b: 6 })
      expect(r.result).toBe(true)
    })
  })

  // ============== gt / lt ==============
  describe('gt / lt', () => {
    test('formalSpec', () => {
      expect(gtOp.name).toBe('gt')
      expect(ltOp.name).toBe('lt')
    })

    test('数字 5 > 3', async () => {
      expect((await gtOp.execute({ a: 5, b: 3 })).result).toBe(true)
      expect((await gtOp.execute({ a: 3, b: 5 })).result).toBe(false)
    })

    test('字符串 "b" > "a"', async () => {
      expect((await gtOp.execute({ a: 'b', b: 'a' })).result).toBe(true)
    })

    test('lt: 3 < 5', async () => {
      expect((await ltOp.execute({ a: 3, b: 5 })).result).toBe(true)
    })

    test('INVALID_INPUT: 数字 vs 字符串', async () => {
      const r = await gtOp.execute({ a: 5, b: '5' })
      expect(isOperationError(r.error)).toBe(true)
      expect((r.error as { code: string }).code).toBe('INVALID_INPUT')
    })
  })

  // ============== gte / lte ==============
  describe('gte / lte', () => {
    test('formalSpec', () => {
      expect(gteOp.name).toBe('gte')
      expect(lteOp.name).toBe('lte')
    })

    test('gte: 5 >= 5', async () => {
      expect((await gteOp.execute({ a: 5, b: 5 })).result).toBe(true)
      expect((await gteOp.execute({ a: 5, b: 3 })).result).toBe(true)
      expect((await gteOp.execute({ a: 3, b: 5 })).result).toBe(false)
    })

    test('lte: 5 <= 5', async () => {
      expect((await lteOp.execute({ a: 5, b: 5 })).result).toBe(true)
      expect((await lteOp.execute({ a: 3, b: 5 })).result).toBe(true)
    })

    test('gte 字符串 "b" >= "a"', async () => {
      expect((await gteOp.execute({ a: 'b', b: 'a' })).result).toBe(true)
    })

    test('循环条件模式：$count >= 3 (doc 10 §6.5)', async () => {
      const r = await gteOp.execute({ a: 3, b: 3 })
      expect(r.result).toBe(true)
    })
  })

  // ============== and / or / not ==============
  describe('and / or / not', () => {
    test('formalSpec', () => {
      expect(andOp.name).toBe('and')
      expect(orOp.name).toBe('or')
      expect(notOp.name).toBe('not')
    })

    test('and 两 true', async () => {
      const r = await andOp.execute({ a: true, b: true })
      expect(r.result).toBe(true)
    })

    test('and 含 false', async () => {
      const r = await andOp.execute({ a: true, b: false })
      expect(r.result).toBe(false)
    })

    test('or 含 true', async () => {
      const r = await orOp.execute({ a: false, b: true })
      expect(r.result).toBe(true)
    })

    test('or 全 false', async () => {
      const r = await orOp.execute({ a: false, b: false })
      expect(r.result).toBe(false)
    })

    test('and 短路：a false 即返', async () => {
      const r = await andOp.execute({ a: false, b: true })
      expect(r.result).toBe(false)
    })

    test('not true → false', async () => {
      const r = await notOp.execute({ value: true })
      expect(r.result).toBe(false)
    })

    test('not 0 → true', async () => {
      const r = await notOp.execute({ value: 0 })
      expect(r.result).toBe(true)
    })
  })

  // ============== is_truthy / is_empty ==============
  describe('is_truthy / is_empty', () => {
    test('formalSpec', () => {
      expect(isTruthyOp.name).toBe('is_truthy')
      expect(isEmptyOp.name).toBe('is_empty')
    })

    test('is_truthy: 非空字符串', async () => {
      expect((await isTruthyOp.execute({ value: 'hello' })).result).toBe(true)
    })

    test('is_truthy: 空字符串 → false', async () => {
      expect((await isTruthyOp.execute({ value: '' })).result).toBe(false)
    })

    test('is_truthy: 0 → false', async () => {
      expect((await isTruthyOp.execute({ value: 0 })).result).toBe(false)
    })

    test('is_truthy: null → false', async () => {
      expect((await isTruthyOp.execute({ value: null })).result).toBe(false)
    })

    test('is_empty: 空字符串', async () => {
      expect((await isEmptyOp.execute({ value: '' })).result).toBe(true)
    })

    test('is_empty: 空数组', async () => {
      expect((await isEmptyOp.execute({ value: [] })).result).toBe(true)
    })

    test('is_empty: 空对象', async () => {
      expect((await isEmptyOp.execute({ value: {} })).result).toBe(true)
    })

    test('is_empty: 非空数组', async () => {
      expect((await isEmptyOp.execute({ value: [1] })).result).toBe(false)
    })

    test('is_empty: null → true', async () => {
      expect((await isEmptyOp.execute({ value: null })).result).toBe(true)
    })
  })

  // ============== extract_error_code ==============
  describe('extract_error_code', () => {
    test('formalSpec', () => {
      expect(extractErrorCodeOp.name).toBe('extract_error_code')
      expect(extractErrorCodeOp.formalSpec.outputs.code.type).toBe('string')
    })

    test('null → null', async () => {
      const r = await extractErrorCodeOp.execute({ error_obj: null })
      expect(r.code).toBeNull()
    })

    test('OperationError 对象 → code', async () => {
      const r = await extractErrorCodeOp.execute({
        error_obj: { code: 'ENOENT', message: 'not found', op: 'file_read' }
      })
      expect(r.code).toBe('ENOENT')
    })

    test('非 OperationError（无 code 字段）→ null', async () => {
      const r = await extractErrorCodeOp.execute({ error_obj: { foo: 'bar' } })
      expect(r.code).toBeNull()
    })

    test('code 非字符串 → null', async () => {
      const r = await extractErrorCodeOp.execute({
        error_obj: { code: 42 }
      })
      expect(r.code).toBeNull()
    })
  })

  // ============== 集成测试 ==============
  describe('集成', () => {
    test('循环条件：gte($count, 3) 模拟 doc 10 §6.5', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        mkMove('mv_c', 3, '$r_count'),
        mkMove('mv_m', 3, '$r_max'),
        mkExecOp('check', 'gte',
          { a: { kind: 'internal', name: '$r_count' }, b: { kind: 'internal', name: '$r_max' } },
          { result: '$r_cond' }
        )
      ])
      const state = createInitialState(buildRegistry(), l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_cond')).toBe(true)
    })

    test('复合判断：$count >= 3 AND $status == "ok"', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        mkMove('mv_c', 5, '$r_count'),
        mkMove('mv_m', 3, '$r_max'),
        mkMove('mv_s', 'ok', '$r_status'),
        mkMove('mv_e', 'ok', '$r_expected'),
        mkExecOp('check_count', 'gte',
          { a: { kind: 'internal', name: '$r_count' }, b: { kind: 'internal', name: '$r_max' } },
          { result: '$r_cond1' }
        ),
        mkExecOp('check_status', 'equals',
          { a: { kind: 'internal', name: '$r_status' }, b: { kind: 'internal', name: '$r_expected' } },
          { result: '$r_cond2' }
        ),
        mkExecOp('combine', 'and',
          { a: { kind: 'internal', name: '$r_cond1' }, b: { kind: 'internal', name: '$r_cond2' } },
          { result: '$r_final' }
        )
      ])
      const state = createInitialState(buildRegistry(), l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_final')).toBe(true)
    })

    test('错误码提取：extract_error_code + equals(ENOENT)', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        {
          id: 'mv_err', parentIntentId: null, createdAt: 0, kind: 'move',
          from: { kind: 'literal', value: { code: 'ENOENT', message: 'not found', op: 'file_read' } },
          to: { kind: 'internal', name: '$r_err' }
        },
        mkExecOp('extract', 'extract_error_code',
          { error_obj: { kind: 'internal', name: '$r_err' } },
          { code: '$r_code' }
        ),
        mkMove('mv_enoent', 'ENOENT', '$r_enoent'),
        mkExecOp('is_enoent', 'equals',
          { a: { kind: 'internal', name: '$r_code' }, b: { kind: 'internal', name: '$r_enoent' } },
          { result: '$r_is_enoent' }
        )
      ])
      const state = createInitialState(buildRegistry(), l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_code')).toBe('ENOENT')
      expect(state.internalStore.get('$r_is_enoent')).toBe(true)
    })

    test('not_equals: 检查 error 不为 null', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        mkMove('mv_null', null, '$r_null'),
        mkMove('mv_null2', null, '$r_null2'),
        mkExecOp('check', 'not_equals',
          { a: { kind: 'internal', name: '$r_null' }, b: { kind: 'internal', name: '$r_null2' } },
          { result: '$r_has_error' }
        )
      ])
      const state = createInitialState(buildRegistry(), l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_has_error')).toBe(false)
    })
  })
})