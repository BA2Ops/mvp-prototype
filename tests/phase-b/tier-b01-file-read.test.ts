/**
 * Phase B Tier B01 - file_read operation（真实实现）测试
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/10-reactive-execution-model.md §三.8
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B1
 *
 * 覆盖：
 * 1. formalSpec 结构验证（register 映射）
 * 2. execute 单元：成功 / ENOENT / EISDIR / 默认 encoding / 自定义 encoding
 * 3. 集成（l1MainLoop）：成功路径、错误路径、conditional_skip + $r_err 流转
 * 4. 集成：throw 异常冒泡（handleError 截获 + 无 handler 抛 UnhandledError）
 *
 * 测试隔离：每个测试用独立的 tmpdir（Node os.tmpdir + mkdtemp）
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { l1MainLoop, UnhandledError } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import type { ExecutionState } from '../../src/l1/execution-state.js'
import type { RecognizedIntent, StackEntry } from '../../src/l1/types.js'
import { L2Registry } from '../../src/l2/registry.js'
import { isOperationError } from '../../src/l2/errors.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { createProgrammableL3 } from '../../src/mocks/mock-l3.js'

describe('B01: file_read operation（真实实现）', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-read-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ============== formalSpec ==============
  describe('formalSpec', () => {
    test('op 名称与 description', () => {
      expect(fileReadOp.name).toBe('file_read')
      expect(fileReadOp.description).toBeTruthy()
    })

    test('inputs：path (required) + encoding (optional)', () => {
      expect(fileReadOp.formalSpec.inputs.path.businessName).toBe('path')
      expect(fileReadOp.formalSpec.inputs.path.register).toBe('$r0')
      expect(fileReadOp.formalSpec.inputs.path.required).toBe(true)

      expect(fileReadOp.formalSpec.inputs.encoding.required).toBe(false)
    })

    test('outputs：content + error($r_err)', () => {
      expect(fileReadOp.formalSpec.outputs.content.register).toBe('$r2')
      expect(fileReadOp.formalSpec.outputs.error.register).toBe('$r_err')
    })
  })

  // ============== execute 单元 ==============
  describe('execute 单元测试', () => {
    test('读存在的文件（默认 utf-8）', async () => {
      const filePath = join(tmpDir, 'hello.txt')
      await writeFile(filePath, 'hello world', 'utf-8')

      const result = await fileReadOp.execute({ path: filePath })

      expect(result.content).toBe('hello world')
      expect(result.error).toBeNull()
    })

    test('读存在的文件（自定义 encoding）', async () => {
      const filePath = join(tmpDir, 'data.txt')
      await writeFile(filePath, 'abc', 'utf-8')

      const result = await fileReadOp.execute({
        path: filePath,
        encoding: 'utf-8'
      })

      expect(result.content).toBe('abc')
      expect(result.error).toBeNull()
    })

    test('文件不存在 → ENOENT（已知错误作为数据）', async () => {
      const nonExistent = join(tmpDir, 'nope.txt')

      const result = await fileReadOp.execute({ path: nonExistent })

      expect(result.content).toBeNull()
      expect(isOperationError(result.error)).toBe(true)
      const err = result.error as { code: string; op: string; message: string }
      expect(err.code).toBe('ENOENT')
      expect(err.op).toBe('file_read')
      expect(err.message).toBeTruthy()
      expect(err.timestamp).toBeGreaterThan(0)
    })

    test('路径是目录 → EISDIR（已知错误作为数据）', async () => {
      const dirPath = join(tmpDir, 'isadir')
      await mkdir(dirPath)

      const result = await fileReadOp.execute({ path: dirPath })

      expect(result.content).toBeNull()
      expect(isOperationError(result.error)).toBe(true)
      const err = result.error as { code: string; op: string }
      expect(err.code).toBe('EISDIR')
      expect(err.op).toBe('file_read')
    })

    test('非法 path（null）→ throw 非白名单错误', async () => {
      // fs.readFile(null) 抛 TypeError，code 不在 ENOENT/EACCES/EISDIR 白名单
      // → 走 throw 路径（非数据返回）
      try {
        const result = await fileReadOp.execute({
          path: null as unknown as string
        })
        expect(result).toBeUndefined()
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        const code = (err as NodeJS.ErrnoException).code
        expect(['ENOENT', 'EACCES', 'EISDIR']).not.toContain(code)
      }
    })
  })

  // ============== 集成测试（l1MainLoop） ==============
  describe('集成：l1MainLoop + file_read', () => {
    function realL2Registry(): L2Registry {
      const r = new L2Registry()
      r.register(fileReadOp)
      return r
    }

    /**
     * 简化线性 children：[move(path), file_read]
     * 验证 file_read 与 L1 + L3 的数据流（写 $r_content + $r_err）
     */
    function setupRead(filePath: string): ReturnType<typeof createProgrammableL3> {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        {
          id: 'mv', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: filePath },
          to: { kind: 'internal', name: '$r0' }
        },
        {
          id: 'fr', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'file_read',
          inputs: { path: { kind: 'internal', name: '$r0' } },
          outputs: {
            content: { kind: 'internal', name: '$r_content' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        }
      ])
      return l3
    }

    test('成功读文件：写 $r_content，$r_err=null', async () => {
      await writeFile(join(tmpDir, 'plan.txt'), 'file content', 'utf-8')
      const l3 = setupRead(join(tmpDir, 'plan.txt'))
      const state = createInitialState(realL2Registry(), l3)

      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_content')).toBe('file content')
      expect(state.internalStore.get('$r_err')).toBeNull()
      expect(state.stack.length).toBe(0)
      expect(state.recursionDepth.size).toBe(0)
    })

    test('文件不存在（ENOENT）：写 $r_err（业务错误数据），content=null', async () => {
      const l3 = setupRead(join(tmpDir, 'missing.txt'))
      const state = createInitialState(realL2Registry(), l3)

      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_content')).toBeNull()
      const errVal = state.internalStore.get('$r_err')
      expect(isOperationError(errVal)).toBe(true)
      const err = errVal as { code: string; op: string }
      expect(err.code).toBe('ENOENT')
      expect(err.op).toBe('file_read')
      // ENOENT 不抛错，主循环正常完成
      expect(state.stack.length).toBe(0)
    })

    test('后续 DAG 可读 $r_err 判断处理路径（business-error-as-data 模式）', async () => {
      // children = [move, file_read, cs(if_error, n=1), marker]
      // ENOENT 路径：cs truthy → pop self + marker → 不写 marker
      // success 路径：cs falsy → 仅 pop self → 写 marker
      const l3 = createProgrammableL3()
      const filePath = join(tmpDir, 'missing.txt')
      l3.setChildren('plan', [
        {
          id: 'mv', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: filePath },
          to: { kind: 'internal', name: '$r0' }
        },
        {
          id: 'fr', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'file_read',
          inputs: { path: { kind: 'internal', name: '$r0' } },
          outputs: {
            content: { kind: 'internal', name: '$r_content' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        },
        {
          id: 'cs', parentIntentId: null, createdAt: 0,
          kind: 'conditional_skip',
          conditionAddr: { kind: 'internal', name: '$r_err' },
          n: 1
        },
        {
          id: 'marker', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: 'success_marker' },
          to: { kind: 'internal', name: '$r_marker' }
        }
      ])
      const state = createInitialState(realL2Registry(), l3)

      await l1MainLoop({ type: 'plan', params: {} }, state)

      // ENOENT → cs truthy → 跳过 marker → $r_marker 未定义
      expect(state.internalStore.get('$r_marker')).toBeUndefined()
      const errVal = state.internalStore.get('$r_err') as { code: string }
      expect(errVal.code).toBe('ENOENT')
    })
  })

  // ============== 集成：throw 异常走 L1 冒泡 ==============
  describe('集成：throw 异常走 L1 冒泡', () => {
    test('op throw 非白名单错误 → 异常冒泡 → handleError 帧截获', async () => {
      const l3 = createProgrammableL3()
      const l2 = new L2Registry()
      l2.register(fileReadOp)
      // 抛错 op（模拟未知 fs 错误）
      l2.register({
        name: 'thrower',
        description: 'op that throws a non-whitelisted error',
        formalSpec: {
          inputs: { dummy: { businessName: 'dummy', register: '$r0', type: 'any', required: true } },
          outputs: {
            result: { businessName: 'result', register: '$r1', type: 'any', required: true },
            error: { businessName: 'error', register: '$r_err', type: 'object', required: false }
          }
        },
        execute: async () => {
          throw new Error('unknown fs failure: EIO-equivalent')
        }
      })

      // root → guarded(handleError=true) → thrower_op
      l3.setChildren('root', [
        {
          id: 'guarded', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent',
          intent: { type: 'guarded', params: {} },
          phase: 'pending', children: [], handleError: true
        },
        {
          id: 'after', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: 'recovery_done' },
          to: { kind: 'internal', name: '$r_after' }
        }
      ])
      l3.setChildren('guarded', [
        {
          id: 'op', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'thrower',
          inputs: { dummy: { kind: 'literal', value: 1 } },
          outputs: {
            result: { kind: 'internal', name: '$r_op_result' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        }
      ])

      const state = createInitialState(l2, l3)
      await l1MainLoop({ type: 'root', params: {} }, state)

      expect(state.internalStore.get('$r_after')).toBe('recovery_done')
      expect(state.internalStore.get('$r_err')).toBeDefined()
      expect(state.recursionDepth.size).toBe(0)
    })

    test('op throw + 无 handler → UnhandledError 给调用者', async () => {
      const l3 = createProgrammableL3()
      const l2 = new L2Registry()
      l2.register(fileReadOp)
      l2.register({
        name: 'thrower',
        description: 'throw non-whitelisted',
        formalSpec: { inputs: {}, outputs: {} },
        execute: async () => {
          throw new Error('unknown fs failure')
        }
      })

      l3.setChildren('root', [
        {
          id: 'op', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'thrower',
          inputs: {}, outputs: {}, status: 'pending'
        }
      ])
      const state = createInitialState(l2, l3)

      await expect(
        l1MainLoop({ type: 'root', params: {} }, state)
      ).rejects.toThrow(UnhandledError)
    })
  })
})