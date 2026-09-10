/**
 * Phase C Tier C6 - 完整 E2E：嵌套 experience + handleError 异常截获
 *
 * @see ../../src/l3/compiler.ts（makeNestedIntent / D-C4-3）
 * @see ../../src/l1/main-loop.ts（bubbleError 语义）
 *
 * 场景矩阵：
 * - S1 嵌套调用：父经验 step 引用经验 ID → IntentEntry 嵌套（params 仅 literal/input）
 * - S2 子帧自处理：子经验 handleError=true，异常在子帧截获，父继续
 * - S3 父帧处理：父 handleError=true，无标志子树被丢弃，父的剩余 children（catch 逻辑）保留执行
 * - S4 无处理器：异常冒泡到顶 → l1MainLoop reject（UnhandledError）
 *
 * 硬错误触发方式：fs.readFile('bad\0path') 抛 ERR_INVALID_ARG_VALUE
 * （不在 file_read 已知错误码列表内 → rethrow → L1 bubbleError）
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { l1MainLoop, UnhandledError } from '../../src/l1/main-loop.js'
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
import { evaluateCollectionOp } from '../../src/l2/builtins/evaluate-collection.js'

// ============== 测试环境 ==============

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'c6-e2e-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

// ============== 测试经验（fixtures）==============

/** 会抛硬错误的读文件（坏路径）——自处理版 */
const fragileHandled: Experience = {
  id: 'fragile_read_handled',
  description: '读文件；意外异常在本帧截获',
  handleError: true,
  inputs: { path: { type: 'path', required: true } },
  outputs: {},
  target_op: {
    base_op: 'file_read', default_path: 'normal',
    paths: [{ id: 'normal', description: '', steps: [{
      operation: 'file_read',
      inputs: { path: { kind: 'input', name: 'path' } },
      outputs: {
        content: { kind: 'register', name: '$r_content' },
        error: { kind: 'register', name: '$r_err' }
      }
    }] }]
  }
}

/** 会抛硬错误的读文件——不处理版（异常穿透） */
const fragileUnsafe: Experience = {
  ...fragileHandled,
  id: 'fragile_read_unsafe',
  description: '读文件；异常向上冒泡',
  handleError: undefined
}

/** S1: 嵌套 safe_write 的初始化配置经验 */
const initConfig: Experience = {
  id: 'init_config',
  description: '初始化配置文件（已存在则不动）——嵌套核心经验 safe_write',
  inputs: { path: { type: 'path', required: true } },
  outputs: {},
  target_op: {
    base_op: 'safe_write', default_path: 'normal',
    paths: [{ id: 'normal', description: '', steps: [{
      operation: 'safe_write',   // ← 经验 ID → 嵌套 IntentEntry
      inputs: {
        path: { kind: 'input', name: 'path' },
        content: { kind: 'literal', value: '[default]\nmode=demo' }
      },
      outputs: {}
    }] }]
  }
}

/** S2: 宽容管道——子经验自处理，父后续步骤检查 $r_err */
const tolerantPipeline: Experience = {
  id: 'tolerant_pipeline',
  description: '子帧自处理后，父检查 $r_err',
  inputs: { path: { type: 'path', required: true } },
  outputs: {},
  target_op: {
    base_op: 'evaluate_expr', default_path: 'normal',
    paths: [{ id: 'normal', description: '', steps: [
      {
        operation: 'fragile_read_handled',   // 嵌套（handleError=true）
        inputs: { path: { kind: 'input', name: 'path' } },
        outputs: {}
      },
      {
        operation: 'evaluate_expr',
        inputs: { expr: { kind: 'literal', value: {
          type: 'op', name: 'is_truthy', args: [{ type: 'var', name: '$r_err' }]
        } as unknown as Value } },
        outputs: {
          result: { kind: 'register', name: '$r_had_error' },
          error: { kind: 'register', name: '$r_eval_err' }
        }
      }
    ] }]
  }
}

/** S3: 严格管道——父是 handler，子的异常子树被丢弃，父剩余 children（catch 逻辑）保留 */
const strictPipeline: Experience = {
  ...tolerantPipeline,
  id: 'strict_pipeline',
  description: '父帧截获子的异常，catch 步骤执行',
  handleError: true,
  target_op: {
    base_op: 'evaluate_expr', default_path: 'normal',
    paths: [{ id: 'normal', description: '', steps: [
      {
        operation: 'fragile_read_unsafe',   // 嵌套（无标志 → 异常穿透到父）
        inputs: { path: { kind: 'input', name: 'path' } },
        outputs: {}
      },
      {
        operation: 'evaluate_expr',          // ← catch 逻辑（保留执行）
        inputs: { expr: { kind: 'literal', value: {
          type: 'op', name: 'is_truthy', args: [{ type: 'var', name: '$r_err' }]
        } as unknown as Value } },
        outputs: {
          result: { kind: 'register', name: '$r_had_error' },
          error: { kind: 'register', name: '$r_eval_err' }
        }
      }
    ] }]
  }
}

