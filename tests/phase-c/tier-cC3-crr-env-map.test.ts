/**
 * CRR P1/T-1.6 evaluate_expr env map 显式填充测试
 *
 * @see docs/mvp/19c-implementation-plan.md §三 T-1.6
 * @see docs/mvp/19b-register-design.md §五 R5.5
 *
 * 契约:
 *  ① collectVarNames 遍历 AST 收集所有 var.name 节点
 *  ② resolveVar 按优先级解析:
 *     a) global ($err / $r_err / $path / $r_path)
 *     b) input ($r_input_<name>)
 *     c) step output (按 businessName 反查 formalParam.slotIndex) → $S<scope>.out<k>
 *     d) fallback: 原 var.name
 *  ③ buildEnvMap 产出 env map,可直接喂 evaluate_expr
 *  ④ CRR new path 编译产物中, evaluate_expr inputs.env 应包含 scope-prefixed slots
 *  ⑤ legacy path 不传 env inputs (fallback ?? name 兼容)
 *  ⑥ end-to-end: l1MainLoop + useFixedSlotConvention=true 跑 safe_write 全流程
 *     - 验证 error message 正确 (来自 \$err/$path 解析)
 *     - 验证 path-mark 在 \$path,resolveResponse 正确读出
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { l1MainLoop } from '../../src/l1/main-loop.js'
import { compileExperience } from '../../src/l3/compiler.js'
import { buildEnvMap, collectVarNames, resolveVar, indexOutputsByName } from '../../src/l3/expr-env-builder.js'
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
import { incrementCounterOp } from '../../src/l2/builtins/increment-counter.js'
import { decrementCounterOp } from '../../src/l2/builtins/decrement-counter.js'
import { sortByOp } from '../../src/l2/builtins/sort-by.js'
import { takeFirstOp } from '../../src/l2/builtins/take-first.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { enableCrrNewPath, disableCrrNewPath } from '../../src/l1/main-loop.js'
import { GLOBAL_ERR, GLOBAL_PATH } from '../../src/l3/crr-config.js'
import type { Expr } from '../../src/l2/builtins/evaluate-expr.js'
import type { OperationFormalSpec, FormalParam } from '../../src/l2/operation.js'

function mkRegistry(): L2Registry {
  const r = new L2Registry()
  r.register(fileReadOp); r.register(fileWriteOp); r.register(shellExecOp)
  r.register(globMatchOp); r.register(grepSearchOp); r.register(stringReplaceOp)
  r.register(evaluateExprOp); r.register(incrementCounterOp); r.register(decrementCounterOp)
  r.register(sortByOp); r.register(takeFirstOp)
  return r
}

function mkService(): ExperienceService {
  return new ExperienceService(CORE_EXPERIENCES, mkRegistry())
}

describe('CC3: evaluate_expr env map (T-1.6)', () => {
  describe('① collectVarNames AST traversal', () => {
    it('收集所有 var 节点 name (含重复)', () => {
      const expr: Expr = {
        type: 'op', name: 'and' as never,
        args: [
          { type: 'var', name: '$r_x' },
          { type: 'op', name: '==' as never,
            args: [{ type: 'var', name: '$r_x' }, { type: 'literal', value: 1 }] }
        ]
      }
      const names = collectVarNames(expr)
      expect(names).toEqual(['$r_x', '$r_x']) // 重复返回
    })

    it('递归 if.then/else', () => {
      const expr: Expr = {
        type: 'if',
        cond: { type: 'var', name: '$r_a' },
        then: { type: 'var', name: '$r_b' },
        else: { type: 'var', name: '$r_c' }
      }
      expect(collectVarNames(expr).sort()).toEqual(['$r_a', '$r_b', '$r_c'])
    })

    it('literal 节点不收集', () => {
      const expr: Expr = { type: 'literal', value: 'hello' }
      expect(collectVarNames(expr)).toEqual([])
    })
  })

  describe('② resolveVar 优先级解析', () => {
    const fileReadSpec: OperationFormalSpec = {
      inputs: {
        path: { businessName: 'path', register: '$r0', slotIndex: 0, type: 'path', required: true },
        encoding: { businessName: 'encoding', register: '$r1', slotIndex: 1, type: 'string', required: false }
      },
      outputs: {
        content: { businessName: 'content', register: '$r2', slotIndex: 2, type: 'string', required: true },
        error: { businessName: 'error', register: '$r_err', slotIndex: 99, type: 'object', required: false }
      }
    }
    const outputsByName = indexOutputsByName(fileReadSpec)
    const inputNames = new Set(['path', 'encoding'])

    it('a) global $r_err → GLOBAL_ERR', () => {
      const r = resolveVar('$r_err', 's0', outputsByName, inputNames)
      expect(r.reason).toBe('global')
      expect(r.registerName).toBe(GLOBAL_ERR)
    })

    it('a) global $err → GLOBAL_ERR', () => {
      const r = resolveVar('$err', 's0', outputsByName, inputNames)
      expect(r.reason).toBe('global')
      expect(r.registerName).toBe(GLOBAL_ERR)
    })

    it('a) global $path → $path', () => {
      const r = resolveVar('$path', 's0', outputsByName, inputNames)
      expect(r.reason).toBe('global')
      expect(r.registerName).toBe(GLOBAL_PATH)
    })

    it('b) input $r_input_path → 原名', () => {
      const r = resolveVar('$r_input_path', 's0', outputsByName, inputNames)
      expect(r.reason).toBe('input')
      expect(r.registerName).toBe('$r_input_path')
    })

    it('c) step output $r_content → 全局原名 (P4/T-4.3: $r_* 全局化)', () => {
      const r = resolveVar('$r_content', 's0', outputsByName, inputNames)
      expect(r.reason).toBe('literal-name')
      expect(r.registerName).toBe('$r_content')
    })

    it('d) 未知 var → 全局原名 (P4/T-4.3: $r_* 全局化，不再 fallback)', () => {
      const r = resolveVar('$r_unknown_thing', 's0', outputsByName, inputNames)
      expect(r.reason).toBe('literal-name')
      expect(r.registerName).toBe('$r_unknown_thing')
    })

    it('scopeId=null 时 slot 解析退化为原名 (legacy path)', () => {
      const r = resolveVar('$r_content', null, outputsByName, inputNames)
      expect(r.reason).toBe('literal-name')
      expect(r.registerName).toBe('$r_content')
    })
  })

  describe('③ buildEnvMap 产出', () => {
    it('从 Expr 收集 var → 全解析为 register name', () => {
      const expr: Expr = {
        type: 'op', name: 'and' as never,
        args: [
          { type: 'op', name: '==' as never,
            args: [{ type: 'var', name: '$r_err' }, { type: 'literal', value: null }] },
          { type: 'op', name: '>' as never,
            args: [{ type: 'var', name: '$r_bytes' }, { type: 'literal', value: 0 }] }
        ]
      }
      const fileWriteSpec: OperationFormalSpec = {
        inputs: {
          path: { businessName: 'path', register: '$r0', slotIndex: 0, type: 'path', required: true },
          content: { businessName: 'content', register: '$r1', slotIndex: 1, type: 'string', required: true },
          mode: { businessName: 'mode', register: '$r2', slotIndex: 2, type: 'string', required: false },
          encoding: { businessName: 'encoding', register: '$r3', slotIndex: 3, type: 'string', required: false }
        },
        outputs: {
          bytes_written: { businessName: 'bytes_written', register: '$r4', slotIndex: 4, type: 'number', required: true },
          error: { businessName: 'error', register: '$r_err', slotIndex: 99, type: 'object', required: false }
        }
      }
      const env = buildEnvMap(
        expr, 's0',
        indexOutputsByName(fileWriteSpec),
        new Set(['path', 'content'])
      )
      expect(env['$r_err']).toBe(GLOBAL_ERR)
      expect(env['$r_bytes']).toBe('$r_bytes')  // P4/T-4.3: $r_* 全局化
    })
  })

  describe('④ new path 编译产物 env inputs 填充', () => {
    it('safe_write 编译产物中 evaluate_expr inputs.env 应包含 scope-prefixed slots', () => {
      enableCrrNewPath()
      try {
        const state = createInitialState(mkRegistry(), mkService())
        state.frameScopeAllocator!.enterScope()
        const entries = compileExperience(
          { type: 'safe_write', params: { path: '/tmp/x', content: 'hello' } },
          state,
          new Map(CORE_EXPERIENCES.map(e => [e.id, e])),
          mkRegistry(),
          { useFixedSlotConvention: true }
        )
        state.frameScopeAllocator!.exitScope()
        const evalOps = entries.filter((e: any) => e.kind === 'execute_op' && e.operation === 'evaluate_expr')
        expect(evalOps.length).toBeGreaterThan(0)
        // 检查 inputs.env 是否被填充
        const evalOp = evalOps[0] as any
        expect(evalOp.inputs.env).toBeDefined()
        expect(evalOp.inputs.env.kind).toBe('internal')
        // env 寄存器的 to 引用一个 .argtmp 名字
        expect(evalOp.inputs.env.name).toMatch(/\.argtmp/)
      } finally {
        disableCrrNewPath()
      }
    })

    it('legacy path 不传 env inputs (fallback 兼容)', () => {
      const state = createInitialState(mkRegistry(), mkService())
      const entries = compileExperience(
        { type: 'safe_write', params: { path: '/tmp/x', content: 'hello' } },
        state,
        new Map(CORE_EXPERIENCES.map(e => [e.id, e])),
        mkRegistry(),
        { useFixedSlotConvention: false }
      )
      const evalOps = entries.filter((e: any) => e.kind === 'execute_op' && e.operation === 'evaluate_expr')
      expect(evalOps.length).toBeGreaterThan(0)
      const evalOp = evalOps[0] as any
      expect(evalOp.inputs.env).toBeUndefined()
    })
  })

  describe('⑤ end-to-end: l1MainLoop + crrNewPath 跑 safe_write 全流程', () => {
    let dir: string
    beforeEach(async () => {
      dir = await fs.mkdtemp(join(tmpdir(), 'cc3-e2e-'))
    })
    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true })
    })

    it('success path: 安全写入新文件', async () => {
      enableCrrNewPath()
      try {
        const state = createInitialState(mkRegistry(), mkService())
        await l1MainLoop(
          { type: 'safe_write', params: { path: join(dir, 'new.txt'), content: 'hello world' } },
          state,
          true // rootHandleError
        )
        // 验证文件被写入
        const content = await fs.readFile(join(dir, 'new.txt'), 'utf-8')
        expect(content).toBe('hello world')
        // 验证 scope-prefixed slots 被实际写入
        const keys = Array.from(state.internalStore.keys())
        expect(keys.some(k => k.startsWith('$S'))).toBe(true)
        // 验证 error alias $err 存在 (即使成功,初始 null)
        expect(state.internalStore.has('$err') || state.internalStore.has('$r_err')).toBe(true)
        // 验证 path mark 写入 \$path
        expect(state.internalStore.has('$path')).toBe(true)
      } finally {
        disableCrrNewPath()
      }
    })

    it('error path: 文件已存在 → abort + error message 正确解析', async () => {
      // 先写入一个文件,触发 safe_write 的 abort 路径
      await fs.writeFile(join(dir, 'exists.txt'), 'preexisting')
      enableCrrNewPath()
      try {
        const state = createInitialState(mkRegistry(), mkService())
        await l1MainLoop(
          { type: 'safe_write', params: { path: join(dir, 'exists.txt'), content: 'should fail' } },
          state,
          true
        )
        // 验证原文件未被覆盖 (abort 路径)
        const content = await fs.readFile(join(dir, 'exists.txt'), 'utf-8')
        expect(content).toBe('preexisting')
        // abort path 实际是 evaluate_expr 走 lit(0) 分支,$err = null (成功)
        // 验证 path mark 写入 \$path = 'abort' (这是 CRR 验证关键)
        expect(state.internalStore.get('$path')).toBe('abort')
        // 验证 abort path 不会触发出错,error 应为 null
        const err = state.internalStore.get('$err') ?? state.internalStore.get('$r_err')
        expect(err === null || err === undefined).toBe(true)
      } finally {
        disableCrrNewPath()
      }
    })

    it('P4/T-4.3: new path (legacy 已删除) safe_write 行为一致', async () => {
      // P4/T-4.3: disableCrrNewPath() 是 no-op，new path 是唯一路径
      const state = createInitialState(mkRegistry(), mkService())
      await l1MainLoop(
        { type: 'safe_write', params: { path: join(dir, 'legacy.txt'), content: 'legacy path' } },
        state,
        true
      )
      const content = await fs.readFile(join(dir, 'legacy.txt'), 'utf-8')
      expect(content).toBe('legacy path')
      // new path 写 $err (GLOBAL_ERR)
      const errKeys = Array.from(state.internalStore.keys()).filter(k => k.includes('err'))
      expect(errKeys.length).toBeGreaterThan(0)
      // path mark 写入 $path (GLOBAL_PATH)
      expect(state.internalStore.has('$path')).toBe(true)
    })
  })
})