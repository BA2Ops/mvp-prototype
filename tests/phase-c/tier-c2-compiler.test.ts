/**
 * Phase C Tier C2 - L3 Compiler 测试
 *
 * @see ../../src/l3/compiler.ts
 * @see ../../docs/mvp/12-experience-model.md §6.3
 *
 * 覆盖：
 * - Step 0 输入绑定（required / default / 额外参数 / 缺失 required 抛错）
 * - Step 1 pre_processing（skip_cost 过滤 / threshold=0 必跑）
 * - Step 2 条件判断（运行时分支：真走 then / 假走 else / 链式 judgment）
 * - Step 3 target-op（L2 op / 未知 op 抛错 / 嵌套 experience）
 * - ParamRef 展开（literal sidecar / input / register / 输出 literal 抛错）
 */

import { describe, expect, test } from 'vitest'
import { compileExperience, compileOp } from '../../src/l3/compiler.js'
import { ExperienceService } from '../../src/l3/experience-service.js'
import { L2Registry } from '../../src/l2/registry.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { l1MainLoop } from '../../src/l1/main-loop.js'
import type { Experience, ConditionalJudgment } from '../../src/l3/experience.js'
import type { Expr } from '../../src/l2/builtins/evaluate-expr.js'
import type { StackEntry } from '../../src/l1/types.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { evaluateExprOp } from '../../src/l2/builtins/evaluate-expr.js'
import { evaluateCollectionOp } from '../../src/l2/builtins/evaluate-collection.js'
import { incrementCounterOp } from '../../src/l2/builtins/increment-counter.js'
import { evaluateCollectionOp } from '../../src/l2/builtins/evaluate-collection.js'

// ============== 测试经验库 ==============

/** 最小经验：无前置无判断，直接 counter++ */
const simpleIncr: Experience = {
  id: 'simple_incr',
  description: '计数器 +1',
  inputs: {},
  outputs: {},
  target_op: {
    base_op: 'increment_counter',
    default_path: 'normal',
    paths: [{
      id: 'normal',
      description: '正常',
      steps: [{
        operation: 'increment_counter',
        inputs: { value: { kind: 'literal', value: 0 } },
        outputs: { new_value: { kind: 'register', name: '$r_count' } }
      }]
    }]
  }
}

/** 带输入绑定的经验 */
const withInput: Experience = {
  id: 'echo_input',
  description: '回显输入',
  inputs: {
    msg: { type: 'string', required: true },
    fallback: { type: 'string', required: false, default: 'none' }
  },
  outputs: {},
  target_op: {
    base_op: 'increment_counter',
    default_path: 'normal',
    paths: [{ id: 'normal', description: '', steps: [] }]
  }
}

/** 条件判断经验：$r_cur >= 3 → then（+2，两步链），否则 else（+1）*/
const withJudgment: Experience = {
  id: 'cond_incr',
  description: '条件计数',
  inputs: {
    current: { type: 'number', required: true }
  },
  outputs: {},
  pre_processing: [
    {
      id: 'bind_cur',
      operation: 'increment_counter',
      inputs: { value: { kind: 'input', name: 'current' } },
      outputs: { new_value: { kind: 'register', name: '$r_cur' } },
      skip_threshold: 0 // 必跑
    }
  ],
  conditional_judgment: [
    {
      id: 'ge3',
      trigger: {
        condition_expr: {
          type: 'op', name: '>=' as never,
          args: [
            { type: 'var', name: '$r_cur' },
            { type: 'literal', value: 3 as never }
          ]
        } as unknown as Expr
      },
      then_path: 'big',
      else_path: 'small'
    }
  ],
  target_op: {
    base_op: 'increment_counter',
    default_path: 'small',
    paths: [
      {
        id: 'big', description: '大步进（+2：两步链）',
        steps: [
          {
            operation: 'increment_counter',
            inputs: { value: { kind: 'register', name: '$r_cur' } },
            outputs: { new_value: { kind: 'register', name: '$r_tmp' } }
          },
          {
            operation: 'increment_counter',
            inputs: { value: { kind: 'register', name: '$r_tmp' } },
            outputs: { new_value: { kind: 'register', name: '$r_final' } }
          }
        ]
      },
      {
        id: 'small', description: '小步进（+1）',
        steps: [{
          operation: 'increment_counter',
          inputs: { value: { kind: 'register', name: '$r_cur' } },
          outputs: { new_value: { kind: 'register', name: '$r_final' } }
        }]
      }
    ]
  }
}

/** 可跳过前置的经验 */
const withSkippable: Experience = {
  id: 'skippable_preproc',
  description: '可跳过前置',
  inputs: {},
  outputs: {},
  pre_processing: [
    { id: 'must', operation: 'increment_counter', inputs: { value: { kind: 'literal', value: 100 } },
      outputs: { new_value: { kind: 'register', name: '$r_must' } }, skip_threshold: 0 },
    { id: 'optional', operation: 'increment_counter', inputs: { value: { kind: 'literal', value: 200 } },
      outputs: { new_value: { kind: 'register', name: '$r_opt' } }, skip_threshold: 50 }
  ],
  target_op: {
    base_op: 'increment_counter',
    default_path: 'normal',
    paths: [{ id: 'normal', description: '', steps: [{
      operation: 'increment_counter',
      inputs: { value: { kind: 'literal', value: 0 } },
      outputs: { new_value: { kind: 'register', name: '$r_final' } }
    }] }]
  }
}

