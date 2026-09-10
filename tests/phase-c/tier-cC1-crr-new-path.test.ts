/**
 * CRR P1/T-1.5+T-1.3 对照测试：new path (useFixedSlotConvention=true) vs legacy path
 *
 * @see docs/mvp/19c-implementation-plan.md §三 T-1.5/T-1.3
 *
 * 核心契约:
 *  ① new path 编译产物 slot 名为 $S<scopeId>.in<k>/.out<k>/.argtmp<N>/.cond<N>/.judge<N>
 *  ② legacy path 编译产物 slot 名为 $r_argtmp_N / $r_cond_<jid> / $r_judge_<jid> (硬编自增)
 *  ③ 两路径产物的语义逻辑(input/output slot 语义) 保持一致
 *  ④ new path 启用后, internalStore 中只出现 $S* / $err / $path, 不出现 $r_argtmp_N
 *  ⑤ legacy path 完全不受 FrameScopeAllocator 影响
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { compileExperience } from '../../src/l3/compiler.js'
import { CORE_EXPERIENCES } from '../../src/l3/experience-library.js'
import { createInitialState, type ExecutionState } from '../../src/l1/execution-state.js'
import { L2Registry } from '../../src/l2/registry.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { shellExecOp } from '../../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../../src/l2/builtins/evaluate-expr.js'
import { evaluateCollectionOp } from '../../src/l2/builtins/evaluate-collection.js'
import { enableCrrNewPath, disableCrrNewPath } from '../../src/l1/main-loop.js'
import { GLOBAL_PATH } from '../../src/l3/crr-config.js'

const experienceLibrary = CORE_EXPERIENCES

function mkRegistry(): L2Registry {
  const reg = new L2Registry()
  reg.register(fileReadOp)
  reg.register(fileWriteOp)
  reg.register(shellExecOp)
  reg.register(globMatchOp)
  reg.register(grepSearchOp)
  reg.register(stringReplaceOp)
  reg.register(evaluateExprOp); reg.register(evaluateCollectionOp)
  return reg
}

/**
 * 准备 state;如 useFixedSlotConvention=true, 主动 enter 一个 scope
 * (main-loop 的 hook 在 executeIntent 阶段 enter —— 这里 unit-test 模拟该阶段)
 */
function prepState(useFixedSlotConvention: boolean): ExecutionState {
  disableCrrNewPath()
  if (useFixedSlotConvention) enableCrrNewPath()
  const state = createInitialState(mkRegistry(), { compile: async () => [] })
  if (useFixedSlotConvention) state.frameScopeAllocator!.enterScope()
  return state
}

