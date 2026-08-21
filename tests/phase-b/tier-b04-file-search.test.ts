/**
 * Phase B Tier B04 - 文件搜索 ops（glob_match + grep_search）测试
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B4
 *
 * 覆盖：
 * - glob_match: 单层/递归通配、无匹配、cwd、ENOENT
 * - grep_search: 字面量/正则匹配、目录递归、单文件、ENOENT、INVALID_REGEX
 * - 集成（l1MainLoop）：完整链路
 *
 * 测试隔离：每个测试用独立 tmpdir，预先创建测试文件
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { l1MainLoop } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { L2Registry } from '../../src/l2/registry.js'
import { isOperationError } from '../../src/l2/errors.js'
import { globMatchOp } from '../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../src/l2/builtins/grep-search.js'
import { createProgrammableL3 } from '../../src/mocks/mock-l3.js'

/**
 * 在 tmpDir 中创建标准测试目录结构：
 *   tmpDir/
 *     a.ts
 *     b.ts
 *     sub/
 *       c.ts
 *       d.js
 *     other.txt
 */
async function setupTestFiles(tmpDir: string): Promise<void> {
  await writeFile(join(tmpDir, 'a.ts'), 'const a = 1')
  await writeFile(join(tmpDir, 'b.ts'), 'const b = 2')
  await mkdir(join(tmpDir, 'sub'))
  await writeFile(join(tmpDir, 'sub', 'c.ts'), 'const c = 3')
  await writeFile(join(tmpDir, 'sub', 'd.js'), 'const d = 4')
  await writeFile(join(tmpDir, 'other.txt'), 'hello')
}