/** S4: 全无标志管道——子的异常穿透到顶 */
const naivePipeline: Experience = {
  ...tolerantPipeline,
  id: 'naive_pipeline',
  description: '全链无 handler，异常冒泡到顶',
  handleError: undefined,
  target_op: {
    base_op: 'evaluate_expr', default_path: 'normal',
    paths: [{ id: 'normal', description: '', steps: [{
      operation: 'fragile_read_unsafe',   // 嵌套（无标志）
      inputs: { path: { kind: 'input', name: 'path' } },
      outputs: {}
    }] }]
  }
}

const FIXTURES: Experience[] = [fragileHandled, fragileUnsafe, initConfig, tolerantPipeline, strictPipeline, naivePipeline]

function mkEnv(rootHandle?: boolean): { service: ExperienceService; registry: L2Registry } {
  const registry = new L2Registry()
  registry.register(fileReadOp)
  registry.register(fileWriteOp)
  registry.register(shellExecOp)
  registry.register(globMatchOp)
  registry.register(grepSearchOp)
  registry.register(stringReplaceOp)
  registry.register(evaluateExprOp); registry.register(evaluateCollectionOp)
  const service = new ExperienceService([...CORE_EXPERIENCES, ...FIXTURES], registry)
  void rootHandle
  return { service, registry }
}

async function run(
  expId: string,
  params: Record<string, unknown>,
  rootHandle?: boolean
): Promise<Map<string, unknown>> {
  const { service, registry } = mkEnv()
  const state = createInitialState(registry, service)
  await l1MainLoop(
    { type: expId, params },
    state,
    { rootHandleError: rootHandle ?? service.shouldHandleError(expId) }
  )
  return state.internalStore as unknown as Map<string, unknown>
}

// ============== S1: 嵌套 experience ==============

describe('C6-S1: 嵌套 experience 调用', () => {
  test('init_config → 嵌套 safe_write：目标不存在 → 写入默认配置', async () => {
    const p = join(dir, 'app.ini')
    await run('init_config', { path: p })
    expect(await fs.readFile(p, 'utf-8')).toBe('[default]\nmode=demo')
  })

  test('init_config → 嵌套 safe_write：目标已存在 → 不覆盖', async () => {
    const p = join(dir, 'app.ini')
    await fs.writeFile(p, 'user-custom=1', 'utf-8')
    await run('init_config', { path: p })
    expect(await fs.readFile(p, 'utf-8')).toBe('user-custom=1')
  })

  test('嵌套参数含 register 引用 → 编译期抛错（MVP 限制）', () => {
    const { service, registry } = mkEnv()
    const badStep: Experience = {
      id: 'bad_nested',
      inputs: {},
      outputs: {},
      target_op: {
        base_op: 'x', default_path: 'normal',
        paths: [{ id: 'normal', description: '', steps: [{
          operation: 'write_file',
          inputs: { content: { kind: 'register', name: '$r_something' } },
          outputs: {}
        }] }]
      }
    }
    const svc = new ExperienceService([...CORE_EXPERIENCES, badStep], registry)
    const state = createInitialState(registry, svc)
    expect(() =>
      svc.compile({ type: 'bad_nested', params: {} }, state)
    ).toThrow(/register ref.*not supported/i)
  })
})

// ============== S2: 子帧自处理 ==============

describe('C6-S2: 子帧 handleError 自处理', () => {
  test('宽容管道：子截获异常 → 父后续步骤读到 $r_err', async () => {
    const store = await run('tolerant_pipeline', { path: 'bad\0path.txt' })
    expect((store.get('$r_err') as { code: string }).code).toBe('ERR_INVALID_ARG_VALUE')
    expect(store.get('$r_had_error')).toBe(true)
  })

  test('根层直接运行自处理经验：不抛出，$r_err 数据化', async () => {
    const store = await run('fragile_read_handled', { path: 'bad\0path.txt' })
    expect((store.get('$r_err') as { code: string }).code).toBe('ERR_INVALID_ARG_VALUE')
  })
})

// ============== S3: 父帧处理（catch 逻辑保留）==============

describe('C6-S3: 父帧截获子的异常', () => {
  test('严格管道：无标志子树被丢弃，父的 catch 步骤执行', async () => {
    const store = await run('strict_pipeline', { path: 'bad\0path.txt' })
    expect((store.get('$r_err') as { code: string }).code).toBe('ERR_INVALID_ARG_VALUE')
    expect(store.get('$r_had_error')).toBe(true)  // catch 步骤确实运行了
  })
})

// ============== S4: 无处理器 → 冒泡到顶 ==============

describe('C6-S4: 无处理器冒泡', () => {
  test('根层无标志：l1MainLoop reject（UnhandledError）', async () => {
    const { service, registry } = mkEnv()
    const state = createInitialState(registry, service)
    await expect(
      l1MainLoop({ type: 'fragile_read_unsafe', params: { path: 'bad\0path.txt' } }, state, { rootHandleError: false })
    ).rejects.toBeInstanceOf(UnhandledError)
  })

  test('嵌套链全无标志：同样冒泡到顶', async () => {
    const { service, registry } = mkEnv()
    const state = createInitialState(registry, service)
    await expect(
      l1MainLoop({ type: 'naive_pipeline', params: { path: 'bad\0path.txt' } }, state, { rootHandleError: false })
    ).rejects.toBeInstanceOf(UnhandledError)
  })
})