const ALL_EXPS = [simpleIncr, withInput, withJudgment, withSkippable]

function mkRegistry(): L2Registry {
  const r = new L2Registry()
  r.register(fileReadOp)
  r.register(fileWriteOp)
  r.register(evaluateExprOp); r.register(evaluateCollectionOp)
  r.register(incrementCounterOp)
  return r
}

function mkExpMap(exps: Experience[] = ALL_EXPS): Map<string, Experience> {
  return new Map(exps.map(e => [e.id, e]))
}

/** E2E 辅助：编译 + 执行 + 返回 internalStore */
async function runExperience(
  expId: string,
  params: Record<string, unknown>,
  opts?: { skip_cost?: number; exps?: Experience[] }
): Promise<Map<string, unknown>> {
  const registry = mkRegistry()
  // D-C4-2 注：executeIntent 调 l3.compile(intent, state) 不传 options，
  // 所以 skip_cost 通过 service 级 defaultOptions 注入（MVP 约定）。
  const service = new ExperienceService(
    opts?.exps ?? ALL_EXPS,
    registry,
    opts?.skip_cost !== undefined ? { skip_cost: opts.skip_cost } : undefined
  )
  const state = createInitialState(registry, service)
  await l1MainLoop(
    { type: expId, params },
    state,
    service.shouldHandleError(expId)
  )
  return state.internalStore as unknown as Map<string, unknown>
}

// ============== Step 0: 输入绑定 ==============

describe('C2: 输入绑定', () => {
  test('required + optional default 都绑定到 $r_input_*', async () => {
    const store = await runExperience('echo_input', { msg: 'hi' })
    expect(store.get('$r_input_msg')).toBe('hi')
    expect(store.get('$r_input_fallback')).toBe('none') // default 生效
  })

  test('显式传入覆盖 default', async () => {
    const store = await runExperience('echo_input', { msg: 'hi', fallback: 'custom' })
    expect(store.get('$r_input_fallback')).toBe('custom')
  })

  test('缺失 required → 抛错', () => {
    const registry = mkRegistry()
    const service = new ExperienceService(ALL_EXPS, registry)
    const state = createInitialState(registry, service)
    expect(() =>
      compileExperience({ type: 'echo_input', params: {} }, state, mkExpMap(), registry)
    ).toThrow(/missing required input 'msg'/)
  })

  test('schema 外的额外参数也绑定（宽容）', async () => {
    const store = await runExperience('echo_input', { msg: 'x', extra: 42 })
    expect(store.get('$r_input_extra')).toBe(42)
  })
})

// ============== Step 1: pre_processing ==============

describe('C2: pre_processing', () => {
  test('skip_cost=0：threshold=0 必跑，threshold=50 也跑', async () => {
    const store = await runExperience('skippable_preproc', {}, { skip_cost: 0 })
    expect(store.get('$r_must')).toBe(101)   // 100+1 必跑
    expect(store.get('$r_opt')).toBe(201)    // 200+1 也跑
  })

  test('skip_cost=50：threshold=50 的前置被跳过', async () => {
    const store = await runExperience('skippable_preproc', {}, { skip_cost: 50 })
    expect(store.get('$r_must')).toBe(101)   // threshold=0 必跑
    expect(store.has('$r_opt')).toBe(false)  // threshold=50 被跳过
  })

  test('skip_cost=99：threshold=50 仍跳过', async () => {
    const store = await runExperience('skippable_preproc', {}, { skip_cost: 99 })
    expect(store.has('$r_opt')).toBe(false)
  })
})

// ============== Step 2: 条件判断（运行时分支）==============

describe('C2: 条件判断（运行时分支）', () => {
  test('条件为真 → then 路径（+2 两步链）', async () => {
    const store = await runExperience('cond_incr', { current: 5 })
    expect(store.get('$r_cur')).toBe(6)      // 前置: 5+1
    expect(store.get('$r_final')).toBe(8)    // then: 6+1+1
  })

  test('条件为假 → else 路径（+1）', async () => {
    const store = await runExperience('cond_incr', { current: 1 })
    expect(store.get('$r_cur')).toBe(2)      // 前置: 1+1
    expect(store.get('$r_final')).toBe(3)    // else: 2+1
  })

  test('边界值（==3）走 then（>= 语义）', async () => {
    const store = await runExperience('cond_incr', { current: 2 })
    expect(store.get('$r_cur')).toBe(3)
    expect(store.get('$r_final')).toBe(5)   // 3+1+1 → then
  })
})

// ============== Step 3: target-op 步骤 ==============