describe('B04: 文件搜索 ops（glob_match + grep_search）', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-search-test-'))
    await setupTestFiles(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ============== glob_match ==============
  describe('glob_match', () => {
    test('formalSpec 结构', () => {
      expect(globMatchOp.name).toBe('glob_match')
      expect(globMatchOp.formalSpec.inputs.pattern.required).toBe(true)
      expect(globMatchOp.formalSpec.inputs.cwd.required).toBe(false)
      expect(globMatchOp.formalSpec.outputs.matches.required).toBe(true)
      expect(globMatchOp.formalSpec.outputs.count.type).toBe('number')
    })

    test('单层通配 *.ts → 顶层 .ts 文件', async () => {
      const result = await globMatchOp.execute({
        pattern: '*.ts',
        cwd: tmpDir
      })

      expect(result.count).toBe(2)  // a.ts, b.ts
      const matches = result.matches as string[]
      expect(matches.sort()).toEqual(['a.ts', 'b.ts'])
      expect(result.error).toBeNull()
    })

    test('递归通配 **/*.ts → 所有 .ts 文件（含子目录）', async () => {
      const result = await globMatchOp.execute({
        pattern: '**/*.ts',
        cwd: tmpDir
      })

      expect(result.count).toBe(3)  // a.ts, b.ts, sub/c.ts
      const matches = result.matches as string[]
      expect(matches.sort()).toEqual(['a.ts', 'b.ts', join('sub', 'c.ts')])
      expect(result.error).toBeNull()
    })

    test('**/*.js → 只有 d.js', async () => {
      const result = await globMatchOp.execute({
        pattern: '**/*.js',
        cwd: tmpDir
      })

      expect(result.count).toBe(1)
      const matches = result.matches as string[]
      expect(matches).toEqual([join('sub', 'd.js')])
    })

    test('无匹配的模式 → count=0', async () => {
      const result = await globMatchOp.execute({
        pattern: '*.py',
        cwd: tmpDir
      })

      expect(result.count).toBe(0)
      expect(result.matches).toEqual([])
      expect(result.error).toBeNull()
    })

    test('cwd 不存在 → ENOENT（已知错误数据化）', async () => {
      const result = await globMatchOp.execute({
        pattern: '*.ts',
        cwd: join(tmpDir, 'nonexistent-dir')
      })

      expect(isOperationError(result.error)).toBe(true)
      const err = result.error as { code: string; op: string }
      expect(err.code).toBe('ENOENT')
      expect(err.op).toBe('glob_match')
      expect(result.count).toBe(0)
    })

    test('集成：完整链路（move pattern/cwd → glob_match）', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        {
          id: 'mv_pat', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: '**/*.ts' },
          to: { kind: 'internal', name: '$r0' }
        },
        {
          id: 'mv_cwd', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: tmpDir },
          to: { kind: 'internal', name: '$r1' }
        },
        {
          id: 'gm', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'glob_match',
          inputs: {
            pattern: { kind: 'internal', name: '$r0' },
            cwd: { kind: 'internal', name: '$r1' }
          },
          outputs: {
            matches: { kind: 'internal', name: '$r_matches' },
            count: { kind: 'internal', name: '$r_count' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        }
      ])
      const state = createInitialState(((): L2Registry => { const r = new L2Registry(); r.register(globMatchOp); return r })(), l3)

      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_count')).toBe(3)
      const matches = state.internalStore.get('$r_matches') as string[]
      expect(matches.sort()).toEqual(['a.ts', 'b.ts', join('sub', 'c.ts')])
      expect(state.internalStore.get('$r_err')).toBeNull()
    })
  })

  // ============== grep_search ==============
  describe('grep_search', () => {
    /**
     * 在测试文件中写可搜索内容
     * a.ts: 'const a = 1'
     * b.ts: 'const b = 2'
     * sub/c.ts: 'const c = 3'
     * sub/d.js: 'const d = 4'
     * other.txt: 'hello'
     *
     * 测试用例："const" 匹配所有 .ts 和 .js；"hello" 只匹配 other.txt
     */

    test('formalSpec 结构', () => {
      expect(grepSearchOp.name).toBe('grep_search')
      expect(grepSearchOp.formalSpec.inputs.pattern.required).toBe(true)
      expect(grepSearchOp.formalSpec.inputs.path.required).toBe(true)
      expect(grepSearchOp.formalSpec.inputs.regex.required).toBe(false)
      expect(grepSearchOp.formalSpec.outputs.matches.required).toBe(true)
    })

    test('字面量匹配：在目录中搜索 "const"', async () => {
      const result = await grepSearchOp.execute({
        pattern: 'const',
        path: tmpDir
      })

      expect(result.count).toBe(4)  // a, b, c, d 都含 'const'
      const matches = result.matches as Array<{ file: string; line: number; content: string }>
      expect(matches.every(m => m.content.includes('const'))).toBe(true)
      expect(result.error).toBeNull()
    })

    test('正则匹配：搜索 "const [a-c]"', async () => {
      const result = await grepSearchOp.execute({
        pattern: 'const [a-c]',
        path: tmpDir,
        regex: true
      })

      expect(result.count).toBe(3)  // a, b, c（不含 d）
      const matches = result.matches as Array<{ file: string; content: string }>
      const contents = matches.map(m => m.content).sort()
      expect(contents).toEqual(['const a = 1', 'const b = 2', 'const c = 3'])
    })

    test('单文件搜索：搜索 "hello" 在 other.txt', async () => {
      const result = await grepSearchOp.execute({
        pattern: 'hello',
        path: join(tmpDir, 'other.txt')
      })

      expect(result.count).toBe(1)
      const matches = result.matches as Array<{ file: string; line: number; content: string }>
      expect(matches[0].content).toBe('hello')
      expect(matches[0].line).toBe(1)
    })

    test('行号 1-indexed', async () => {
      const multiLineFile = join(tmpDir, 'multi.txt')
      await writeFile(multiLineFile, 'line1\nline2 has match\nline3')

      const result = await grepSearchOp.execute({
        pattern: 'match',
        path: multiLineFile
      })

      expect(result.count).toBe(1)
      const matches = result.matches as Array<{ line: number; content: string }>
      expect(matches[0].line).toBe(2)
      expect(matches[0].content).toBe('line2 has match')
    })

    test('无效正则 → INVALID_REGEX 错误数据', async () => {
      const result = await grepSearchOp.execute({
        pattern: '[unclosed',
        path: tmpDir,
        regex: true
      })

      expect(isOperationError(result.error)).toBe(true)
      const err = result.error as { code: string; op: string }
      expect(err.code).toBe('INVALID_REGEX')
      expect(err.op).toBe('grep_search')
      expect(result.count).toBe(0)
    })

    test('path 不存在 → ENOENT', async () => {
      const result = await grepSearchOp.execute({
        pattern: 'anything',
        path: join(tmpDir, 'nope.txt')
      })

      expect(isOperationError(result.error)).toBe(true)
      const err = result.error as { code: string }
      expect(err.code).toBe('ENOENT')
      expect(result.count).toBe(0)
    })

    test('字面量匹配转义 regex 特殊字符', async () => {
      // 创建含 regex 特殊字符的文件（不应被作为正则解析）
      const specialFile = join(tmpDir, 'special.txt')
      await writeFile(specialFile, 'value is 3.14')
      await writeFile(join(tmpDir, 'other.txt'), 'different content')  // 不匹配

      // 搜索 "3.14"（字面量，. 应被转义）
      const result = await grepSearchOp.execute({
        pattern: '3.14',
        path: tmpDir
      })

      // 应该匹配 special.txt（"3.14" 中的 . 是字面量）
      const matches = result.matches as Array<{ file: string; content: string }>
      const specialMatch = matches.find(m => m.file.endsWith('special.txt'))
      expect(specialMatch).toBeDefined()
      expect(specialMatch?.content).toBe('value is 3.14')
    })

    test('集成：完整链路（move pattern/path → grep_search → matches 列表）', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        {
          id: 'mv_pat', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: 'hello' },
          to: { kind: 'internal', name: '$r0' }
        },
        {
          id: 'mv_path', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: tmpDir },
          to: { kind: 'internal', name: '$r1' }
        },
        {
          id: 'gs', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'grep_search',
          inputs: {
            pattern: { kind: 'internal', name: '$r0' },
            path: { kind: 'internal', name: '$r1' }
          },
          outputs: {
            matches: { kind: 'internal', name: '$r_matches' },
            count: { kind: 'internal', name: '$r_count' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        }
      ])
      const state = createInitialState(((): L2Registry => { const r = new L2Registry(); r.register(grepSearchOp); return r })(), l3)

      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_count')).toBe(1)  // only other.txt
      const matches = state.internalStore.get('$r_matches') as Array<{ file: string; content: string }>
      expect(matches[0].content).toBe('hello')
      expect(state.internalStore.get('$r_err')).toBeNull()
    })
  })
})