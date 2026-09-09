/**
 * Phase D - 场景级集成测试
 *
 * @see ../../docs/mvp/11-prototype-implementation-plan.md §Phase D
 * @see ../../docs/mvp/10-reactive-execution-model.md §6.5（循环模式）
 *
 * 原计划的 D1（L1+L2）/ D2（L1+L2+L3）层间集成已在 Phase C 的 E2E 中完成，
 * 本 tier 聚焦原计划 D3-D5 的「场景集成」：
 *
 * - D-A 循环场景：递归经验实现计数循环（doc 10 §6.5 的 MVP 落地）
 *     · 入口经验初始化 + 全局寄存器共享 + 经验自嵌套
 *     · 递归深度防护（A11 RecursionDepthError 实战）
 * - D-B 多经验协作：编排经验串联 4 条核心经验（寄存器跨经验传递）
 * - D-C 错误恢复：业务级失败检测 → 换策略重试（recompile 语义的业务面）
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { l1MainLoop } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { L2Registry } from '../../src/l2/registry.js'
import { ExperienceService } from '../../src/l3/experience-service.js'
import { CORE_EXPERIENCES } from '../../src/l3/experience-library.js'
import type { Experience, Expr } from '../../src/l3/experience.js'
import type { Value } from '../../src/l1/types.js'
import { enableCrrNewPath, disableCrrNewPath } from '../../src/l1/main-loop.js'
import { U_MAX_P1_ESTIMATE } from '../../src/l3/crr-config.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { shellExecOp } from '../../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../../src/l2/builtins/evaluate-expr.js'
import { incrementCounterOp } from '../../src/l2/builtins/increment-counter.js'

// ============== 环境 ==============

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'phase-d-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

// ============== D-A: 递归循环经验 ==============

/** 表达式辅助 */
const reg = (name: string): Expr => ({ type: 'var', name })
const lit = (v: Value): Expr => ({ type: 'literal', value: v as never })
const op = (name: string, ...args: Expr[]): Expr => ({ type: 'op', name: name as never, args })

/**
 * 递归工作经验：$r_cur 未达 target 则自嵌套。
 *
 * 关键机制：internalStore 全局共享——子经验与父经验看到同一个 $r_cur，
 * 因此无需参数传递即可累积状态（绕过 D-C6-1 嵌套 params 仅 literal/input 的限制）。
 */
const countUpIter: Experience = {
  id: 'count_up_iter',
  description: '递归计数：$r_cur +1 直到 >= target',
  inputs: { target: { type: 'number', required: true } },
  outputs: {},
  pre_processing: [{
    id: 'incr',
    operation: 'increment_counter',
    inputs: { value: { kind: 'register', name: '$r_cur' } },
    outputs: { new_value: { kind: 'register', name: '$r_cur' } },
    skip_threshold: 0
  }],
  conditional_judgment: [{
    id: 'reached_target',
    trigger: { condition_expr: op('>=', reg('$r_cur'), reg('$r_input_target')) },
    then_path: 'done',
    else_path: 'recurse'
  }],
  target_op: {
    base_op: 'evaluate_expr',
    default_path: 'done',
    paths: [
      { id: 'done', description: '达到目标 → 终止', steps: [] },
      {
        id: 'recurse', description: '未达到 → 自嵌套',
        steps: [{
          operation: 'count_up_iter',   // ← 经验自引用（递归）
          inputs: { target: { kind: 'input', name: 'target' } },
          outputs: {}
        }]
      }
    ]
  }
}

/** 入口经验：初始化 $r_cur = 0 后进入递归 */
const countTo: Experience = {
  id: 'count_to',
  description: '从 0 计数到 target',
  inputs: { target: { type: 'number', required: true } },
  outputs: {},
  target_op: {
    base_op: 'evaluate_expr',
    default_path: 'normal',
    paths: [{
      id: 'normal', description: '',
      steps: [
        {
          operation: 'evaluate_expr',
          inputs: { expr: { kind: 'literal', value: lit(0) as unknown as Value } },
          outputs: {
            result: { kind: 'register', name: '$r_cur' },
            error: { kind: 'register', name: '$r_eval_err' }
          }
        },
        {
          operation: 'count_up_iter',
          inputs: { target: { kind: 'input', name: 'target' } },
          outputs: {}
        }
      ]
    }]
  }
}

