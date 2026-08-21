/**
 * Phase C Tier C5 - 核心经验库 E2E 测试
 *
 * @see ../../src/l3/experience-library.ts
 *
 * 每条经验走完整链路：l1MainLoop → L3 compile（真实编译器）→ L1 执行 → L2 真实 op。
 * 文件类经验用真实 tmpdir（与 Phase B 测试一致）。
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { l1MainLoop } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { L2Registry } from '../../src/l2/registry.js'
import { ExperienceService } from '../../src/l3/experience-service.js'
import { CORE_EXPERIENCES, createCoreLibrary } from '../../src/l3/experience-library.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { shellExecOp } from '../../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../../src/l2/builtins/evaluate-expr.js'

// ============== 测试环境 ==============

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'c5-exp-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function mkEnv(): { service: ExperienceService; registry: L2Registry } {
  const registry = new L2Registry()
  registry.register(fileReadOp)
  registry.register(fileWriteOp)
  registry.register(shellExecOp)
  registry.register(globMatchOp)
  registry.register(grepSearchOp)
  registry.register(stringReplaceOp)
  registry.register(evaluateExprOp)
  return { service: new ExperienceService(CORE_EXPERIENCES, registry), registry }
}

/** E2E：运行经验并返回 internalStore */
async function run(expId: string, params: Record<string, unknown>): Promise<Map<string, unknown>> {
  const { service, registry } = mkEnv()
  const state = createInitialState(registry, service)
  await l1MainLoop({ type: expId, params }, state, service.shouldHandleError(expId))
  return state.internalStore as unknown as Map<string, unknown>
}

// ============== 库结构 ==============

describe('C5: 经验库结构', () => {
  test('9 条经验，id 唯一', () => {
    expect(CORE_EXPERIENCES).toHaveLength(9)
    const ids = CORE_EXPERIENCES.map(e => e.id)
    expect(new Set(ids).size).toBe(9)
  })

  test('每条经验都有 target_op + default_path 指向存在的 path', () => {
    for (const exp of CORE_EXPERIENCES) {
      expect(exp.target_op.paths.length).toBeGreaterThan(0)
      const pathIds = exp.target_op.paths.map(p => p.id)
      expect(pathIds).toContain(exp.target_op.default_path)
      // judgment 引用的 path 都存在
      for (const j of exp.conditional_judgment ?? []) {
        expect(pathIds).toContain(j.then_path)
        if (j.else_path) expect(pathIds).toContain(j.else_path)
      }
    }
  })

  test('每条经验的 steps.operation 都已注册（L2 op 或经验 id）', () => {
    const lib = createCoreLibrary()
    const opNames = new Set([
      'file_read', 'file_write', 'shell_exec', 'glob_match',
      'grep_search', 'string_replace', 'evaluate_expr'
    ])
    for (const exp of CORE_EXPERIENCES) {
      for (const pp of exp.pre_processing ?? []) {
        expect(opNames.has(pp.operation) || lib.has(pp.operation)).toBe(true)
      }
      for (const path of exp.target_op.paths) {
        for (const step of path.steps) {
          expect(opNames.has(step.operation) || lib.has(step.operation)).toBe(true)
        }
      }
    }
  })

  test('handleError 标志：read_file_with_default / check_file_exists / safe_write / replace_in_file 为 true', () => {
    const byId = createCoreLibrary()
    expect(byId.get('read_file_with_default')?.handleError).toBe(true)
    expect(byId.get('check_file_exists')?.handleError).toBe(true)
    expect(byId.get('safe_write')?.handleError).toBe(true)
    expect(byId.get('replace_in_file')?.handleError).toBe(true)
    expect(byId.get('read_file')?.handleError ?? false).toBe(false)
    expect(byId.get('write_file')?.handleError ?? false).toBe(false)
  })
})

// ============== E2E：逐条经验 ==============

