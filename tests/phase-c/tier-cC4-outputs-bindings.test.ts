/**
 * CRR P2/T-2.2 + T-2.3 outputs_bindings post-bindings 测试
 *
 * @see docs/mvp/19c-implementation-plan.md §三 T-2.2 / T-2.3
 * @see docs/mvp/19-register-file-core.md §C5
 *
 * 契约:
 *  ① compilePostBindings: 未声明 outputs_bindings → 零 move
 *  ② compilePostBindings: 声明但 persist:false → 零 move
 *  ③ compilePostBindings: 声明 + persist:true → 一条 move(从 binding.register 到 public)
 *  ④ move 的 to.name = `${exp.id}.${key}` 格式
 *  ⑤ legacy path: move from = binding.register 原值
 *  ⑥ new path: move from = $S<scopeId>.out<slotIndex> (从 outputsByName 反查)
 *  ⑦ new path: binding.register = $r_err → move from = $err
 *  ⑧ 静态校验: key 不在 exp.outputs → throw
 *  ⑨ 静态校验: register 未在 step outputs 中出现 → console.warn (不抛错)
 *  ⑩ end-to-end: safe_write → publicStore.safe_write.bytes_written 出现
 *  ⑪ end-to-end: read_file_with_default → publicStore.read_file_with_default.content 出现
 *  ⑫ end-to-end: replace_in_file (T-2.4 已有 binding) → publicStore.replace_in_file.count 出现
 *  ⑬ new path 下 end-to-end: publicStore value 从 $S<scope>.out<k> 读到正确值
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { l1MainLoop, enableCrrNewPath, disableCrrNewPath } from '../../src/l1/main-loop.js'
import { compileExperience } from '../../src/l3/compiler.js'
import { ExperienceService } from '../../src/l3/experience-service.js'
import { CORE_EXPERIENCES } from '../../src/l3/experience-library.js'
import { L2Registry } from '../../src/l2/registry.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { shellExecOp } from '../../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../../src/l2/builtins/evaluate-expr.js'
import { evaluateCollectionOp } from '../../src/l2/builtins/evaluate-collection.js'
import { incrementCounterOp } from '../../src/l2/builtins/increment-counter.js'
import { decrementCounterOp } from '../../src/l2/builtins/decrement-counter.js'
import { sortByOp } from '../../src/l2/builtins/sort-by.js'
import { takeFirstOp } from '../../src/l2/builtins/take-first.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import type { Experience } from '../../src/l3/experience.js'

function mkRegistry(): L2Registry {
  const r = new L2Registry()
  r.register(fileReadOp); r.register(fileWriteOp); r.register(shellExecOp)
  r.register(globMatchOp); r.register(grepSearchOp); r.register(stringReplaceOp)
  r.register(evaluateExprOp); r.register(evaluateCollectionOp); r.register(incrementCounterOp); r.register(decrementCounterOp)
  r.register(sortByOp); r.register(takeFirstOp)
  return r
}

function mkService(): ExperienceService {
  return new ExperienceService(CORE_EXPERIENCES, mkRegistry())
}

function mkExperiencesMap(): Map<string, Experience> {
  return new Map(CORE_EXPERIENCES.map(e => [e.id, e]))
}

describe('CC4: outputs_bindings post-bindings (T-2.2+T-2.3)', () => {
  describe('①② 零 move: 未声明 / persist:false', () => {
    it('未声明 outputs_bindings → 无 publicStore move (合成 exp)', () => {
      // T-2.4 后所有 CORE_EXPERIENCES 都有 bindings, 需合成一个无 binding 的 exp 验证零 move
      const state = createInitialState(mkRegistry(), mkService())
      const fakeExp: Experience = {
        id: 'fake_no_bindings',
        description: 'test',
        inputs: {},
        outputs: { x: { type: 'string', required: false } },
        // 注意: 不声明 outputs_bindings
        target_op: { base_op: 'noop', default_path: 'normal', paths: [{ id: 'normal', steps: [] }] }
      }
      const map = new Map(mkExperiencesMap())
      map.set('fake_no_bindings', fakeExp)
      const entries = compileExperience(
        { type: 'fake_no_bindings', params: {} },
        state, map, mkRegistry()
      )
      const publicMoves = entries.filter((e: any) => e.kind === 'move' && e.to.kind === 'public')
      expect(publicMoves.length).toBe(0)
    })

    it('声明但 persist:false → 无 publicStore move', () => {
      const state = createInitialState(mkRegistry(), mkService())
      const exp = CORE_EXPERIENCES.find(e => e.id === 'replace_in_file')!
      const augmented: Experience = {
        ...exp,
        outputs_bindings: {
          count: { register: '$r_count', type: 'number', persist: false }
        }
      }
      const augMap = new Map(mkExperiencesMap())
      augMap.set('replace_in_file', augmented)
      const entries = compileExperience(
        { type: 'replace_in_file', params: { path: '/tmp/x', find: 'a', replace: 'b' } },
        state, augMap, mkRegistry()
      )
      const publicMoves = entries.filter((e: any) => e.kind === 'move' && e.to.kind === 'public')
      expect(publicMoves.length).toBe(0)
    })
  })

  describe('③④⑤⑥⑦ persist:true 生成 move', () => {
    it('legacy path: move from = binding.register 原值', () => {
      const state = createInitialState(mkRegistry(), mkService())
      const entries = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hi' } },
        state, mkExperiencesMap(), mkRegistry()
      )
      const publicMoves = entries.filter((e: any) => e.kind === 'move' && e.to.kind === 'public')
      expect(publicMoves.length).toBe(1)
      const m = publicMoves[0] as any
      expect(m.to.name).toBe('safe_write.bytes_written')
      expect(m.from.name).toBe('$r_bytes')
      expect(m.from.kind).toBe('internal')
    })

    it('new path: move from = $S<scopeId>.out<k> 翻译后形式', () => {
      enableCrrNewPath()
      try {
        const state = createInitialState(mkRegistry(), mkService())
        state.frameScopeAllocator!.enterScope()
        const entries = compileExperience(
          { type: 'safe_write', params: { path: '/tmp/x', content: 'hi' } },
          state, mkExperiencesMap(), mkRegistry(),
          { useFixedSlotConvention: true }
        )
        state.frameScopeAllocator!.exitScope()
        const publicMoves = entries.filter((e: any) => e.kind === 'move' && e.to.kind === 'public')
        expect(publicMoves.length).toBe(1)
        const m = publicMoves[0] as any
        expect(m.to.name).toBe('safe_write.bytes_written')
        // P4/T-4.3: $r_bytes 全局化，binding.register 保持原名 $r_bytes（不再 scope-prefix）
        expect(m.from.name).toBe('$r_bytes')
      } finally {
        disableCrrNewPath()
      }
    })

    it('new path: $r_err binding 翻译为 $err', () => {
      enableCrrNewPath()
      try {
        const state = createInitialState(mkRegistry(), mkService())
        state.frameScopeAllocator!.enterScope()
        // 构造一个伪 exp, 模拟错误输出 binding
        const fakeExp: Experience = {
          id: 'fake_exp',
          description: 'test',
          inputs: {},
          outputs: { err: { type: 'object', required: false } },
          outputs_bindings: {
            err: { register: '$r_err', type: 'object', persist: true }
          },
          target_op: {
            base_op: 'noop', default_path: 'normal',
            paths: [{ id: 'normal', steps: [] }]
          }
        }
        const map = new Map(mkExperiencesMap())
        map.set('fake_exp', fakeExp)
        const entries = compileExperience(
          { type: 'fake_exp', params: {} },
          state, map, mkRegistry(),
          { useFixedSlotConvention: true }
        )
        state.frameScopeAllocator!.exitScope()
        const publicMoves = entries.filter((e: any) => e.kind === 'move' && e.to.kind === 'public')
        expect(publicMoves.length).toBe(1)
        expect((publicMoves[0] as any).from.name).toBe('$err')
      } finally {
        disableCrrNewPath()
      }
    })
  })

  describe('⑧ 静态校验: key 不在 exp.outputs → throw', () => {
    it('binding key 不在 outputs 应抛错', () => {
      const state = createInitialState(mkRegistry(), mkService())
      const exp = CORE_EXPERIENCES.find(e => e.id === 'safe_write')!
      const augmented: Experience = {
        ...exp,
        outputs_bindings: {
          nonexistent_key: { register: '$r_x', type: 'string', persist: true }
        }
      }
      const augMap = new Map(mkExperiencesMap())
      augMap.set('safe_write', augmented)
      expect(() =>
        compileExperience(
          { type: 'safe_write', params: { path: '/tmp/x', content: 'hi' } },
          state, augMap, mkRegistry()
        )
      ).toThrow(/nonexistent_key.*no matching entry in exp.outputs/)
    })
  })

  describe('⑨ 静态校验: register 未在 step outputs → warn, 不抛错', () => {
    it('未知 register 名 → console.warn + 仍生成 move', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const state = createInitialState(mkRegistry(), mkService())
        const exp = CORE_EXPERIENCES.find(e => e.id === 'safe_write')!
        const augmented: Experience = {
          ...exp,
          outputs_bindings: {
            bytes_written: { register: '$r_nonexistent', type: 'number', persist: true }
          }
        }
        const augMap = new Map(mkExperiencesMap())
        augMap.set('safe_write', augmented)
        const entries = compileExperience(
          { type: 'safe_write', params: { path: '/tmp/x', content: 'hi' } },
          state, augMap, mkRegistry()
        )
        const publicMoves = entries.filter((e: any) => e.kind === 'move' && e.to.kind === 'public')
        expect(publicMoves.length).toBe(1)
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('\$r_nonexistent'))
      } finally {
        warnSpy.mockRestore()
      }
    })
  })

  describe('⑩ ⑪ ⑫ ⑬ end-to-end l1MainLoop + publicStore', () => {
    let dir: string
    beforeEach(async () => {
      dir = await fs.mkdtemp(join(tmpdir(), 'cc4-e2e-'))
    })
    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true })
    })

    it('legacy path: safe_write → publicStore.safe_write.bytes_written = 字节数', async () => {
      const state = createInitialState(mkRegistry(), mkService())
      await l1MainLoop(
        { type: 'safe_write', params: { path: join(dir, 'x.txt'), content: 'hello' } },
        state, true
      )
      expect(state.publicStore.has('safe_write.bytes_written')).toBe(true)
      expect(state.publicStore.get('safe_write.bytes_written')).toBe('hello'.length)
    })

    it('legacy path: read_file_with_default → publicStore.read_file_with_default.content', async () => {
      await fs.writeFile(join(dir, 'r.txt'), 'file content')
      const state = createInitialState(mkRegistry(), mkService())
      await l1MainLoop(
        { type: 'read_file_with_default', params: { path: join(dir, 'r.txt'), default_content: 'default' } },
        state, true
      )
      expect(state.publicStore.has('read_file_with_default.content')).toBe(true)
      expect(state.publicStore.get('read_file_with_default.content')).toBe('file content')
    })

    it('legacy path: replace_in_file (T-2.4 已有 binding) → publicStore.replace_in_file.count 出现', async () => {
      // T-2.4 后 replace_in_file.outputs_bindings.count 已声明
      await fs.writeFile(join(dir, 'r.txt'), 'hello world')
      const state = createInitialState(mkRegistry(), mkService())
      await l1MainLoop(
        { type: 'replace_in_file', params: { path: join(dir, 'r.txt'), find: 'world', replace: 'pi' } },
        state, true
      )
      expect(state.publicStore.has('replace_in_file.count')).toBe(true)
      expect(state.publicStore.get('replace_in_file.count')).toBe(1) // 'world' 出现 1 次
    })

    it('new path: safe_write → publicStore.safe_write.bytes_written 正确 (从 $S<scope>.out4 读)', async () => {
      enableCrrNewPath()
      try {
        const state = createInitialState(mkRegistry(), mkService())
        await l1MainLoop(
          { type: 'safe_write', params: { path: join(dir, 'np.txt'), content: 'new path content' } },
          state, true
        )
        expect(state.publicStore.has('safe_write.bytes_written')).toBe(true)
        expect(state.publicStore.get('safe_write.bytes_written')).toBe('new path content'.length)
      } finally {
        disableCrrNewPath()
      }
    })
  })
})