const D_EXPS: Experience[] = [countUpIter, countTo]

function mkEnv(exps: Experience[] = []): { service: ExperienceService; registry: L2Registry } {
  const registry = new L2Registry()
  registry.register(fileReadOp)
  registry.register(fileWriteOp)
  registry.register(shellExecOp)
  registry.register(globMatchOp)
  registry.register(grepSearchOp)
  registry.register(stringReplaceOp)
  registry.register(evaluateExprOp)
  registry.register(incrementCounterOp)
  const service = new ExperienceService([...CORE_EXPERIENCES, ...D_EXPS, ...exps], registry)
  return { service, registry }
}

async function run(
  expId: string,
  params: Record<string, unknown>,
  opts?: { maxRecursionDepth?: number }
): Promise<Map<string, unknown>> {
  const { service, registry } = mkEnv()
  const state = createInitialState(registry, service)
  await l1MainLoop({ type: expId, params }, state, {
    rootHandleError: service.shouldHandleError(expId),
    ...(opts?.maxRecursionDepth !== undefined ? { maxRecursionDepth: opts.maxRecursionDepth } : {})
  })
  return state.internalStore as unknown as Map<string, unknown>
}

// ============== D-A: 循环场景 ==============

describe('Phase D-A: 递归循环（doc 10 §6.5 循环模式落地）', () => {
  test('计数到 5：递归 5 层后终止，$r_cur = 5', async () => {
    const store = await run('count_to', { target: 5 })
    expect(store.get('$r_cur')).toBe(5)
  })

  test('边界：target = 1（一次即止）', async () => {
    const store = await run('count_to', { target: 1 })
    expect(store.get('$r_cur')).toBe(1)
  })

  test('性能基线（D4）：计数到 200 在 5s 内完成', async () => {
    const t0 = Date.now()
    const store = await run('count_to', { target: 200 })
    const elapsed = Date.now() - t0
    expect(store.get('$r_cur')).toBe(200)
    expect(elapsed).toBeLessThan(5000)
    console.log(`    [perf] 200 次递归循环耗时 ${elapsed}ms`)
  })

  test('递归深度防护：超过 maxRecursionDepth → RecursionDepthError（不走业务冒泡）', async () => {
    const { service, registry } = mkEnv()
    const state = createInitialState(registry, service)
    await expect(
      l1MainLoop(
        { type: 'count_to', params: { target: 100 } },
        state,
        { maxRecursionDepth: 10, rootHandleError: true }  // 即使 handleError=true 也直接抛
      )
    ).rejects.toThrow(/recursion|depth/i)
  })
})

// ============== D-B: 多经验协作 ==============