describe('C5: read_file / read_file_with_default', () => {
  test('read_file：读存在的文件', async () => {
    const p = join(dir, 'a.txt')
    await fs.writeFile(p, 'hello c5', 'utf-8')
    const store = await run('read_file', { path: p })
    expect(store.get('$r_content')).toBe('hello c5')
  })

  test('read_file_with_default：文件存在 → 真实内容', async () => {
    const p = join(dir, 'b.txt')
    await fs.writeFile(p, 'real', 'utf-8')
    const store = await run('read_file_with_default', { path: p, default_content: 'DFT' })
    expect(store.get('$r_content')).toBe('real')
  })

  test('read_file_with_default：文件不存在 → 默认内容（运行时分支）', async () => {
    const p = join(dir, 'missing.txt')
    const store = await run('read_file_with_default', { path: p, default_content: 'DFT' })
    expect(store.get('$r_content')).toBe('DFT')
  })
})

describe('C5: check_file_exists / write_file / safe_write', () => {
  test('check_file_exists：存在 → true', async () => {
    const p = join(dir, 'c.txt')
    await fs.writeFile(p, 'x', 'utf-8')
    const store = await run('check_file_exists', { path: p })
    expect(store.get('$r_exists')).toBe(true)
  })

  test('check_file_exists：不存在 → false', async () => {
    const store = await run('check_file_exists', { path: join(dir, 'nope.txt') })
    expect(store.get('$r_exists')).toBe(false)
  })

  test('write_file：写入并落盘', async () => {
    const p = join(dir, 'd.txt')
    const store = await run('write_file', { path: p, content: 'written' })
    expect(store.get('$r_bytes')).toBe(7)
    expect(await fs.readFile(p, 'utf-8')).toBe('written')
  })

  test('safe_write：目标不存在 → 写入', async () => {
    const p = join(dir, 'e.txt')
    const store = await run('safe_write', { path: p, content: 'new' })
    expect(store.get('$r_bytes')).toBe(3)
    expect(await fs.readFile(p, 'utf-8')).toBe('new')
  })

  test('safe_write：目标已存在 → 跳过（不覆盖）', async () => {
    const p = join(dir, 'f.txt')
    await fs.writeFile(p, 'original', 'utf-8')
    const store = await run('safe_write', { path: p, content: 'overwrite!' })
    expect(store.get('$r_bytes')).toBe(0)
    expect(await fs.readFile(p, 'utf-8')).toBe('original')
  })
})

describe('C5: find_files / search_in_files', () => {
  test('find_files：glob 匹配', async () => {
    await fs.writeFile(join(dir, 'x.log'), '1', 'utf-8')
    await fs.writeFile(join(dir, 'y.log'), '2', 'utf-8')
    await fs.writeFile(join(dir, 'z.txt'), '3', 'utf-8')
    const store = await run('find_files', { pattern: '*.log', cwd: dir })
    expect(store.get('$r_count')).toBe(2)
  })

  test('search_in_files：grep 命中', async () => {
    const p = join(dir, 'g.txt')
    await fs.writeFile(p, 'alpha\nbeta\ngamma', 'utf-8')
    const store = await run('search_in_files', { pattern: 'beta', path: p })
    expect(store.get('$r_count')).toBe(1)
  })
})

describe('C5: run_shell', () => {
  test('执行 node -e 并拿到 stdout', async () => {
    const store = await run('run_shell', {
      command: process.execPath,
      args: ['-e', 'process.stdout.write("shell-ok")']
    })
    expect(store.get('$r_stdout')).toBe('shell-ok')
    expect(store.get('$r_exit')).toBe(0)
  })
})

describe('C5: replace_in_file', () => {
  test('三步链：读 → 替换 → 写', async () => {
    const p = join(dir, 'h.txt')
    await fs.writeFile(p, 'foo bar foo', 'utf-8')
    const store = await run('replace_in_file', {
      path: p, find: 'foo', replace: 'baz'
    })
    expect(store.get('$r_count')).toBe(2)
    expect(await fs.readFile(p, 'utf-8')).toBe('baz bar baz')
  })
})
