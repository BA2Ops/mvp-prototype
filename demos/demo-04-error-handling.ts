/**
 * Demo 04 — 错误处置权在 L3（handleError 三态）
 *
 * 演示能力：MVP 错误模型的完整行为矩阵
 *          1. 已知错误数据化（$r_err，不抛出）
 *          2. 未知异常 throw → 无 handler → UnhandledError 冒泡到顶
 *          3. handleError=true 帧 → 异常截获，后续指令读 $r_err 继续
 *
 * 运行：npx tsx demos/demo-04-error-handling.ts
 *
 * 核心观察点：
 * - 是否抛出 vs $r_err 内容
 * - 截获后执行流是否继续
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { setupDemo, step, observe, note, verify, teardownDemo, type DemoCtx } from './lib.js'
import { l1MainLoop, UnhandledError } from '../src/l1/main-loop.js'
import { createInitialState } from '../src/l1/execution-state.js'
import { L2Registry } from '../src/l2/registry.js'
import { ExperienceService } from '../src/l3/experience-service.js'
import { CORE_EXPERIENCES } from '../src/l3/experience-library.js'
import type { Experience } from '../src/l3/experience.js'
import { fileReadOp } from '../src/l2/builtins/file-read.js'
import { evaluateExprOp } from '../src/l2/builtins/evaluate-expr.js'

const ctx = await setupDemo('Demo 04 — 错误处置权在 L3')

// ============== 准备 ==============

step('0', '准备：注册 op + 会抛硬错误的测试经验')
const registry = new L2Registry()
registry.register(fileReadOp)
registry.register(evaluateExprOp)

/** 硬错误触发器：null byte 路径 → fs 抛 ERR_INVALID_ARG_VALUE（不在已知白名单）*/
const BAD_PATH = 'bad' + String.fromCharCode(0) + 'path.txt'

/** 自处理版：handleError=true */
const fragileHandled: Experience = {
  id: 'fragile_handled', description: '意外异常在本帧截获',
  handleError: true,
  inputs: { path: { type: 'path', required: true } }, outputs: {},
  target_op: { base_op: 'file_read', default_path: 'normal', paths: [{
    id: 'normal', description: '', steps: [{
      operation: 'file_read',
      inputs: { path: { kind: 'input', name: 'path' } },
      outputs: { content: { kind: 'register', name: '$r_content' }, error: { kind: 'register', name: '$r_err' } }
    }]
  }] }
}
/** 穿透版：无标志 */
const fragileUnsafe: Experience = { ...fragileHandled, id: 'fragile_unsafe', handleError: undefined }

const service = new ExperienceService([...CORE_EXPERIENCES, fragileHandled, fragileUnsafe], registry)

async function run(type: string, params: Record<string, unknown>, rootHandle?: boolean) {
  const state = createInitialState(registry, service)
  const result: { threw: string | null; err: unknown; store: Map<string, unknown> } =
    { threw: null, err: null, store: state.internalStore as unknown as Map<string, unknown> }
  try {
    await l1MainLoop({ type, params }, state, {
      rootHandleError: rootHandle ?? service.shouldHandleError(type)
    })
  } catch (e) {
    result.threw = (e as Error).constructor.name
    result.err = e
  }
  return result
}

// ============== 步骤 1: 已知错误数据化 ==============

step('1', '已知错误（ENOENT）→ 数据化写入 $r_err，全程无异常')
{
  const r = await run('read_file', { path: join(ctx.dir, 'ghost.txt') })
  observe('是否抛出', r.threw ?? '(未抛出)')
  observe('$r_err.code', (r.store.get('$r_err') as { code: string }).code)
  note('file_read 白名单错误码（ENOENT/EACCES/EISDIR）作为返回值——上层用条件分支而非 try/catch')
  verify(ctx, 'ENOENT 数据化且不抛出', () =>
    r.threw === null && (r.store.get('$r_err') as { code: string }).code === 'ENOENT')
}

// ============== 步骤 2: 无 handler → 冒泡到顶 ==============

step('2', '未知异常 + 全链无 handler → UnhandledError 冒泡给调用者')
{
  const r = await run('fragile_unsafe', { path: BAD_PATH }, false)
  observe('抛出的异常类型', r.threw)
  note('fs 对 null byte 路径抛 ERR_INVALID_ARG_VALUE——不在白名单 → rethrow → 冒泡')
  verify(ctx, 'UnhandledError 抛到调用者', () => r.threw === 'UnhandledError')
}

// ============== 步骤 3: handleError 帧截获 ==============

step('3', 'handleError=true 经验直接运行 → 异常截获，不抛出')
{
  const r = await run('fragile_handled', { path: BAD_PATH })
  observe('是否抛出', r.threw ?? '(未抛出)')
  observe('$r_err.code', (r.store.get('$r_err') as { code: string }).code)
  verify(ctx, '异常被截获且 $r_err 记录原始错误码', () =>
    r.threw === null && (r.store.get('$r_err') as { code: string }).code === 'ERR_INVALID_ARG_VALUE')
}

// ============== 步骤 4: 子帧截获后父继续 ==============

step('4', '子帧截获 → 父经验后续步骤正常继续执行')
{
  /** 父经验：先调会失败的子经验，再用 evaluate_expr 检查 $r_err */
  const tolerantPipeline: Experience = {
    id: 'tolerant_pipeline', description: '',
    inputs: { path: { type: 'path', required: true } }, outputs: {},
    target_op: { base_op: 'evaluate_expr', default_path: 'normal', paths: [{
      id: 'normal', description: '', steps: [
        { operation: 'fragile_handled', inputs: { path: { kind: 'input', name: 'path' } }, outputs: {} },
        { operation: 'evaluate_expr',
          inputs: { expr: { kind: 'literal', value: { type: 'op', name: 'is_truthy', args: [{ type: 'var', name: '$r_err' }] } as never } },
          outputs: { result: { kind: 'register', name: '$r_had_error' }, error: { kind: 'register', name: '$r_eval_err' } } }
      ]
    }] }
  }
  const svc2 = new ExperienceService([...CORE_EXPERIENCES, fragileHandled, tolerantPipeline], registry)
  const state = createInitialState(registry, svc2)
  let threw: string | null = null
  try {
    await l1MainLoop(
      { type: 'tolerant_pipeline', params: { path: BAD_PATH } },
      state,
      { rootHandleError: false }   // 父层不兜底——若子没截获就会冒泡
    )
  } catch (e) { threw = (e as Error).constructor.name }
  observe('是否抛出', threw ?? '(未抛出)')
  observe('$r_had_error（父的后续步骤算出来的）', state.internalStore.get('$r_had_error'))
  note('子帧截获后栈顶回到子帧 → done 弹出 → 父的后续步骤照常执行并读到 $r_err')
  verify(ctx, '子帧截获异常且父后续步骤检测到错误', () =>
    threw === null && state.internalStore.get('$r_had_error') === true)
}

// ============== 结束验证 ==============

await teardownDemo(ctx)
