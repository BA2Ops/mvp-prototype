/**
 * Demo 05 — L3 编译器：Experience 三段式 → L1 指令序列
 *
 * 演示能力：
 *          - 输入绑定（intent.params → $r_input_*）
 *          - skip_cost 前置过滤
 *          - 条件判断的运行时分支构造（evaluate_expr + conditional_skip）
 *          - 编译产物直接可执行
 *
 * 运行：npx tsx demos/demo-05-l3-compiler.ts
 *
 * 核心观察点：
 * - 编译产物 entries 的 kind 序列（静态可见的"汇编清单"）
 * - 同一经验不同 skip_cost 产物的差异
 * - 分支经验的执行轨迹由运行时数据决定
 */

import { setupDemo, step, observe, note, verify, teardownDemo, type DemoCtx } from './lib.js'
import { compileExperience } from '../src/l3/compiler.js'
import { ExperienceService } from '../src/l3/experience-service.js'
import { L2Registry } from '../src/l2/registry.js'
import { createInitialState } from '../src/l1/execution-state.js'
import { l1MainLoop } from '../src/l1/main-loop.js'
import { CORE_EXPERIENCES } from '../src/l3/experience-library.js'
import type { Experience } from '../src/l3/experience.js'
import type { StackEntry } from '../src/l1/types.js'
import { fileReadOp } from '../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../src/l2/builtins/file-write.js'
import { shellExecOp } from '../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../src/l2/builtins/evaluate-expr.js'
import { incrementCounterOp } from '../src/l2/builtins/increment-counter.js'

const ctx = await setupDemo('Demo 05 — L3 编译器')

// ============== 准备 ==============

step('0', '准备：registry + 经验库 + 演示经验')
const registry = new L2Registry()
for (const op of [fileReadOp, fileWriteOp, shellExecOp, globMatchOp, grepSearchOp, stringReplaceOp, evaluateExprOp, incrementCounterOp]) {
  registry.register(op)
}

/** 演示经验 A：带前置处理（可跳过）*/
const withPreproc: Experience = {
  id: 'demo_preproc', description: '带两个前置的经验',
  inputs: {}, outputs: {},
  pre_processing: [
    { id: 'must', operation: 'increment_counter', inputs: { value: { kind: 'literal', value: 100 } },
      outputs: { new_value: { kind: 'register', name: '$r_must' } }, skip_threshold: 0 },
    { id: 'optional', operation: 'increment_counter', inputs: { value: { kind: 'literal', value: 200 } },
      outputs: { new_value: { kind: 'register', name: '$r_opt' } }, skip_threshold: 50 }
  ],
  target_op: { base_op: 'increment_counter', default_path: 'normal', paths: [{
    id: 'normal', description: '', steps: [{
      operation: 'increment_counter',
      inputs: { value: { kind: 'literal', value: 0 } },
      outputs: { new_value: { kind: 'register', name: '$r_final' } }
    }]
  }] }
}

/** 演示经验 B：条件分支（counter >= 3 → big / small）*/
const withBranch: Experience = {
  id: 'demo_branch', description: '条件分支演示',
  inputs: { current: { type: 'number', required: true } }, outputs: {},
  pre_processing: [{
    id: 'bind', operation: 'increment_counter',
    inputs: { value: { kind: 'input', name: 'current' } },
    outputs: { new_value: { kind: 'register', name: '$r_cur' } }, skip_threshold: 0
  }],
  conditional_judgment: [{
    id: 'ge3',
    trigger: { condition_expr: { type: 'op', name: '>=' as never,
      args: [{ type: 'var', name: '$r_cur' }, { type: 'literal', value: 3 as never }] } },
    then_path: 'big', else_path: 'small'
  }],
  target_op: {
    base_op: 'increment_counter', default_path: 'small',
    paths: [
      { id: 'big', description: '', steps: [{ operation: 'increment_counter',
        inputs: { value: { kind: 'register', name: '$r_cur' } },
        outputs: { new_value: { kind: 'register', name: '$r_big' } } }] },
      { id: 'small', description: '', steps: [{ operation: 'increment_counter',
        inputs: { value: { kind: 'register', name: '$r_cur' } },
        outputs: { new_value: { kind: 'register', name: '$r_small' } } }] }
    ]
  }
}

const EXPS = [...CORE_EXPERIENCES, withPreproc, withBranch]
const service = new ExperienceService(EXPS, registry)
const expMap = new Map(EXPS.map(e => [e.id, e]))

