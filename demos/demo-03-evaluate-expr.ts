/**
 * Demo 03 — evaluate_expr 表达式求值（条件判断的统一基石）
 *
 * 演示能力：JSON AST 求值 / 短路语义 / 三元 if / 错误数据化
 *
 * 运行：npx tsx demos/demo-03-evaluate-expr.ts
 *
 * 核心观察点：
 * - 嵌套 AST（Lisp 风格 S-expression）表达复合业务条件
 * - and/or 短路（后续分支不求值）
 * - 求值错误（除零/变量不存在/坏正则）全部数据化
 */

import { setupDemo, step, observe, note, verify, teardownDemo, type DemoCtx } from './lib.js'
import { l1MainLoop } from '../src/l1/main-loop.js'
import { createInitialState } from '../src/l1/execution-state.js'
import { L2Registry } from '../src/l2/registry.js'
import { evaluateExprOp, type Expr } from '../src/l2/builtins/evaluate-expr.js'

const ctx = await setupDemo('Demo 03 — evaluate_expr 表达式求值')

// ============== 准备 ==============

step('0', '环境准备')
const registry = new L2Registry()
registry.register(evaluateExprOp)

/** 经 L1 执行一个表达式，返回 { result, error } */
async function evalExpr(expr: Expr, preset?: Record<string, unknown>) {
  const state = createInitialState(registry, { compile: async () => [] } as never)
  for (const [k, v] of Object.entries(preset ?? {})) {
    state.internalStore.set(k, v as never)
  }
  // 栈 LIFO：后推先执行 → 逆序压入（mv 先执行，op 后执行）
  state.stack.push({
    id: 'op', parentIntentId: null, createdAt: 0, kind: 'execute_op',
    operation: 'evaluate_expr',
    inputs: { expr: { kind: 'internal', name: '$r_expr' } },
    outputs: { result: { kind: 'internal', name: '$r_r' }, error: { kind: 'internal', name: '$r_err' } },
    status: 'pending'
  })
  state.stack.push({
    id: 'mv', parentIntentId: null, createdAt: 0, kind: 'move',
    from: { kind: 'literal', value: expr as never },
    to: { kind: 'internal', name: '$r_expr' }
  })
  await l1MainLoop({ type: 'noop', params: {} }, state)
  return { result: state.internalStore.get('$r_r'), error: state.internalStore.get('$r_err') }
}

const lit = (v: unknown): Expr => ({ type: 'literal', value: v as never })
const vr = (name: string): Expr => ({ type: 'var', name })
const opx = (name: string, ...args: Expr[]): Expr => ({ type: 'op', name: name as never, args })

// ============== 步骤 1: 嵌套 AST ==============

step('1', '嵌套 AST — 业务条件「错误码是 ENOENT 且列表非空」')
{
  const expr = opx('and',
    opx('==', opx('error_code', vr('$r_err')), lit('ENOENT')),
    opx('not', opx('is_empty', vr('$r_items')))
  )
  observe('AST', expr)
  const hit = await evalExpr(expr, { $r_err: { code: 'ENOENT', message: 'x', op: 'file_read', timestamp: 0 }, $r_items: [1, 2] })
  observe('命中场景（ENOENT + 非空列表）→ result', hit.result)
  const miss = await evalExpr(expr, { $r_err: { code: 'EACCES', message: 'x', op: 'file_read', timestamp: 0 }, $r_items: [1] })
  observe('不命中场景（EACCES + 非空）→ result', miss.result)
  note('这就是 L3 经验 conditional_judgment.trigger 的真实形态——声明式、可嵌套')
  verify(ctx, '复合条件两个场景判断正确', () => hit.result === true && miss.result === false)
}

// ============== 步骤 2: 短路语义 ==============

step('2', 'and/or 短路 — 后续分支不求值')
{
  // and 第一参数 false → 第二参数引用不存在的变量也不报错（短路跳过）
  const shortCircuit = opx('and', lit(false), vr('$r_nonexistent_var'))
  const r = await evalExpr(shortCircuit)
  observe('and(false, 不存在的变量) → result', r.result)
  observe('error（应无，短路未求值第二支）', r.error)
  verify(ctx, 'and 短路：false 短路后不评估未知变量', () => r.result === false && r.error === null)

  const orSC = opx('or', lit(true), vr('$r_nonexistent_var'))
  const r2 = await evalExpr(orSC)
  verify(ctx, 'or 短路：true 短路后不评估未知变量', () => r2.result === true && r2.error === null)
}

// ============== 步骤 3: 三元 if ==============

step('3', 'if 三元节点 — AST 内分支')
{
  const expr = { type: 'if' as const,
    cond: opx('>', vr('$r_score'), lit(60)),
    then: lit('pass'),
    else: lit('fail') }
  const pass = await evalExpr(expr, { $r_score: 85 })
  const fail = await evalExpr(expr, { $r_score: 42 })
  observe('score=85 →', pass.result)
  observe('score=42 →', fail.result)
  verify(ctx, 'if 节点两个分支正确', () => pass.result === 'pass' && fail.result === 'fail')
}

// ============== 步骤 4: 错误数据化 ==============

step('4', '求值错误全部数据化（除零 / 变量不存在 / 坏正则）')
{
  const div0 = await evalExpr(opx('/', lit(10), lit(0)))
  observe('10/0 → error.code', (div0.error as { code: string })?.code)

  const noVar = await evalExpr(vr('$r_missing'))
  observe('缺失变量 → error.code', (noVar.error as { code: string })?.code)

  const badRegex = await evalExpr(opx('regex_match', lit('x'), lit('[unclosed')))
  observe('坏正则 → error.code', (badRegex.error as { code: string })?.code)

  note('三类错误都是返回值而非异常——与 L2 错误契约一致')
  verify(ctx, '除零 → DIVIDE_BY_ZERO', () => (div0.error as { code: string })?.code === 'DIVIDE_BY_ZERO')
  verify(ctx, '缺失变量 → VARIABLE_NOT_FOUND', () => (noVar.error as { code: string })?.code === 'VARIABLE_NOT_FOUND')
  verify(ctx, '坏正则 → INVALID_REGEX', () => (badRegex.error as { code: string })?.code === 'INVALID_REGEX')
}

// ============== 步骤 5: 运算符全景（抽样）==============

step('5', '运算符抽样：算术/比较/位/字符串/列表/对象')
{
  const cases: Array<[string, Expr, unknown]> = [
    ['算术 (2+3)*4', opx('*', opx('+', lit(2), lit(3)), lit(4)), 20],
    ['比较 "b" > "a"', opx('>', lit('b'), lit('a')), true],
    ['位 1<<4', opx('<<', lit(1), lit(4)), 16],
    ['字符串 slice', opx('slice', lit('hello world'), lit(6), lit(11)), 'world'],
    ['列表 contains', opx('contains', lit([1, 2, 3]), lit(2)), true],
    ['对象 get', opx('get', lit({ name: 'mvp' }), lit('name')), 'mvp'],
    ['typeof', opx('typeof', lit(42)), 'number'],
    ['neg', opx('neg', lit(7)), -7]
  ]
  for (const [label, expr, expected] of cases) {
    const r = await evalExpr(expr)
    observe(label, r.result)
    verify(ctx, `${label} = ${JSON.stringify(expected)}`, () => r.result === expected && r.error === null)
  }
}

// ============== 结束验证 ==============

await teardownDemo(ctx)