describe('CC1: CRR new path (T-1.5+T-1.3) 对照测试', () => {
  afterEach(() => { disableCrrNewPath() })

  describe('① legacy path (default) - 编译产物保持原状', () => {
    it('compileOp 产出 input sidecar $r_argtmp_N (自增 counter)', () => {
      const state = prepState(false)
      const entries = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hello' } },
        state,
        new Map(experienceLibrary.map(e => [e.id, e])),
        mkRegistry()
      )
      const argtmpMoves = entries.filter(e =>
        e.kind === 'move' && e.to.kind === 'internal' && e.to.name.startsWith('$r_argtmp_')
      )
      expect(argtmpMoves.length).toBeGreaterThan(0)
    })

    it('FrameScopeAllocator 完全不被 touch', () => {
      const state = prepState(false)
      const beforeCount = state.frameScopeAllocator?.getActiveScopeCount()
      compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hello' } },
        state,
        new Map(experienceLibrary.map(e => [e.id, e])),
        mkRegistry()
      )
      expect(state.frameScopeAllocator?.getActiveScopeCount()).toBe(beforeCount)
    })
  })

  describe('② new path - 编译产物使用 scope-prefixed slot', () => {
    it('literal sidecar 名 = $S<scopeId>.argtmp<k> (round-robin pool)', () => {
      const state = prepState(true)
      const entries = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hello' } },
        state,
        new Map(experienceLibrary.map(e => [e.id, e])),
        mkRegistry(),
        { useFixedSlotConvention: true }
      )
      const argtmpMoves = entries.filter(e =>
        e.kind === 'move' && e.to.kind === 'internal' && e.to.name.includes('.argtmp')
      )
      expect(argtmpMoves.length).toBeGreaterThan(0)
      expect(argtmpMoves[0].to.kind === 'internal' && argtmpMoves[0].to.name).toMatch(/^\$S\w+\.argtmp\d+$/)
    })

    it('cond/judge 名使用 $S<scopeId>.cond<k> / .judge<k> (branch 编译)', () => {
      const state = prepState(true)
      // safe_write 有 conditional_judgment (probe_existing → already_exists / normal)
      const entries = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hello' } },
        state,
        new Map(experienceLibrary.map(e => [e.id, e])),
        mkRegistry(),
        { useFixedSlotConvention: true }
      )
      const condMoves = entries.filter(e =>
        e.kind === 'move' && e.to.kind === 'internal' && e.to.name.includes('.cond')
      )
      const judgeOps = entries.filter(e =>
        e.kind === 'execute_op' && e.operation === 'evaluate_expr'
      )
      expect(condMoves.length).toBeGreaterThan(0)
      expect(judgeOps.length).toBeGreaterThan(0)
      const judgeOp = judgeOps[0] as any
      expect(judgeOp.outputs.result.name).toMatch(/^\$S\w+\.judge\d+$/)
    })

    it('path mark 使用 $path (GLOBAL_PATH),不是 $r_path', () => {
      const state = prepState(true)
      const entries = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hello' } },
        state,
        new Map(experienceLibrary.map(e => [e.id, e])),
        mkRegistry(),
        { useFixedSlotConvention: true }
      )
      // 路径标记: move(literal <path_id_str>, $path)
      // path_id 是 experience.target_op.paths[].id (如 'probe_existing' / 'already_exists' / 'normal')
      const pathMarks = entries.filter((e: any) =>
        e.kind === 'move' &&
        e.to.kind === 'internal' &&
        e.to.name === GLOBAL_PATH &&
        e.from.kind === 'literal' &&
        typeof e.from.value === 'string'
      )
      expect(pathMarks.length).toBeGreaterThan(0)
      // 检验一个 PATH_MARK value 看起来像 path id
      const pathIdValue = (pathMarks[0] as any).from.value
      expect(typeof pathIdValue).toBe('string')
      expect(['probe_existing', 'already_exists', 'abort']).toContain(pathIdValue)
    })

    it('error alias 使用 $err (GLOBAL_ERR)', () => {
      const state = prepState(true)
      const entries = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hello' } },
        state,
        new Map(experienceLibrary.map(e => [e.id, e])),
        mkRegistry(),
        { useFixedSlotConvention: true }
      )
      const errorOutputs = entries.filter(e =>
        e.kind === 'execute_op' && Object.values(e.outputs).some(o => o.name === '$err')
      )
      expect(errorOutputs.length).toBeGreaterThan(0)
    })

    it('legacy $r_argtmp_N 名不出现在 new path 编译产物中', () => {
      const state = prepState(true)
      const entries = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hello' } },
        state,
        new Map(experienceLibrary.map(e => [e.id, e])),
        mkRegistry(),
        { useFixedSlotConvention: true }
      )
      const allNames = JSON.stringify(entries)
      expect(allNames).not.toMatch(/\$r_argtmp_/)
    })
  })

  describe('③ input $r_input_<key> 语义两路径通用', () => {
    it('new path 仍把 intent.params 绑定到 $r_input_<key>', () => {
      const state = prepState(true)
      const entries = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hello' } },
        state,
        new Map(experienceLibrary.map(e => [e.id, e])),
        mkRegistry(),
        { useFixedSlotConvention: true }
      )
      const inputMoves = entries.filter(e =>
        e.kind === 'move' && e.to.kind === 'internal' && e.to.name.startsWith('$r_input_')
      )
      expect(inputMoves.length).toBeGreaterThanOrEqual(2)
    })

    it('legacy path 同样把 intent.params 绑定到 $r_input_<key>', () => {
      const state = prepState(false)
      const entries = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hello' } },
        state,
        new Map(experienceLibrary.map(e => [e.id, e])),
        mkRegistry(),
        { useFixedSlotConvention: false }
      )
      const inputMoves = entries.filter(e =>
        e.kind === 'move' && e.to.kind === 'internal' && e.to.name.startsWith('$r_input_')
      )
      expect(inputMoves.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('④ 多次 compileExperience + 手动 enterScope/exitScope', () => {
    it('连续两次 enter+compile+exit, allocator 状态平衡', () => {
      enableCrrNewPath()
      const state = createInitialState(mkRegistry(), { compile: async () => [] })
      // 第一次
      const s1 = state.frameScopeAllocator!.enterScope()
      const e1 = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hi' } },
        state,
        new Map(experienceLibrary.map(e => [e.id, e])),
        mkRegistry(),
        { useFixedSlotConvention: true }
      )
      state.frameScopeAllocator!.exitScope()
      // 第二次
      const s2 = state.frameScopeAllocator!.enterScope()
      const e2 = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/y', content: 'world' } },
        state,
        new Map(experienceLibrary.map(e => [e.id, e])),
        mkRegistry(),
        { useFixedSlotConvention: true }
      )
      state.frameScopeAllocator!.exitScope()
      expect(s1).not.toBe(s2)
      // 两个 scope 的 argtmp 独立 (round-robin per-scope)
// 注意:顺序不一定从 0 开始 —— pre_processing literal 先于 judgment env sidecar
// 验证的是 per-scope 隔离 (a1 和 a2 的 scopeId 不同)
      const a1 = e1.filter(e => e.kind === 'move' && e.to.kind === 'internal' && e.to.name.includes('.argtmp'))
      const a2 = e2.filter(e => e.kind === 'move' && e.to.kind === 'internal' && e.to.name.includes('.argtmp'))
      expect(a1.length).toBeGreaterThan(0)
      expect(a2.length).toBeGreaterThan(0)
      // 两者 scope 前缀不同
      const argtmpScope1 = (a1[0] as any).to.name.match(/^\$(\w+)\./)![1]
      const argtmpScope2 = (a2[0] as any).to.name.match(/^\$(\w+)\./)![1]
      expect(argtmpScope1).not.toBe(argtmpScope2)
      expect(state.frameScopeAllocator!.getActiveScopeCount()).toBe(0)
    })
  })

  describe('⑤ MAX_ACTIVE_SCOPES 软限保护', () => {
    it('未 enter 直接调用 compileExperience(new path) 抛错', () => {
      enableCrrNewPath()
      const state = createInitialState(mkRegistry(), { compile: async () => [] })
      // 没有 enterScope —— currentScope 应抛错
      expect(() =>
        compileExperience(
          { type: 'safe_write', params: { path: '/tmp/x', content: 'hi' } },
          state,
          new Map(experienceLibrary.map(e => [e.id, e])),
          mkRegistry(),
          { useFixedSlotConvention: true }
        )
      ).toThrow(/no active scope/i)
    })
  })
})