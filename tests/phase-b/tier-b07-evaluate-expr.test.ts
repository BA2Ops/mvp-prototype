/**
 * Phase B Tier B07 - evaluate_expr（表达式求值 op）测试
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2.1（2026-08-20 重构）
 * @see ../../docs/dev-log/2026-08-20-evaluate-expr-redesign.md
 *
 * 覆盖 evaluate_expr 的全部功能：
 * - AST 求值（literal/var/op/if 三元）
 * - 算术（+ - * / % neg）
 * - 比较（== != > < >= <=）
 * - 逻辑（and or not，**短路**）
 * - 位运算（& | ^ ~ << >> >>>）
 * - 字符串（length slice concat regex_match to_string to_number）
 * - 列表（head tail contains）
 * - 对象（get has keys values merge）
 * - 错误（error_code error_message is_error）
 * - 空检查（is_null is_empty is_truthy）
 * - 类型（typeof）
 * - 集成：l1MainLoop + evaluate_expr
 */

import { describe, expect, test } from 'vitest'
import { l1MainLoop } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { L2Registry } from '../../src/l2/registry.js'
import { evaluateExprOp, type Expr } from '../../src/l2/builtins/evaluate-expr.js'
import { createProgrammableL3 } from '../../src/mocks/mock-l3.js'
import type { Intent } from '../../src/l1/types.js'

// ============== Helpers ==============

function mkMove(id: string, value: unknown, target: string): Intent {
  return {
    id, parentIntentId: null, createdAt: 0, kind: 'move',
    from: { kind: 'literal', value },
    to: { kind: 'internal', name: target }
  }
}

function mkEval(id: string, expr: Expr, outputName = '$r_result'): Intent {
  return {
    id, parentIntentId: null, createdAt: 0, kind: 'execute_op',
    operation: 'evaluate_expr',
    inputs: { expr: { kind: 'internal', name: '$r_expr' } },
    outputs: {
      result: { kind: 'internal', name: outputName },
      error: { kind: 'internal', name: '$r_err' }
    },
    status: 'pending'
  }
}

// ============== 测试 ==============

