/**
 * Demo 07 — 递归循环（doc 10 §6.5 循环模式的 MVP 落地）
 *
 * 演示能力：
 *          - 两经验递归设计（入口初始化 + 自嵌套迭代）
 *          - 全局寄存器共享累积状态（无需参数传递）
 *          - 运行时终止判断（evaluate_expr + conditional_skip）
 *          - 递归深度防护（L1 系统防御，不被业务截获）
 *
 * 运行：npx tsx demos/demo-07-recursion-loop.ts
 */

import { setupDemo, step, observe, note, verify, teardownDemo, type DemoCtx } from './lib.js'
import { l1MainLoop } from '../src/l1/main-loop.js'
import { createInitialState } from '../src/l1/execution-state.js'
import { L2Registry } from '../src/l2/registry.js'
import { ExperienceService } from '../src/l3/experience-service.js'
import type { Experience, Expr } from '../src/l3/experience.js'
import { fileReadOp } from '../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../src/l2/builtins/file-write.js'
import { shellExecOp } from '../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../src/l2/builtins/evaluate-expr.js'
import { incrementCounterOp } from '../src/l2/builtins/increment-counter.js'

const ctx = await setupDemo('Demo 07 — 递归循环')

// ============== 准备 ==============

step('0', '准备：递归经验对（count_to 入口 + count_up_iter 迭代）')
const registry = new L2Registry()
for (const op of [fileReadOp, fileWriteOp, shellExecOp, globMatchOp, grepSearchOp, stringReplaceOp, evaluateExprOp, incrementCounterOp]) {
  registry.register(op)
}

const reg = (name: string): Expr => ({ type: 'var', name })

/** 迭代经验：$r_cur+1，未达 target 则自嵌套 */
const countUpIter: Experience = {
  id: 'count_up_iter', description: '$r_cur+1 直到 >= target',
  inputs: { target: { type: 'number', required: true } }, outputs: {},
  pre_processing: [{
    id: 'incr', operation: 'increment_counter',
    inputs: { value: { kind: 'register', name: '$r_cur' } },
    outputs: { new_value: { kind: 'register', name: '$r_cur' } },
    skip_threshold: 0
  }],
  conditional_judgment: [{
    id: 'reached',
    trigger: { condition_expr: { type: 'op', name: '>=' as never, args: [reg('$r_cur'), reg('$r_input_target')] } },
    then_path: 'done', else_path: 'recurse'
  }],
  target_op: { base_op: 'increment_counter', default_path: 'done', paths: [
    { id: 'done', description: '终止', steps: [] },
    { id: 'recurse', description: '自嵌套', steps: [{
      operation: 'count_up_iter',
      inputs: { target: { kind: 'input', name: 'target' } },
      outputs: {}
    }] }
  ] }
}

/** 入口经验：初始化 $r_cur=0 后进入递归 */
const countTo: Experience = {
  id: 'count_to', description: '从 0 计数到 target',
  inputs: { target: { type: 'number', required: true } }, outputs: {},
  target_op: { base_op: 'evaluate_expr', default_path: 'normal', paths: [{
    id: 'normal', description: '', steps: [
      { operation: 'evaluate_expr',
        inputs: { expr: { kind: 'literal', value: { type: 'literal', value: 0 } as never } },
        outputs: { result: { kind: 'register', name: '$r_cur' }, error: { kind: 'register', name: '$r_eval_err' } } },
      { operation: 'count_up_iter', inputs: { target: { kind: 'input', name: 'target' } }, outputs: {} }
    ]
  }] }
}

const service = new ExperienceService([countUpIter, countTo], registry)

async function run(target: number, maxRecursionDepth?: number) {
  const state = createInitialState(registry, service)
  const t0 = Date.now()
  let threw: string | null = null
  try {
    await l1MainLoop({ type: 'count_to', params: { target } }, state,
      maxRecursionDepth !== undefined ? { maxRecursionDepth } : {})
  } catch (e) { threw = (e as Error).name }
  return { store: state.internalStore as unknown as Map<string, unknown>, threw, ms: Date.now() - t0 }
}

// ============== 步骤 1: 小规模递归 ==============

step('1', '计数到 5 — 每层递归 +1，达到后运行时分支终止')
{
  const r = await run(5)
  observe('$r_cur', r.store.get('$r_cur'))
  observe('耗时', `${r.ms}ms`)
  note('每层递归 = 一个 execute_intent 帧；终止判断是 evaluate_expr 运行时求值')
  verify(ctx, '递归 5 层后 $r_cur=5', () => r.store.get('$r_cur') === 5 && r.threw === null)
}

// ============== 步骤 2: 边界 ==============

step('2', '边界：target=1（初始化后一次即止）')
{
  const r = await run(1)
  observe('$r_cur', r.store.get('$r_cur'))
  verify(ctx, 'target=1 → $r_cur=1', () => r.store.get('$r_cur') === 1)
}

// ============== 步骤 3: 性能基线 ==============

step('3', '性能基线：200 层递归')
{
  const r = await run(200)
  observe('$r_cur', r.store.get('$r_cur'))
  observe('耗时', `${r.ms}ms`)
  verify(ctx, '200 层递归正确且 5s 内完成', () =>
    r.store.get('$r_cur') === 200 && r.ms < 5000)
}

// ============== 步骤 4: 深度防护 ==============

step('4', '深度防护：target=100 但 maxRecursionDepth=10 → 系统级拦截')
{
  const r = await run(100, 10)
  observe('抛出的异常', r.threw)
  note('RecursionDepthError 是 L1 系统防御：即使 handleError=true 也不被业务截获，直接抛给调用者')
  verify(ctx, '超深递归被 RecursionDepthError 拦截', () => r.threw === 'RecursionDepthError')
}

// ============== 结束验证 ==============

await teardownDemo(ctx)