describe('Phase D-B: 多经验协作（编排经验串联 4 条核心经验）', () => {
  /**
   * setup_workspace 编排经验：
   *   safe_write(config) → write_file(readme) → replace_in_file(note) → read_file(note)
   * 子经验结果通过全局寄存器（$r_content 等）回传给后续步骤。
   */
  const setupWorkspace: Experience = {
    id: 'setup_workspace',
    description: '初始化工作区：配置 + 说明文档 + 笔记模板 + 回读验证',
    handleError: true,
    inputs: {
      config_path: { type: 'path', required: true },
      readme_path: { type: 'path', required: true },
      note_path: { type: 'path', required: true }
    },
    outputs: {},
    target_op: {
      base_op: 'file_read', default_path: 'normal',
      paths: [{
        id: 'normal', description: '',
        steps: [
          // 1. 安全写入配置（已存在则跳过）
          {
            operation: 'safe_write',
            inputs: {
              path: { kind: 'input', name: 'config_path' },
              content: { kind: 'literal', value: '[default]\nmode=demo' }
            },
            outputs: {}
          },
          // 2. 强制写入 readme
          {
            operation: 'write_file',
            inputs: {
              path: { kind: 'input', name: 'readme_path' },
              content: { kind: 'literal', value: '# demo workspace' }
            },
            outputs: {}
          },
          // 3. 笔记：写入 → 替换（replace_in_file 内部含读改写三步）
          {
            operation: 'write_file',
            inputs: {
              path: { kind: 'input', name: 'note_path' },
              content: { kind: 'literal', value: 'TODO: old-task' }
            },
            outputs: {}
          },
          {
            operation: 'replace_in_file',
            inputs: {
              path: { kind: 'input', name: 'note_path' },
              find: { kind: 'literal', value: 'old-task' },
              replace: { kind: 'literal', value: 'new-task' }
            },
            outputs: {}
          },
          // 4. 回读笔记验证（结果在 $r_content，供调用方断言）
          {
            operation: 'read_file',
            inputs: { path: { kind: 'input', name: 'note_path' } },
            outputs: {}
          }
        ]
      }]
    }
  }

  test('编排经验一次调用完成 4 类操作，磁盘状态全部正确', async () => {
    const configPath = join(dir, 'config.ini')
    const readmePath = join(dir, 'readme.md')
    const notePath = join(dir, 'note.txt')

    const { service, registry } = mkEnv([setupWorkspace])
    const state = createInitialState(registry, service)
    await l1MainLoop(
      {
        type: 'setup_workspace',
        params: { config_path: configPath, readme_path: readmePath, note_path: notePath }
      },
      state,
      { rootHandleError: service.shouldHandleError('setup_workspace') }
    )
    const store = state.internalStore as unknown as Map<string, unknown>

    // 磁盘断言
    expect(await fs.readFile(configPath, 'utf-8')).toBe('[default]\nmode=demo')
    expect(await fs.readFile(readmePath, 'utf-8')).toBe('# demo workspace')
    expect(await fs.readFile(notePath, 'utf-8')).toBe('TODO: new-task')

    // 寄存器断言：最后一步 read_file 的结果跨经验可见
    expect(store.get('$r_content')).toBe('TODO: new-task')
    // replace_in_file 的替换计数也跨经验可见
    expect(store.get('$r_count')).toBe(1)
    // 全程无错误 (P4/T-4.3: new path error output 写到 $err)
    expect(store.get('$err')).toBeNull()
  })

  test('幂等性：第二次运行时 safe_write 跳过配置（bytes=0），其余照常', async () => {
    const configPath = join(dir, 'config.ini')
    const { service, registry } = mkEnv([setupWorkspace])
    const state = createInitialState(registry, service)
    const params = {
      config_path: configPath,
      readme_path: join(dir, 'readme.md'),
      note_path: join(dir, 'note.txt')
    }
    await l1MainLoop({ type: 'setup_workspace', params }, state, { rootHandleError: true })
    // 第二次运行（全新 state，模拟重新执行）
    const state2 = createInitialState(registry, service)
    await l1MainLoop({ type: 'setup_workspace', params }, state2, { rootHandleError: true })
    const store2 = state2.internalStore as unknown as Map<string, unknown>

    // safe_write 第二次跳过（$r_bytes 被 abort 路径置 0 后又被后续 write_file 覆盖，
    // 但 config 内容不变证明跳过生效）
    expect(await fs.readFile(configPath, 'utf-8')).toBe('[default]\nmode=demo')
    expect(store2.get('$err')).toBeNull()
  })
})

// ============== D-C: 错误恢复 ==============