describe('B07: evaluate_expr（表达式求值 op）', () => {
  // ---------- AST 求值 ----------
  describe('AST 求值', () => {
    test('literal', async () => {
      const r = await evalExpr({ type: 'literal', value: 42 })
      expect(r.result).toBe(42)
    })

    test('literal: string', async () => {
      const r = await evalExpr({ type: 'literal', value: 'hello' })
      expect(r.result).toBe('hello')
    })

    test('if 三元：truthy → then', async () => {
      const r = await evalExpr({
        type: 'if',
        cond: { type: 'literal', value: true },
        then: { type: 'literal', value: 'yes' },
        else: { type: 'literal', value: 'no' }
      })
      expect(r.result).toBe('yes')
    })

    test('if 三元：falsy → else', async () => {
      const r = await evalExpr({
        type: 'if',
        cond: { type: 'literal', value: 0 },
        then: { type: 'literal', value: 1 },
        else: { type: 'literal', value: 2 }
      })
      expect(r.result).toBe(2)
    })
  })

  // ---------- 算术 ----------
  describe('算术', () => {
    test('1 + 2', async () => {
      const r = await evalExpr(binOp('+', 1, 2))
      expect(r.result).toBe(3)
    })

    test('字符串拼接', async () => {
      const r = await evalExpr(binOp('+', 'hello ', 'world'))
      expect(r.result).toBe('hello world')
    })

    test('减乘除', async () => {
      expect((await evalExpr(binOp('-', 10, 3))).result).toBe(7)
      expect((await evalExpr(binOp('*', 4, 5))).result).toBe(20)
      expect((await evalExpr(binOp('/', 10, 4))).result).toBe(2.5)
      expect((await evalExpr(binOp('%', 10, 3))).result).toBe(1)
    })

    test('除以 0 → DIVIDE_BY_ZERO', async () => {
      const r = await evalExpr(binOp('/', 10, 0))
      expect(r.error).toBeTruthy()
      expect((r.error as { code: string }).code).toBe('DIVIDE_BY_ZERO')
    })

    test('neg 一元取负', async () => {
      const r = await evalExpr({ type: 'op', name: 'neg', args: [{ type: 'literal', value: 5 }] })
      expect(r.result).toBe(-5)
    })
  })

  // ---------- 比较 ----------
  describe('比较', () => {
    test('数字 == ==', async () => {
      expect((await evalExpr(binOp('==', 5, 5))).result).toBe(true)
    })

    test('严格不等', async () => {
      expect((await evalExpr(binOp('!=', 5, 6))).result).toBe(true)
      expect((await evalExpr(binOp('==', 5, '5' as unknown as number))).result).toBe(false)
    })

    test('> < >= <=', async () => {
      expect((await evalExpr(binOp('>', 5, 3))).result).toBe(true)
      expect((await evalExpr(binOp('<', 3, 5))).result).toBe(true)
      expect((await evalExpr(binOp('>=', 5, 5))).result).toBe(true)
      expect((await evalExpr(binOp('<=', 5, 5))).result).toBe(true)
    })

    test('字符串比较', async () => {
      expect((await evalExpr(binOp('>', 'b', 'a'))).result).toBe(true)
    })

    test('类型混合 → INVALID_INPUT', async () => {
      const r = await evalExpr(binOp('>', 5, '5' as unknown as number))
      expect((r.error as { code: string }).code).toBe('INVALID_INPUT')
    })
  })

  // ---------- 逻辑 + 短路 ----------
  describe('逻辑（短路）', () => {
    test('and 全 true', async () => {
      const r = await evalExpr({
        type: 'op', name: 'and',
        args: [{ type: 'literal', value: true }, { type: 'literal', value: true }]
      })
      expect(r.result).toBe(true)
    })

    test('and 含 false → false', async () => {
      const r = await evalExpr({
        type: 'op', name: 'and',
        args: [{ type: 'literal', value: true }, { type: 'literal', value: false }]
      })
      expect(r.result).toBe(false)
    })

    test('and 短路：a false 不评估 b（用 var 引用未注册触发 VARIABLE_NOT_FOUND）', async () => {
      const r = await evalExpr({
        type: 'op', name: 'and',
        args: [
          { type: 'literal', value: false },
          { type: 'var', name: '$nonexistent' }
        ]
      })
      expect(r.result).toBe(false)  // 短路，$nonexistent 未注册也不报错
    })

    test('or 含 true', async () => {
      const r = await evalExpr({
        type: 'op', name: 'or',
        args: [{ type: 'literal', value: false }, { type: 'literal', value: true }]
      })
      expect(r.result).toBe(true)
    })

    test('or 短路：a true 不评估 b', async () => {
      const r = await evalExpr({
        type: 'op', name: 'or',
        args: [
          { type: 'literal', value: true },
          { type: 'var', name: '$nonexistent' }
        ]
      })
      expect(r.result).toBe(true)
    })

    test('not', async () => {
      expect((await evalExpr({ type: 'op', name: 'not', args: [{ type: 'literal', value: true }] })).result).toBe(false)
      expect((await evalExpr({ type: 'op', name: 'not', args: [{ type: 'literal', value: 0 }] })).result).toBe(true)
    })
  })

  // ---------- 位运算 ----------
  describe('位运算', () => {
    test('& | ^', async () => {
      expect((await evalExpr(binOp('&', 0b1100, 0b1010))).result).toBe(0b1000)
      expect((await evalExpr(binOp('|', 0b1100, 0b1010))).result).toBe(0b1110)
      expect((await evalExpr(binOp('^', 0b1100, 0b1010))).result).toBe(0b0110)
    })

    test('位移', async () => {
      expect((await evalExpr(binOp('<<', 1, 4))).result).toBe(16)
      expect((await evalExpr(binOp('>>', 16, 2))).result).toBe(4)
    })

    test('~ 一元取反', async () => {
      const r = await evalExpr({ type: 'op', name: '~', args: [{ type: 'literal', value: 0 }] })
      expect(r.result).toBe(-1)
    })
  })

  // ---------- 字符串 ----------
  describe('字符串', () => {
    test('length', async () => {
      const r = await evalExpr({
        type: 'op', name: 'length',
        args: [{ type: 'literal', value: 'hello' }]
      })
      expect(r.result).toBe(5)
    })

    test('concat', async () => {
      const r = await evalExpr({
        type: 'op', name: 'concat',
        args: [{ type: 'literal', value: 'a' }, { type: 'literal', value: 'b' }]
      })
      expect(r.result).toBe('ab')
    })

    test('slice', async () => {
      const r = await evalExpr({
        type: 'op', name: 'slice',
        args: [
          { type: 'literal', value: 'hello world' },
          { type: 'literal', value: 6 },
          { type: 'literal', value: 11 }
        ]
      })
      expect(r.result).toBe('world')
    })

    test('regex_match', async () => {
      const r = await evalExpr({
        type: 'op', name: 'regex_match',
        args: [
          { type: 'literal', value: 'hello123' },
          { type: 'literal', value: '\\d+' }
        ]
      })
      expect(r.result).toBe(true)
    })

    test('regex_match 无效 → INVALID_REGEX', async () => {
      const r = await evalExpr({
        type: 'op', name: 'regex_match',
        args: [
          { type: 'literal', value: 'x' },
          { type: 'literal', value: '[unclosed' }
        ]
      })
      expect((r.error as { code: string }).code).toBe('INVALID_REGEX')
    })

    test('to_string / to_number', async () => {
      const r1 = await evalExpr({ type: 'op', name: 'to_string', args: [{ type: 'literal', value: 42 }] })
      expect(r1.result).toBe('42')
      const r2 = await evalExpr({ type: 'op', name: 'to_number', args: [{ type: 'literal', value: '3.14' }] })
      expect(r2.result).toBe(3.14)
    })

    test('to_number 失败 → INVALID_INPUT', async () => {
      const r = await evalExpr({ type: 'op', name: 'to_number', args: [{ type: 'literal', value: 'abc' }] })
      expect((r.error as { code: string }).code).toBe('INVALID_INPUT')
    })
  })

  // ---------- 列表 ----------
  describe('列表', () => {
    test('head / tail', async () => {
      const headR = await evalExpr({ type: 'op', name: 'head', args: [{ type: 'literal', value: [1, 2, 3] }] })
      expect(headR.result).toBe(1)
      const tailR = await evalExpr({ type: 'op', name: 'tail', args: [{ type: 'literal', value: [1, 2, 3] }] })
      expect(tailR.result).toEqual([2, 3])
    })

    test('length 列表', async () => {
      const r = await evalExpr({ type: 'op', name: 'length', args: [{ type: 'literal', value: [1, 2, 3] }] })
      expect(r.result).toBe(3)
    })

    test('contains', async () => {
      const r = await evalExpr({
        type: 'op', name: 'contains',
        args: [{ type: 'literal', value: [1, 2, 3] }, { type: 'literal', value: 2 }]
      })
      expect(r.result).toBe(true)
    })

    test('concat 列表', async () => {
      const r = await evalExpr({
        type: 'op', name: 'concat',
        args: [
          { type: 'literal', value: [1, 2] },
          { type: 'literal', value: [3, 4] }
        ]
      })
      expect(r.result).toEqual([1, 2, 3, 4])
    })
  })

  // ---------- 对象 ----------
  describe('对象', () => {
    test('get / has / keys / values', async () => {
      const obj: Expr = { type: 'literal', value: { a: 1, b: 2 } }

      const getR = await evalExpr({
        type: 'op', name: 'get', args: [obj, { type: 'literal', value: 'a' }]
      })
      expect(getR.result).toBe(1)

      const hasR = await evalExpr({
        type: 'op', name: 'has', args: [obj, { type: 'literal', value: 'a' }]
      })
      expect(hasR.result).toBe(true)

      const keysR = await evalExpr({ type: 'op', name: 'keys', args: [obj] })
      expect(keysR.result).toEqual(['a', 'b'])

      const valuesR = await evalExpr({ type: 'op', name: 'values', args: [obj] })
      expect(valuesR.result).toEqual([1, 2])
    })

    test('merge', async () => {
      const r = await evalExpr({
        type: 'op', name: 'merge',
        args: [
          { type: 'literal', value: { a: 1, b: 2 } },
          { type: 'literal', value: { b: 3, c: 4 } }
        ]
      })
      expect(r.result).toEqual({ a: 1, b: 3, c: 4 })
    })
  })

  // ---------- 错误（替代旧 extract_error_code）----------
  describe('错误处理（替代 extract_error_code）', () => {
    test('error_code：OperationError', async () => {
      const r = await evalExpr({
        type: 'op', name: 'error_code',
        args: [{
          type: 'literal',
          value: { code: 'ENOENT', message: 'not found', op: 'file_read' }
        }]
      })
      expect(r.result).toBe('ENOENT')
    })

    test('error_code：null', async () => {
      const r = await evalExpr({
        type: 'op', name: 'error_code',
        args: [{ type: 'literal', value: null }]
      })
      expect(r.result).toBeNull()
    })

    test('is_error', async () => {
      const r = await evalExpr({
        type: 'op', name: 'is_error',
        args: [{
          type: 'literal',
          value: { code: 'X', message: 'msg', op: 'op1' }
        }]
      })
      expect(r.result).toBe(true)
    })

    test('error_message', async () => {
      const r = await evalExpr({
        type: 'op', name: 'error_message',
        args: [{
          type: 'literal',
          value: { code: 'ENOENT', message: 'file not found', op: 'file_read' }
        }]
      })
      expect(r.result).toBe('file not found')
    })
  })

  // ---------- 空检查 ----------
  describe('空检查', () => {
    test('is_null', async () => {
      expect((await evalExpr({ type: 'op', name: 'is_null', args: [{ type: 'literal', value: null }] })).result).toBe(true)
      expect((await evalExpr({ type: 'op', name: 'is_null', args: [{ type: 'literal', value: 0 }] })).result).toBe(false)
    })

    test('is_empty：字符串/列表/对象', async () => {
      expect((await evalExpr({ type: 'op', name: 'is_empty', args: [{ type: 'literal', value: '' }] })).result).toBe(true)
      expect((await evalExpr({ type: 'op', name: 'is_empty', args: [{ type: 'literal', value: [] }] })).result).toBe(true)
      expect((await evalExpr({ type: 'op', name: 'is_empty', args: [{ type: 'literal', value: {} }] })).result).toBe(true)
      expect((await evalExpr({ type: 'op', name: 'is_empty', args: [{ type: 'literal', value: 'x' }] })).result).toBe(false)
      expect((await evalExpr({ type: 'op', name: 'is_empty', args: [{ type: 'literal', value: 42 }] })).result).toBe(false)
      expect((await evalExpr({ type: 'op', name: 'is_empty', args: [{ type: 'literal', value: true }] })).result).toBe(false)
    })

    test('is_truthy', async () => {
      expect((await evalExpr({ type: 'op', name: 'is_truthy', args: [{ type: 'literal', value: 1 }] })).result).toBe(true)
      expect((await evalExpr({ type: 'op', name: 'is_truthy', args: [{ type: 'literal', value: 0 }] })).result).toBe(false)
    })
  })

  // ---------- typeof ----------
  describe('typeof', () => {
    test('基本类型', async () => {
      expect((await evalExpr({ type: 'op', name: 'typeof', args: [{ type: 'literal', value: 1 }] })).result).toBe('number')
      expect((await evalExpr({ type: 'op', name: 'typeof', args: [{ type: 'literal', value: 'x' }] })).result).toBe('string')
      expect((await evalExpr({ type: 'op', name: 'typeof', args: [{ type: 'literal', value: true }] })).result).toBe('boolean')
      expect((await evalExpr({ type: 'op', name: 'typeof', args: [{ type: 'literal', value: null }] })).result).toBe('null')
      expect((await evalExpr({ type: 'op', name: 'typeof', args: [{ type: 'literal', value: [] }] })).result).toBe('array')
    })
  })

  // ---------- 集成（l1MainLoop）----------
  describe('集成：l1MainLoop', () => {
    test('读寄存器 + 表达式求值 + 写入', async () => {
      const expr: Expr = {
        type: 'op', name: '==',
        args: [
          { type: 'var', name: '$r_x' },
          { type: 'literal', value: 5 }
        ]
      }
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        mkMove('mv_x', 5, '$r_x'),
        mkMove('mv_e', expr, '$r_expr'),
        mkEval('ev', expr, '$r_result')
      ])
      const reg = new L2Registry(); reg.register(evaluateExprOp)
      const state = createInitialState(reg, l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_result')).toBe(true)
    })

    test('复合表达式：error_code($err) == "ENOENT" AND not is_empty($items)', async () => {
      // 模拟 doc 12 ConditionalJudgment 编译产物
      const expr: Expr = {
        type: 'op', name: 'and',
        args: [
          {
            type: 'op', name: '==',
            args: [
              {
                type: 'op', name: 'error_code',
                args: [{ type: 'var', name: '$r_err' }]
              },
              { type: 'literal', value: 'ENOENT' }
            ]
          },
          {
            type: 'op', name: 'not',
            args: [
              {
                type: 'op', name: 'is_empty',
                args: [{ type: 'var', name: '$r_items' }]
              }
            ]
          }
        ]
      }
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        mkMove('mv_err', { code: 'ENOENT', message: 'not found', op: 'file_read' }, '$r_err'),
        mkMove('mv_items', [], '$r_items'),
        mkMove('mv_e', expr, '$r_expr'),
        mkEval('ev', expr, '$r_result')
      ])
      const reg = new L2Registry(); reg.register(evaluateExprOp)
      const state = createInitialState(reg, l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_result')).toBe(false)  // is_empty([]) = true → not = false → and = false
    })

    test('循环条件：gte($count, 3) 模拟 doc 10 §6.5', async () => {
      const expr: Expr = {
        type: 'op', name: 'gte',
        args: [{ type: 'var', name: '$r_count' }, { type: 'literal', value: 3 }]
      }
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        mkMove('mv_c', 5, '$r_count'),
        mkMove('mv_e', expr, '$r_expr'),
        mkEval('ev', expr, '$r_stop')
      ])
      const reg = new L2Registry(); reg.register(evaluateExprOp)
      const state = createInitialState(reg, l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_stop')).toBe(true)
    })

    test('env 映射：var "code" → 实际寄存器 $r_actual', async () => {
      const expr: Expr = {
        type: 'op', name: '==',
        args: [
          { type: 'var', name: 'code' }, // env 映射 → '$r_actual'
          { type: 'literal', value: 42 }
        ]
      }
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        mkMove('mv_v', 42, '$r_actual'),
        mkMove('mv_e', expr, '$r_expr'),
        mkMove('mv_env', { code: '$r_actual' }, '$r_env'),
        {
          id: 'ev', parentIntentId: null, createdAt: 0, kind: 'execute_op',
          operation: 'evaluate_expr',
          inputs: {
            expr: { kind: 'internal', name: '$r_expr' },
            env: { kind: 'internal', name: '$r_env' }
          },
          outputs: {
            result: { kind: 'internal', name: '$r_r' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        }
      ])
      const reg = new L2Registry(); reg.register(evaluateExprOp)
      const state = createInitialState(reg, l3)
      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_r')).toBe(true)
    })
  })
})

