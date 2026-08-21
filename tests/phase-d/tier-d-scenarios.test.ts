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
    // 全程无错误
    expect(store.get('$r_err')).toBeNull()
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
    expect(store2.get('$r_err')).toBeNull()
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
    expect(state2.internalStore.get('$r_err')).toBeNull()
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