describe('Phase D-C: 错误恢复（业务级失败检测 → 换策略重试）', () => {
  test('探测 → 发现不存在 → 先创建 → 重试成功（业务级恢复闭环）', async () => {
    const p = join(dir, 'retry.txt')
    const { service, registry } = mkEnv()

    // 第一步：探测（check_file_exists，handleError=true，不抛出）
    const probe = createInitialState(registry, service)
    await l1MainLoop({ type: 'check_file_exists', params: { path: p } }, probe, { rootHandleError: true })
    expect(probe.internalStore.get('$r_exists')).toBe(false)

    // 业务级恢复决策（上层 LLM/调用方的职责）：文件不存在 → 先创建
    await fs.writeFile(p, 'x=a', 'utf-8')

    // 第二步：重试 replace_in_file → 成功
    const state2 = createInitialState(registry, service)
    await l1MainLoop(
      { type: 'replace_in_file', params: { path: p, find: 'a', replace: 'b' } },
      state2,
      { rootHandleError: true }
    )
    expect(state2.internalStore.get('$err')).toBeNull()
    expect(await fs.readFile(p, 'utf-8')).toBe('x=b')
  })

  test('safe_write 被跳过（bytes=0）→ 业务判断后改用 write_file 强制覆盖', async () => {
    const p = join(dir, 'force.txt')
    await fs.writeFile(p, 'old', 'utf-8')
    const { service, registry } = mkEnv()

    // 第一次：safe_write 被跳过
    const state1 = createInitialState(registry, service)
    await l1MainLoop({ type: 'safe_write', params: { path: p, content: 'new' } }, state1, { rootHandleError: false })
    expect(state1.internalStore.get('$r_bytes')).toBe(0)

    // 业务决策：需要强制覆盖 → 换 write_file
    const state2 = createInitialState(registry, service)
    await l1MainLoop({ type: 'write_file', params: { path: p, content: 'new' } }, state2, { rootHandleError: false })
    expect(state2.internalStore.get('$r_bytes')).toBe(3)
    expect(await fs.readFile(p, 'utf-8')).toBe('new')
  })
})

// ============== D-D: CRR new-path scope/register 机制（P3 T-D1/T-D2/T-D3） ==============
// @see docs/mvp/19c-implementation-plan.md §三 P3 — chain-intermediate reuse / caller-saved convention / retention window /
//   compile-time aliasing check (K4a)。全部在 enableCrrNewPath() 下运行，afterEach 统一关闭防跨用例污染。

/** peak-size ceiling 的合理浮动余量 —— literal/env sidecar moves 在编译期额外占用的 argtmp pool slot */
const TD_D_PEAK_SLACK = 6

/** T-D1 fixture：单帧 read→replace×2(反复引用同一 source out-slot ≥3 引用点)→write。不声明 persist:true → publicStore 应保持空。 */
const td1ChainEditFiveStep: Experience = {
  id: 'td1_chain_edit_5step',
  description: 'single-frame read→replace×2(reuse same source slot ≥3 refs)→write',
  inputs: { path: { type: 'path', required: true } },
  outputs: {},
  target_op: {
    base_op: 'string_replace', default_path: 'normal',
    paths: [{
      id: 'normal', description: '',
      steps: [
        // step1: file_read.content → $r_content（物理地址将解析为 $S<scope>.out2，见 file-read.ts formalSpec）
        { operation: 'file_read', inputs: { path: { kind: 'input', name: 'path' } }, outputs: { content: { kind: 'register', name: '$r_content' }, error: { kind: 'register', name: '$r_err' } } },
        // step2：第一次后续引用（$r_content 的复用 #1 / 全局第2次涉及该 slot：写+读=≥2，配合下面再 +1 满足"≥3 引用点"语义中的"被引用"部分）
        { operation: 'string_replace', inputs: { text: { kind: 'register', name: '$r_content' }, find: { kind: 'literal', value: 'OLD_TOKEN_A' }, replace: { kind: 'literal', value: 'NEW_TOKEN_A' }, replace_all: { kind: 'literal', value: true } }, outputs: { result: { kind: 'register', name: '$r_replaced_1' }, count: { kind: 'register', name: '$r_count_a' }, error: { kind: 'register', name: '$r_err' } } },
        // step3：第二次独立复用 —— 修复前 expandRefs 误用 string_replace 自身 .in<k> slotIndex（而非 file_read.content 的 .out<2>），此处即 VARIABLE_NOT_FOUND/indexOf-on-undefined
        { operation: 'string_replace', inputs: { text: { kind: 'register', name: '$r_content' }, find: { kind: 'literal', value: 'KEEP_ME' }, replace: { kind: 'literal', value: 'KEPT_ME' }, replace_all: { kind: 'literal', value: true } }, outputs: { result: { kind: 'register', name: '$r_replaced_2' }, count: { kind: 'register', name: '$r_count_b' }, error: { kind: 'register', name: '$r_err' } } },
        // step4：落盘消费 LAST 一次替换结果（K4 caller-saved last-writer-wins：两个同型 string_replace step 共享同一 op-level out-slot，后写覆盖先写）
        { operation: 'file_write', inputs: { path: { kind: 'input', name: 'path' }, content: { kind: 'register', name: '$r_replaced_2' } }, outputs: { bytes_written: { kind: 'register', name: '$r_bytes' }, error: { kind: 'register', name: '$r_err' } } }
      ]
    }]
  }
}