function showEntries(entries: StackEntry[]): void {
  entries.forEach((e, i) => {
    const detail = e.kind === 'execute_op' ? ` ${e.operation}`
      : e.kind === 'move' ? ` → ${e.to.kind === 'internal' ? e.to.name : '?'}`
        : e.kind === 'conditional_skip' ? ` n=${e.n}`
          : e.kind === 'skip_n' ? ` n=${e.n}` : ''
    console.log(`    [${i}] ${e.kind}${detail}`)
  })
}

// ============== 步骤 1: 输入绑定 ==============

step('1', '输入绑定 — intent.params → $r_input_* move 指令')
{
  const state = createInitialState(registry, service)
  const entries = compileExperience(
    { type: 'read_file_with_default', params: { path: 'x.txt', default_content: 'DFT' } },
    state, expMap, registry
  )
  const moves = entries.filter(e => e.kind === 'move') as Array<Extract<StackEntry, { kind: 'move' }>>
  observe('编译产物条数', entries.length)
  moves.forEach(m => observe(`move → ${m.to.name}`, m.from.kind === 'literal' ? m.from.value : '?'))
  note('required 参数来自 params；default 参数缺省时取 schema default')
  verify(ctx, 'path 与 default_content 都有绑定指令', () =>
    moves.some(m => m.to.name === '$r_input_path') && moves.some(m => m.to.name === '$r_input_default_content'))
}

// ============== 步骤 2: skip_cost 过滤 ==============

step('2', 'skip_cost 前置过滤 — 同一经验不同成本档位的产物差异')
{
  const state = createInitialState(registry, service)
  const full = compileExperience({ type: 'demo_preproc', params: {} }, state, expMap, registry, { skip_cost: 0 })
  const trimmed = compileExperience({ type: 'demo_preproc', params: {} }, state, expMap, registry, { skip_cost: 50 })
  observe('skip_cost=0 产物条数', full.length)
  observe('skip_cost=50 产物条数', trimmed.length)
  console.log('    --- skip_cost=0 的完整产物 ---')
  showEntries(full)
  console.log('    --- skip_cost=50 的产物（optional 前置消失）---')
  showEntries(trimmed)
  note('threshold=0 必跑；skip_cost >= threshold 且 threshold>0 时该前置整体不生成 entry')
  note('被裁剪的 optional 前置含 sidecar move（literal 200）+ op 共 2 条')
  verify(ctx, 'skip_cost=50 时产物少 2 条（optional 的 sidecar move + op）', () => full.length - trimmed.length === 2)
}

// ============== 步骤 3: 分支构造 ==============

step('3', '条件分支 — 运行时 if/else 的规范构造')
{
  const state = createInitialState(registry, service)
  const entries = compileExperience({ type: 'demo_branch', params: { current: 5 } }, state, expMap, registry)
  console.log('    --- demo_branch 完整产物 ---')
  showEntries(entries)
  note('布局: [move AST] [evaluate_expr] [cskip(n=len(THEN)+1)] THEN... [skip(len(ELSE))] ELSE...')
  note('c=true → cskip 仅弹自己 → THEN 执行 → 尾部 skip 弹掉 ELSE；c=false → cskip 弹过 THEN 直落 ELSE')
  const kinds = entries.map(e => e.kind)
  verify(ctx, '产物含 evaluate_expr + conditional_skip + skip_n 分支骨架', () =>
    kinds.includes('execute_op') && kinds.includes('conditional_skip') && kinds.includes('skip_n'))
}

// ============== 步骤 4: 编译产物真实执行 ==============

step('4', '编译产物执行 — 分支由运行时数据决定')
{
  // current=5 → $r_cur=6 >= 3 → big 路径
  const s1 = createInitialState(registry, service)
  await l1MainLoop({ type: 'demo_branch', params: { current: 5 } }, s1)
  observe('current=5 → $r_big', s1.internalStore.get('$r_big'))
  observe('         $r_small（应不存在）', s1.internalStore.has('$r_small') ? s1.internalStore.get('$r_small') : '(未写入)')

  // current=1 → $r_cur=2 < 3 → small 路径
  const s2 = createInitialState(registry, service)
  await l1MainLoop({ type: 'demo_branch', params: { current: 1 } }, s2)
  observe('current=1 → $r_small', s2.internalStore.get('$r_small'))
  observe('         $r_big（应不存在）', s2.internalStore.has('$r_big') ? s2.internalStore.get('$r_big') : '(未写入)')

  verify(ctx, '同一编译产物按运行时数据走不同路径', () =>
    s1.internalStore.get('$r_big') === 7 && !s1.internalStore.has('$r_small') &&
    s2.internalStore.get('$r_small') === 3 && !s2.internalStore.has('$r_big'))
}

// ============== 结束验证 ==============

await teardownDemo(ctx)
