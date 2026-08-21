/**
 * Phase A Tier A10 - 异常冒泡（handleError 标志）测试
 *
 * 2026-08-20 修订：错误处置权在 L3
 *
 * 核心语义：
 * - 任何异常由主循环 catch
 * - 异常信息写入 $r_err（errorToOperationError）
 * - 从栈顶向上弹出，直到遇到 handleError=true 的 IntentEntry 帧
 * - 遇到 → 截获：pop 该帧，继续执行其后指令（后续指令读 $r_err 判断）
 * - 无 → 冒泡到栈空 → UnhandledError 给调用者
 *
 * 验证场景（用户描述的 A/B/C 嵌套）：
 * - C 异常（无标志）→ 弹出 C 序列 → B 无标志 → 弹出 B 序列 → A 有标志 → 截获，继续执行 A 后序列
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  l1MainLoop,
  createRootIntentEntry,
  bubbleError,
  UnhandledError,
  L1MaxStepsError
} from '../../src/l1/main-loop.js'
import {
  createInitialState,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { createMockL2, createProgrammableOp, MockOpTracker } from '../../src/mocks/mock-l2.js'
import { createProgrammableL3 } from '../../src/mocks/mock-l3.js'
import type { StackEntry, IntentEntry, RecognizedIntent, Value } from '../../src/l1/types.js'
import { ERROR_REGISTER, isOperationError, errorToOperationError } from '../../src/l2/errors.js'

describe('A10: 异常冒泡（handleError 标志，错误处置权在 L3）', () => {
  let state: ExecutionState
  let mockL2: ReturnType<typeof createMockL2>

  beforeEach(() => {
    mockL2 = createMockL2()
    state = createInitialState(mockL2.registry, createProgrammableL3())
  })

  // ============== bubbleError 单元测试 ==============
  describe('bubbleError 单元测试', () => {
    test('遇到 handleError 帧 → 截获（返回 true，$r_err 写入，帧保留）', async () => {
      // 栈：[A(handleError=true), op_throw]
      const a = createIntentFrame('A', true)
      a.phase = 'awaiting_children'  // 模拟已 compile（真实截获时帧是 awaiting）
      const opThrow: StackEntry = {
        id: 'op', parentIntentId: null, createdAt: 0,
        kind: 'execute_op', operation: 'x', inputs: {}, outputs: {}, status: 'pending'
      }
      state.stack.push(a, opThrow)

      const handled = await bubbleError(new Error('boom'), state)

      expect(handled).toBe(true)
      // 异常点 op 被弹出，handler 帧保留（其 children 继续执行 catch 逻辑）
      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('A')
      expect(a.phase).toBe('awaiting_children')  // 帧保持 awaiting，children 未完成
      // $r_err 写入异常信息
      const err = state.internalStore.get(ERROR_REGISTER)
      expect(isOperationError(err)).toBe(true)
    })

    test('无 handleError 帧 → 冒泡到栈空（返回 false）', async () => {
      // 栈：[B(handleError=false), op_throw]
      const b = createIntentFrame('B', false)
      const opThrow: StackEntry = {
        id: 'op', parentIntentId: null, createdAt: 0,
        kind: 'execute_op', operation: 'x', inputs: {}, outputs: {}, status: 'pending'
      }
      state.stack.push(b, opThrow)

      const handled = await bubbleError(new Error('boom'), state)

      expect(handled).toBe(false)
      expect(state.stack.length).toBe(0)
      expect(b.phase).toBe('aborted')
      // $r_err 仍写入（即使无截获，异常信息保留）
      expect(state.internalStore.has(ERROR_REGISTER)).toBe(true)
    })

    test('截获后 $r_err 是标准 OperationError（保留 code/message）', async () => {
      const a = createIntentFrame('A', true)
      state.stack.push(a)

      const err = new Error('ENOENT: no such file')
      ;(err as { code?: string }).code = 'ENOENT'
      await bubbleError(err, state)

      const stored = state.internalStore.get(ERROR_REGISTER)
      expect(isOperationError(stored)).toBe(true)
      const opErr = stored as { code: string; message: string; op: string }
      expect(opErr.code).toBe('ENOENT')       // 保留原始错误码
      expect(opErr.message).toContain('ENOENT')
      expect(opErr.op).toBe('l1')
    })
  })

  // ============== 用户场景：A/B/C 嵌套冒泡 ==============
  describe('A/B/C 嵌套冒泡（用户场景）', () => {
    // 构造 L3：A(handleError=true) → children 含 B；B(handleError=false) → children 含 C；
    // C(handleError=false) → children 含 throwing op（异常点）
    function buildNestedL3() {
      const l3 = createProgrammableL3()

      // C 经验：包含一个抛错的 op
      l3.setChildren('C', [
        { id: 'c_op', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'throwing_op', inputs: {}, outputs: {}, status: 'pending' }
      ])

      // B 经验：包含 C 调用 + B 的后续指令（应被弹出）
      l3.setChildren('B', [
        { id: 'b_before', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 1 }, to: { kind: 'internal', name: '$r_b' } },
        { id: 'b_intent', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'C', params: {} },
          phase: 'pending', children: [], handleError: false },
        { id: 'b_after', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 2 }, to: { kind: 'internal', name: '$r_b2' } }
      ])

      // A 经验：包含 B 调用 + A 的后续指令（截获后继续执行）
      l3.setChildren('A', [
        { id: 'a_before', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 10 }, to: { kind: 'internal', name: '$r_a' } },
        { id: 'a_intent', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'B', params: {} },
          phase: 'pending', children: [], handleError: false },
        { id: 'a_after', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 20 }, to: { kind: 'internal', name: '$r_a2' } }
      ])

      return l3
    }

    test('C 异常 → 弹出 C/B 序列 → A 截获 → 继续执行 A 后指令', async () => {
      const l3 = buildNestedL3()
      state.l3 = l3

      // 根意图 R → A（handleError=true）
      // 根帧无标志（默认 false），A 帧有标志
      // 但注意：A 由 L3 编译返回，handleError 由编译结果决定
      // 这里模拟：根经验编译出 [A_intent(handleError=true)]
      l3.setChildren('root', [
        { id: 'a_root', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'A', params: {} },
          phase: 'pending', children: [], handleError: true }
      ])

      await l1MainLoop({ type: 'root', params: {} }, state)

      // ========== 预期（用户场景）==========
      // C 抛错（无标志）→ 弹出 C 序列
      // B 无标志 → 弹出 B 序列（含 b_before 已执行完、b_after 未执行被弹）
      // A 有标志 → 截获，继续执行 A 后序列（a_after）
      expect(state.internalStore.get('$r_a')).toBe(10)     // A 前置已执行
      expect(state.internalStore.get('$r_a2')).toBe(20)    // A 后置执行（截获后继续）✓
      expect(state.internalStore.get('$r_b')).toBe(1)      // B 前置已执行
      expect(state.internalStore.has('$r_b2')).toBe(false) // B 后置被弹出（未执行）✓
      // $r_err 有异常信息
      expect(isOperationError(state.internalStore.get(ERROR_REGISTER))).toBe(true)
      // 栈空（完成）
      expect(state.stack.length).toBe(0)
    })

    test('对比：B 也有 handleError → 异常截获在 B，B 的 catch 逻辑执行', async () => {
      const l3 = createProgrammableL3()

      l3.setChildren('C', [
        { id: 'c_op', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'throwing_op', inputs: {}, outputs: {}, status: 'pending' }
      ])

      // B 有标志：异常截获在 B
      l3.setChildren('B', [
        { id: 'b_before', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 1 }, to: { kind: 'internal', name: '$r_b' } },
        { id: 'b_intent', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'C', params: {} },
          phase: 'pending', children: [], handleError: false },
        { id: 'b_after', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 2 }, to: { kind: 'internal', name: '$r_b2' } }
      ])

      // A 无标志：B 截获后 A 继续（B 是 A 的 children 之一）
      l3.setChildren('A', [
        { id: 'a_before', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 10 }, to: { kind: 'internal', name: '$r_a' } },
        { id: 'a_intent', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'B', params: {} },
          phase: 'pending', children: [], handleError: true },  // B 帧有标志：截获在 B
        { id: 'a_after', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 20 }, to: { kind: 'internal', name: '$r_a2' } }
      ])

      l3.setChildren('root', [
        { id: 'a_root', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'A', params: {} },
          phase: 'pending', children: [], handleError: false }
      ])
      state.l3 = l3

      await l1MainLoop({ type: 'root', params: {} }, state)

      // B 截获后：B 的 b_after 执行（B 的 catch 逻辑），A 的 a_after 也执行（B 截获后 A 继续）
      expect(state.internalStore.get('$r_a')).toBe(10)
      expect(state.internalStore.get('$r_a2')).toBe(20)    // A 后置执行（B 截获后 A 继续）✓
      expect(state.internalStore.get('$r_b')).toBe(1)
      expect(state.internalStore.get('$r_b2')).toBe(2)     // B 的 b_after 执行（B 截获后 catch 逻辑）✓
      expect(state.stack.length).toBe(0)
    })
  })

  // ============== 截获后 $r_err 决策（catch 逻辑）==============
  describe('截获后 $r_err 决策（DAG catch 逻辑）', () => {
    test('handleError 经验内：op 抛错 → $r_err 判断 → 走错误处理路径', async () => {
      const l3 = createProgrammableL3()

      // 经验 handle：op 抛错（无标志指令）→ 异常冒泡到 handle 帧 → 截获 → 后续指令读 $r_err
      // 编译产物（错误处理 DAG）：
      //   [g_throw, conditional_skip($r_err, n=2), g_normal, skip_n(1), g_err_path]
      // - $r_err truthy（异常）→ 跳过 g_normal + skip_n → 执行 g_err_path
      // - $r_err falsy（无异常）→ 执行 g_normal → skip_n 跳过 g_err_path
      l3.setChildren('guarded', [
        { id: 'g_throw', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'throwing_op', inputs: {}, outputs: {}, status: 'pending' },
        { id: 'g_check', parentIntentId: null, createdAt: 0,
          kind: 'conditional_skip', conditionAddr: { kind: 'internal', name: '$r_err' }, n: 2 },
        { id: 'g_normal', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 'normal' }, to: { kind: 'internal', name: '$r_out' } },
        { id: 'g_skip', parentIntentId: null, createdAt: 0,
          kind: 'skip_n', n: 1 },
        { id: 'g_err_path', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 'error_handled' }, to: { kind: 'internal', name: '$r_out' } }
      ])

      // 根 → guarded 帧（handleError=true）
      l3.setChildren('root', [
        { id: 'g_frame', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'guarded', params: {} },
          phase: 'pending', children: [], handleError: true }
      ])
      state.l3 = l3

      await l1MainLoop({ type: 'root', params: {} }, state)

      // op_throw 抛错 → 冒泡到 guarded 帧（handleError=true）→ 截获
      // 截获后继续执行：conditional_skip($r_err truthy) → 跳过 g_normal → 执行 g_err_path
      expect(state.internalStore.get('$r_out')).toBe('error_handled')
      expect(state.stack.length).toBe(0)
    })

    test('无 handleError 且根也无 → UnhandledError 抛出', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('naked', [
        { id: 'n_throw', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'throwing_op', inputs: {}, outputs: {}, status: 'pending' }
      ])
      // 根意图直接编译出 naked children（无 handleError 帧）
      l3.setChildren('root', [
        { id: 'n_frame', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'naked', params: {} },
          phase: 'pending', children: [], handleError: false }
      ])
      state.l3 = l3

      await expect(
        l1MainLoop({ type: 'root', params: {} }, state)
      ).rejects.toThrow('Unhandled error in L1 main loop')
    })
  })

  // ============== 根意图 handleError ==============
  describe('根意图 handleError', () => {
    test('createRootIntentEntry 可设置 handleError', () => {
      const entry = createRootIntentEntry({ type: 'r', params: {} }, true) as IntentEntry
      expect(entry.handleError).toBe(true)

      const entry2 = createRootIntentEntry({ type: 'r2', params: {} }) as IntentEntry
      expect(entry2.handleError).toBe(false)
    })

    test('根意图 handleError=true → 异常截获，mainLoop 正常完成', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('root', [
        { id: 't_op', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'throwing_op', inputs: {}, outputs: {}, status: 'pending' }
      ])
      state.l3 = l3

      // 根意图直接编译出 children（根帧是 execute_intent，handleError 由 createRootIntentEntry 决定）
      // 但注意：l1MainLoop 的根帧 handleError=false（createRootIntentEntry 默认）
      // 此处验证：children 中有 handleError 帧
      // 修改：让 children 第一个是 handleError 帧，异常截获在它
      l3.setChildren('root', [
        { id: 'g_frame', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'guarded_root', params: {} },
          phase: 'pending', children: [], handleError: true }
      ])
      l3.setChildren('guarded_root', [
        { id: 't_op', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'throwing_op', inputs: {}, outputs: {}, status: 'pending' }
      ])

      await expect(
        l1MainLoop({ type: 'root', params: {} }, state)
      ).resolves.not.toThrow()

      // 异常被截获，$r_err 有信息
      expect(isOperationError(state.internalStore.get(ERROR_REGISTER))).toBe(true)
    })
  })

  // ============== UnhandledError ==============
  describe('UnhandledError', () => {
    test('是 Error 子类，保留 cause', () => {
      const cause = new Error('root cause')
      const err = new UnhandledError('wrapper', cause)
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('UnhandledError')
      expect(err.message).toContain('wrapper')
      expect(err.cause).toBe(cause)
    })
  })

  // ============== errorToOperationError ==============
  describe('errorToOperationError（异常 → OperationError）', () => {
    test('普通 Error → code=EXCEPTION', async () => {
      const a = createIntentFrame('A', true)
      state.stack.push(a)
      await bubbleError(new Error('generic failure'), state)
      const stored = state.internalStore.get(ERROR_REGISTER) as { code: string }
      expect(stored.code).toBe('EXCEPTION')
    })

    test('已是 OperationError → 直接透传（不包装）', () => {
      const opErr = {
        code: 'FILE_NOT_FOUND',
        message: 'no such file',
        op: 'file_read',
        timestamp: 123
      }
      const result = errorToOperationError(opErr, 'l1')
      expect(result).toBe(opErr)  // 同一引用
    })

    test('带 code 的 Error → 保留原始错误码', async () => {
      const a = createIntentFrame('A', true)
      state.stack.push(a)
      const err = new Error('permission denied')
      ;(err as { code?: string }).code = 'EACCES'
      await bubbleError(err, state)
      const stored = state.internalStore.get(ERROR_REGISTER) as { code: string }
      expect(stored.code).toBe('EACCES')
    })

    test('非 Error 值 → 包装为 EXCEPTION', async () => {
      const a = createIntentFrame('A', true)
      state.stack.push(a)
      await bubbleError('string error', state)
      const stored = state.internalStore.get(ERROR_REGISTER) as { code: string; message: string }
      expect(stored.code).toBe('EXCEPTION')
      expect(stored.message).toContain('string error')
    })
  })
})

// ============== Helpers ==============

function createIntentFrame(id: string, handleError: boolean): IntentEntry {
  return {
    id,
    parentIntentId: null,
    createdAt: 0,
    kind: 'execute_intent',
    intent: { type: id, params: {} },
    phase: 'pending',
    children: [],
    handleError
  }
}