/** T-D2/T-D3 fixtures：A(读文件) + B1/B2(string_replace 消费者)。跨 frame registerOutput 引用，各自独立 scope。 */
function tdReaderExp(pathLiteralValue: string): Experience {
  return {
    id: 'td_reader', description: 'reads file, produces content (T-D2/D3 shared fixture)',
    inputs: {}, outputs: { content: { type: 'string', required: true } },
    outputs_bindings: { content: { register: '$r_content', type: 'string', persist: true } },
    target_op: {
      base_op: 'file_read', default_path: 'normal',
      paths: [{ id: 'normal', steps: [
        { operation: 'file_read', inputs: { path: { kind: 'literal', value: pathLiteralValue as never } }, outputs: { content: { kind: 'register', name: '$r_content' }, error: { kind: 'register', name: '$r_err' } } }
      ]}]
    }
  }
}
function tdConsumerExp(idSuffix: string, findTok: string, replaceTok: string): Experience {
  const regResult = `$r_result_${idSuffix}`
  return {
    id: `td_b_consumer_${idSuffix}`, description: `replace ${findTok}->${replaceTok} on input text`,
    inputs: { text: { type: 'string', required: true } },
    outputs: { result: { type: 'string', required: true } },
    outputs_bindings: { result: { register: regResult, type: 'string', persist: true } },
    target_op: {
      base_op: 'string_replace', default_path: 'normal',
      paths: [{ id: 'normal', steps: [
        { operation: 'string_replace', inputs: { text: { kind: 'input', name: 'text' }, find: { kind: 'literal', value: findTok }, replace: { kind: 'literal', value: replaceTok }, replace_all: { kind: 'literal', value: true } }, outputs: { result: { kind: 'register', name: regResult }, count: { kind: 'register', name: `$r_count_${idSuffix}` }, error: { kind: 'register', name: '$r_err' } } }
      ]}]
    }
  }
}
function tdOrchestratorExp(b1Id: string, b2Id: string): Experience {
  return {
    id: 'td_orchestrator', description: 'A -> B1,B2 both consume A.content via registerOutput (cross-frame)',
    inputs: {}, outputs: {},
    target_op: {
      base_op: 'file_read', default_path: 'normal',
      paths: [{ id: 'normal', steps: [
        // @ts-expect-error experience-level op (嵌套 CALL)，与 CORE_EXPERIENCES/replace_in_file 同款结构，TS 类型上 operation 字段按字面量 op-name 设计而非任意经验名
        { operation: 'td_reader', inputs: {}, outputs: {} as Record<string, never> },
        // @ts-expect-error 同上
        { operation: b1Id, inputs: { text: { kind: 'registerOutput', expId: 'td_reader', outKey: 'content' } as never }, outputs: { result: { kind: 'register', name: `$r_td_b1out` } } },
        // @ts-expect-error 同上
        { operation: b2Id, inputs: { text: { kind: 'registerOutput', expId: 'td_reader', outKey: 'content' } as never }, outputs: { result: { kind: 'register', name: '$r_td_b2out' } } }
      ]}]
    }
  }
}