// ============== 辅助函数 ==============

function binOp(op: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '>' | '<' | '>=' | '<=' | '&' | '|' | '^' | '<<' | '>>' | '>>>', a: unknown, b: unknown): Expr {
  return {
    type: 'op', name: op,
    args: [{ type: 'literal', value: a as never }, { type: 'literal', value: b as never }]
  }
}

/** 直接 evaluate_expr.execute 不经过 L1（用于单元测试）。
 * 返回 { result, error } 对象：result 是求值结果，error 是 OperationError（成功时为 null）。 */
async function evalExpr(expr: Expr): Promise<{ result: unknown; error: unknown }> {
  const l3 = createProgrammableL3()
  l3.setChildren('plan', [
    { id: 'mv_e', parentIntentId: null, createdAt: 0, kind: 'move',
      from: { kind: 'literal', value: expr },
      to: { kind: 'internal', name: '$r_expr' } },
    { id: 'ev', parentIntentId: null, createdAt: 0, kind: 'execute_op',
      operation: 'evaluate_expr',
      inputs: { expr: { kind: 'internal', name: '$r_expr' } },
      outputs: {
        result: { kind: 'internal', name: '$r_r' },
        error: { kind: 'internal', name: '$r_err' }
      },
      status: 'pending' }
  ])
  const reg = new L2Registry(); reg.register(evaluateExprOp)
  const state = createInitialState(reg, l3)
  await l1MainLoop({ type: 'plan', params: {} }, state)
  return {
    result: state.internalStore.get('$r_r'),
    error: state.internalStore.get('$r_err')
  }
}