describe('C2: target-op 步骤', () => {
  test('无前置无判断的最小经验', async () => {
    const store = await runExperience('simple_incr', {})
    expect(store.get('$r_count')).toBe(1)
  })

  test('未知 operation → 抛错', () => {
    const registry = mkRegistry()
    const bad: Experience = {
      ...simpleIncr,
      id: 'bad_exp',
      target_op: {
        base_op: 'nope',
        default_path: 'normal',
        paths: [{ id: 'normal', description: '', steps: [
          { operation: 'no_such_op', inputs: {}, outputs: {} }
        ] }]
      }
    }
    expect(() =>
      compileExperience({ type: 'bad_exp', params: {} },
        createInitialState(registry, new ExperienceService([bad], registry)),
        mkExpMap([bad]), registry)
    ).toThrow(/unknown operation or experience 'no_such_op'/)
  })

  test('不存在的经验 type → 抛错', () => {
    const registry = mkRegistry()
    expect(() =>
      compileExperience({ type: 'no_such_exp', params: {} },
        createInitialState(registry, new ExperienceService([], registry)),
        mkExpMap(), registry)
    ).toThrow(/no experience registered/)
  })

  test('不存在的 path id → 抛错', () => {
    const registry = mkRegistry()
    const bad: Experience = {
      ...simpleIncr,
      id: 'bad_path',
      conditional_judgment: [{
        id: 'j',
        trigger: { condition_expr: { type: 'literal', value: true } as unknown as Expr },
        then_path: 'no_such_path'
      }]
    }
    expect(() =>
      compileExperience({ type: 'bad_path', params: {} },
        createInitialState(registry, new ExperienceService([bad], registry)),
        mkExpMap([bad]), registry)
    ).toThrow(/no target path 'no_such_path'/)
  })
})

// ============== ParamRef 展开 ==============

describe('C2: ParamRef 展开', () => {
  test('literal input 生成 sidecar move + 引用临时寄存器', () => {
    const registry = mkRegistry()
    const ctxExp = mkExpMap()
    const entries = compileOp(
      'increment_counter',
      { value: { kind: 'literal', value: 7 } },
      { new_value: { kind: 'register', name: '$r_c' } },
      'test',
      { intent: { type: 'x', params: {} }, experiences: ctxExp, registry, skipCost: 0, tmpCounter: 0 } as never
    )
    expect(entries).toHaveLength(2)
    expect(entries[0].kind).toBe('move')
    expect(entries[1].kind).toBe('execute_op')
    const op = entries[1] as Extract<StackEntry, { kind: 'execute_op' }>
    expect(op.operation).toBe('increment_counter')
    expect(op.inputs.value).toEqual({ kind: 'internal', name: '$r_argtmp_0' })
  })

  test('output literal → 抛错', () => {
    const registry = mkRegistry()
    expect(() =>
      compileOp('increment_counter', {}, { new_value: { kind: 'literal', value: 1 } }, 't',
        { intent: { type: 'x', params: {} }, experiences: mkExpMap(), registry, skipCost: 0, tmpCounter: 0 } as never)
    ).toThrow(/output param 'new_value' cannot be a literal/)
  })
})

// ============== ExperienceService ==============

describe('C2: ExperienceService', () => {
  test('getExperience / listExperiences', () => {
    const service = new ExperienceService(ALL_EXPS, mkRegistry())
    expect(service.getExperience('simple_incr')?.id).toBe('simple_incr')
    expect(service.getExperience('nope')).toBeNull()
    expect(service.listExperiences()).toHaveLength(4)
  })

  test('recordFeedback 追加到 feedback_history', async () => {
    const service = new ExperienceService(ALL_EXPS, mkRegistry())
    await service.recordFeedback('simple_incr', {
      timestamp: 1, feedback_type: 'other', target: 'x', suggestion: 'y'
    })
    expect(service.getExperience('simple_incr')?.feedback_history).toHaveLength(1)
    await expect(service.recordFeedback('nope', {
      timestamp: 1, feedback_type: 'other', target: '', suggestion: ''
    })).rejects.toThrow(/unknown experience/)
  })

  test('shouldHandleError：默认 false，显式 true 生效', () => {
    const withHandler: Experience = { ...simpleIncr, id: 'handler', handleError: true }
    const service = new ExperienceService([simpleIncr, withHandler], mkRegistry())
    expect(service.shouldHandleError('simple_incr')).toBe(false)
    expect(service.shouldHandleError('handler')).toBe(true)
    expect(service.shouldHandleError('unknown')).toBe(false)
  })

  test('recompile 记录 errorInfo 并返回编译结果', async () => {
    const service = new ExperienceService(ALL_EXPS, mkRegistry())
    const registry = mkRegistry()
    const state = createInitialState(registry, service)
    const entries = await service.recompile(
      { type: 'simple_incr', params: {} }, state,
      { failedOpName: 'increment_counter', failedOpId: 'op_1', errorMessage: 'test', attemptedInputs: {} }
    )
    expect(entries.length).toBeGreaterThan(0)
    expect(service.getLastErrorInfo()?.errorMessage).toBe('test')
  })
})