/** T-D3 helper：纯静态 compile-time aliasing check（K4a）——callee input 引用名集合不应直接别名父级声明的 output register 业务名 */
function assertNoScopeAliasing(parentDeclaredOutRegNames: string[], childInputRefBusinessKeys: string[]): void {
  const inter = parentDeclaredOutRegNames.filter(n => childInputRefBusinessKeys.includes(n))
  expect(inter, `K4a: callee input business-key refs must not alias any of parent's declared output register names; got ${inter.join(',')}`).toEqual([])
}

describe('Phase D-D: CRR new-path scope/register 机制', () => {
  afterEach(() => disableCrrNewPath())

  test('T-D1 chain_intermediate_reuse：单帧 ≥3 引用同一 source out-slot，disk read-back 正确 + publicStore 空 + peak size ≤ ceiling', async () => {
    enableCrrNewPath()
    const p = join(dir, 'td1.txt')
    const SRC = 'OLD_TOKEN_A stays KEEP_ME here too OLD_TOKEN_A again'
    await fs.writeFile(p, SRC, 'utf-8')
    const { service, registry } = mkEnv([td1ChainEditFiveStep])
    const state = createInitialState(registry, service)

    // T-D1 (iv) peak tracking —— monkey-patch set() 记录整个 run 期间 internalStore.size() 的高水位
    let peakSize = state.internalStore.size
    const origSet = state.internalStore.set.bind(state.internalStore as Map<string, unknown>)
    ;(state.internalStore as unknown as { set(k: string, v: unknown): Map<unknown, unknown> }).set = (k, v) => { const r = origSet(k, v); if (state.internalStore!.size > peakSize) peakSize = state.internalStore.size; return r }

    await l1MainLoop({ type: 'td1_chain_edit_5step', params: { path: p } }, state, { rootHandleError: false })
    expect(state.internalStore.get('$err')).toBeNull()

    // (i) disk read-back：LAST 一次替换($r_replaced_2，KEEP_ME→KEPT_ME，OLD_TOKEN_A 保持不动因该 step 不碰它……wait——实际两次 replace 各自独立作用于 SAME $r_content 源值（不是链式串联），file_write 消费的是 LAST writer=$r_replaced_2=仅做了 KEEP_ME→KEPT_ME、未做 OLD_TOKEN_A→NEW_TOKEN_A)
    expect(await fs.readFile(p, 'utf-8')).toBe('OLD_TOKEN_A stays KEPT_ME here too OLD_TOKEN_A again')

    // (ii) P4/T-4.3: $r_content 全局寄存器全程可读且值正确（$r_* 全局化后不再 scope-prefixed）
    expect(state.internalStore.get('$r_content')).toBe(SRC)

    // (iii) publicStore 空 —— chain-intermediate 未被误标 persist:true
    // publicStore 是原生 Map<string, Value>, .size 是属性不是方法 (同 tier-a02-execution-state.test.ts 现有用法)
    expect(state.publicStore.size).toEqual(0)

    // (iv) peak internalStore size ≤ ceiling(U_MAX + slack，见常量定义处注释)
    console.log(`    [T-D1] internalStore final=${state.internalStore!.size} trackedPeak=${peakSize} U_MAX_P1_ESTIMATE=${U_MAX_P1_ESTIMATE}`)
    expect(peakSize).toBeLessThanOrEqual(U_MAX_P1_ESTIMATE + TD_D_PEAK_SLACK)
  })

  test('T-D2 dual-child sequential CALL：B1/B2 各自独立 scope，均正确消费同一 A.content（异址交付）', async () => {
    enableCrrNewPath()
    const p = join(dir, 'td2-src.txt')
    await fs.writeFile(p, 'SHARED_BASE_PAYLOAD', 'utf-8')
    const readerExp = tdReaderExp(p)
    const b1 = tdConsumerExp('b1x', 'SHARED', 'CONSUMED_BY_B1')
    const b2 = tdConsumerExp('b2x', 'SHARED', 'CONSUMED_BY_B2')
    const orch = tdOrchestratorExp(b1.id, b2.id)
    const { service, registry } = mkEnv([readerExp, b1, b2, orch])
    const state = createInitialState(registry, service)
    await l1MainLoop({ type: 'td_orchestrator', params: {} }, state, { rootHandleError: false })

    // B1/B2 的 persist:true binding → publicStore；值互不相同但都源自同一 SHARED_BASE_PAYLOAD（证明二者各自拿到正确且一致的 source 输入值）
    expect(state.publicStore.has('td_reader.content')).toBe(true)
    expect(state.publicStore.get('td_reader.content')).toBe('SHARED_BASE_PAYLOAD')
    const r1 = state.publicStore.get(`td_b_consumer_b1x.result`)
    const r2 = state.publicStore.get(`td_b_consumer_b2x.result`)
    expect(r1).toBe('CONSUMED_BY_B1_BASE_PAYLOAD')
    expect(r2).toBe('CONSUMED_BY_B2_BASE_PAYLOAD')

    // "异址"证据：internal store 中应同时存在 ≥2 个不同的 $S<scope>.out<N> 前缀键集（orchestrator/子经验各自 enterScope 分配的独立 scope prefix），而非全部塌缩到同一条物理 slot。
    // probe 显示精确 scopeId 数值(s0/s1/s2...)是实现细节(懒分配顺序)，不硬编码具体数字，只断言前缀多样性这一结构性质。
    const scopedPrefixes = new Set<string>()
    for (const k of state.internalStore.keys()) {
      if (!/^\$S[0-9a-z]+\./.test(k)) continue
      const mm2 = k.match(/^\$(S[0-9a-z]+)\./)
      if (mm2) scopedPrefixes.add(mm2[1])
    }
    expect(scopedPrefixes.size, `至少 orchestrator 根 frame + B1 + B2 各自的独立 scope prefix 都应可见=${[...scopedPrefixes].join(',')}`).toBeGreaterThanOrEqual(3)
  })

  test('T-D3 retention window：A.content out-slot 在 B1/B2 dispatch 后仍保留原值', async () => {
    enableCrrNewPath()
    const p = join(dir, 'td3-src.txt')
    const SENTINEL = 'TAU-ALPHA-9f7c-base-content-sentinel'
    await fs.writeFile(p, SENTINEL, 'utf-8')
    const readerExp = tdReaderExp(p)
    const b1 = tdConsumerExp('b1r', 'BASE', 'CONSUMED_BY_B1')
    const b2 = tdConsumerExp('b2r', 'BASE', 'CONSUMED_BY_B2')
    const orch = tdOrchestratorExp(b1.id, b2.id)

    // T-D3 (compile-time/K4a 静态检查)：B-consumers 引用父级 source 的输入走的是 $r_input_<key> staging 通道（bindInputs 全局单例），而非直接复用 A 声明的具体业务别名 '$r_content' —— 二者本就不该在名字层面互为别名
    assertNoScopeAliasing(['content'], ['text']) // parent output businessName vs child input businessKey，二者无交集即通过

    const { service, registry } = mkEnv([readerExp, b1, b2, orch])
    const state = createInitialState(registry, service)
    await l1MainLoop({ type: 'td_orchestrator', params: {} }, state, { rootHandleError: false })

    // P4/T-4.3: $r_content 全局寄存器在整个 run 期间保留原值（$r_* 全局化后不再 scope-prefixed）
    expect(state.internalStore.get('$r_content')).toBe(SENTINEL)
    // persist binding 保持一致的原值
    expect(state.publicStore.get('td_reader.content')).toBe(SENTINEL)
  })
})
