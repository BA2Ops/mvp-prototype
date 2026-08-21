/**
 * Phase B Tier B02 - file_write operation（真实实现）测试
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B2
 *
 * 覆盖：
 * 1. formalSpec 结构验证
 * 2. execute 单元：overwrite / append / encoding / 已知错误码 / throw
 * 3. 集成（l1MainLoop）：完整写入 + 读回验证（file_write + file_read 串联）
 *
 * 测试隔离：每个测试用独立的 tmpdir
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { l1MainLoop } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import type { ExecutionState } from '../../src/l1/execution-state.js'
import { L2Registry } from '../../src/l2/registry.js'
import { isOperationError } from '../../src/l2/errors.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { createProgrammableL3 } from '../../src/mocks/mock-l3.js'

describe('B02: file_write operation（真实实现）', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-write-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ============== formalSpec ==============
  describe('formalSpec', () => {
    test('op 名称与 description', () => {
      expect(fileWriteOp.name).toBe('file_write')
      expect(fileWriteOp.description).toBeTruthy()
    })

    test('inputs：path + content (required), mode + encoding (optional)', () => {
      expect(fileWriteOp.formalSpec.inputs.path.required).toBe(true)
      expect(fileWriteOp.formalSpec.inputs.content.required).toBe(true)
      expect(fileWriteOp.formalSpec.inputs.mode.required).toBe(false)
      expect(fileWriteOp.formalSpec.inputs.encoding.required).toBe(false)
    })

    test('outputs：bytes_written + error($r_err)', () => {
      expect(fileWriteOp.formalSpec.outputs.bytes_written.register).toBe('$r4')
      expect(fileWriteOp.formalSpec.outputs.bytes_written.type).toBe('number')
      expect(fileWriteOp.formalSpec.outputs.error.register).toBe('$r_err')
    })
  })

  // ============== execute 单元 ==============
  describe('execute 单元测试', () => {
    test('写入新文件（默认 overwrite）', async () => {
      const filePath = join(tmpDir, 'new.txt')
      const result = await fileWriteOp.execute({
        path: filePath,
        content: 'hello'
      })

      expect(result.bytes_written).toBe(5)
      expect(result.error).toBeNull()
      // 实际文件验证
      const actual = await readFile(filePath, 'utf-8')
      expect(actual).toBe('hello')
    })

    test('overwrite 模式覆盖已有文件', async () => {
      const filePath = join(tmpDir, 'exist.txt')
      await writeFile(filePath, 'OLD', 'utf-8')

      const result = await fileWriteOp.execute({
        path: filePath,
        content: 'NEW'
      })

      expect(result.bytes_written).toBe(3)
      const actual = await readFile(filePath, 'utf-8')
      expect(actual).toBe('NEW')
    })

    test('append 模式追加内容', async () => {
      const filePath = join(tmpDir, 'log.txt')
      await writeFile(filePath, 'line1\n', 'utf-8')

      const result = await fileWriteOp.execute({
        path: filePath,
        content: 'line2\n',
        mode: 'append'
      })

      expect(result.bytes_written).toBe(6)
      const actual = await readFile(filePath, 'utf-8')
      expect(actual).toBe('line1\nline2\n')
    })

    test('自定义 encoding', async () => {
      const filePath = join(tmpDir, 'utf8.txt')
      const result = await fileWriteOp.execute({
        path: filePath,
        content: 'abc',
        encoding: 'utf-8'
      })

      expect(result.bytes_written).toBe(3)
    })

    test('非 ASCII 内容字节数计算正确（utf-8 多字节）', async () => {
      const filePath = join(tmpDir, 'cjk.txt')
      const content = '你好'  // 6 字节（utf-8）
      const result = await fileWriteOp.execute({
        path: filePath,
        content
      })

      expect(result.bytes_written).toBe(6)  // Buffer.byteLength('你好') = 6
    })

    test('父目录不存在 → ENOENT（已知错误作为数据）', async () => {
      const nonExistDir = join(tmpDir, 'nonexistent', 'file.txt')

      const result = await fileWriteOp.execute({
        path: nonExistDir,
        content: 'data'
      })

      expect(result.bytes_written).toBe(0)
      expect(isOperationError(result.error)).toBe(true)
      const err = result.error as { code: string; op: string }
      expect(err.code).toBe('ENOENT')
      expect(err.op).toBe('file_write')
    })

    test('路径是目录 → EISDIR（已知错误作为数据）', async () => {
      const dirPath = join(tmpDir, 'isadir')
      await mkdir(dirPath)

      const result = await fileWriteOp.execute({
        path: dirPath,
        content: 'data'
      })

      expect(result.bytes_written).toBe(0)
      expect(isOperationError(result.error)).toBe(true)
      const err = result.error as { code: string }
      expect(err.code).toBe('EISDIR')
    })

    test('非法 path（null）→ throw 非白名单错误', async () => {
      try {
        await fileWriteOp.execute({
          path: null as unknown as string,
          content: 'data'
        })
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        const code = (err as NodeJS.ErrnoException).code
        expect(['ENOENT', 'EACCES', 'EISDIR']).not.toContain(code)
      }
    })
  })

  // ============== 集成测试（l1MainLoop） ==============
  describe('集成：l1MainLoop + file_write', () => {
    function realL2Registry(): L2Registry {
      const r = new L2Registry()
      r.register(fileWriteOp)
      r.register(fileReadOp)
      return r
    }

    test('完整写入链路：move path/content → file_write → 真实文件写入', async () => {
      const filePath = join(tmpDir, 'integration.txt')
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        {
          id: 'mv_path', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: filePath },
          to: { kind: 'internal', name: '$r0' }
        },
        {
          id: 'mv_content', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: 'integration test content' },
          to: { kind: 'internal', name: '$r1' }
        },
        {
          id: 'fw', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'file_write',
          inputs: {
            path: { kind: 'internal', name: '$r0' },
            content: { kind: 'internal', name: '$r1' }
          },
          outputs: {
            bytes_written: { kind: 'internal', name: '$r_bytes' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        }
      ])
      const state = createInitialState(realL2Registry(), l3)

      await l1MainLoop({ type: 'plan', params: {} }, state)

      // 验证 $r_bytes（24 字节）
      expect(state.internalStore.get('$r_bytes')).toBe(24)
      expect(state.internalStore.get('$r_err')).toBeNull()
      // 实际文件验证
      const actual = await readFile(filePath, 'utf-8')
      expect(actual).toBe('integration test content')
      expect(state.stack.length).toBe(0)
    })

    test('file_write + file_read 串联（写后读）', async () => {
      const filePath = join(tmpDir, 'roundtrip.txt')
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        {
          id: 'mv_path', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: filePath },
          to: { kind: 'internal', name: '$r_path' }
        },
        {
          id: 'mv_content', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: 'roundtrip data' },
          to: { kind: 'internal', name: '$r_content' }
        },
        {
          id: 'fw', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'file_write',
          inputs: {
            path: { kind: 'internal', name: '$r_path' },
            content: { kind: 'internal', name: '$r_content' }
          },
          outputs: {
            bytes_written: { kind: 'internal', name: '$r_bytes' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        },
        {
          id: 'fr', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'file_read',
          inputs: { path: { kind: 'internal', name: '$r_path' } },
          outputs: {
            content: { kind: 'internal', name: '$r_read' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        }
      ])
      const state = createInitialState(realL2Registry(), l3)

      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_bytes')).toBe(14)
      expect(state.internalStore.get('$r_read')).toBe('roundtrip data')
      expect(state.internalStore.get('$r_err')).toBeNull()
    })

    test('ENOENT 路径：file_write 返回错误数据，DAG 可通过 $r_err 判断', async () => {
      const l3 = createProgrammableL3()
      const nonExistDir = join(tmpDir, 'nonexistent', 'file.txt')
      l3.setChildren('plan', [
        {
          id: 'mv_path', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: nonExistDir },
          to: { kind: 'internal', name: '$r0' }
        },
        {
          id: 'mv_content', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: 'data' },
          to: { kind: 'internal', name: '$r1' }
        },
        {
          id: 'fw', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'file_write',
          inputs: {
            path: { kind: 'internal', name: '$r0' },
            content: { kind: 'internal', name: '$r1' }
          },
          outputs: {
            bytes_written: { kind: 'internal', name: '$r_bytes' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        },
        {
          id: 'cs', parentIntentId: null, createdAt: 0,
          kind: 'conditional_skip',
          conditionAddr: { kind: 'internal', name: '$r_err' },
          n: 1  // 错误时跳过 success_marker
        },
        {
          id: 'marker', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: 'wrote_ok' },
          to: { kind: 'internal', name: '$r_marker' }
        }
      ])
      const state = createInitialState(realL2Registry(), l3)

      await l1MainLoop({ type: 'plan', params: {} }, state)

      // ENOENT → cs truthy → 跳过 marker
      expect(state.internalStore.get('$r_marker')).toBeUndefined()
      // bytes_written = 0
      expect(state.internalStore.get('$r_bytes')).toBe(0)
      // $r_err = ENOENT
      const errVal = state.internalStore.get('$r_err') as { code: string }
      expect(errVal.code).toBe('ENOENT')
    })
  })
})