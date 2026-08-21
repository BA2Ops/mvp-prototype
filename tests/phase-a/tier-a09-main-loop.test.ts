/**
 * Phase A Tier A9 - l1MainLoop（5-case dispatch）测试
 *
 * 验证：
 * 1. 根意图初始化（createRootIntentEntry）
 * 2. 最小意图（无 children）
 * 3. 线性序列（move + execute_op）
 * 4. DAG if-then-else（conditional_skip + skip_n 两条路径）
 * 5. 嵌套意图（intent → children 含子 intent）
 * 6. 硬错误传播（throwing_op）
 * 7. maxSteps 防御
 * 8. 5-case dispatch 完整性
 * 9. 状态保留（publicStore / allocator）
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  l1MainLoop,
  createRootIntentEntry,
  L1MaxStepsError
} from '../../src/l1/main-loop.js'
import {
  createInitialState,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { createMockL2, MockOpTracker, createProgrammableOp } from '../../src/mocks/mock-l2.js'
import { createMockL3, createProgrammableL3 } from '../../src/mocks/mock-l3.js'
import type { StackEntry, RecognizedIntent, OpEntry, MoveEntry, SkipN, ConditionalSkip } from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'

describe('A9: l1MainLoop（5-case dispatch，双区架构版）', () => {
  let state: ExecutionState
  let mockL2: ReturnType<typeof createMockL2>

  beforeEach(() => {
    mockL2 = createMockL2()
    state = createInitialState(mockL2.registry, createMockL3([]))
  })

  // ============== createRootIntentEntry ==============
  describe('createRootIntentEntry', () => {
    test('创建正确的 IntentEntry 字段', () => {
      const intent: RecognizedIntent = { type: 'root', params: { x: 1 } }
      const entry = createRootIntentEntry(intent)

      expect(entry.kind).toBe('execute_intent')
      expect(entry.intent).toBe(intent)
      expect(entry.phase).toBe('pending')
      expect(entry.parentIntentId).toBeNull()
      expect(entry.id).toBeDefined()
      expect(entry.createdAt).toBeGreaterThan(0)
      expect(entry.children).toEqual([])
    })
  })

  // ============== 最小意图 ==============
  describe('最小意图（无 children）', () => {
    test('L3 返回空 children → 立即完成，栈空', async () => {
      const l3 = createMockL3([])
      state.l3 = l3

      await l1MainLoop({ type: 'noop', params: {} }, state)

      expect(state.stack.length).toBe(0)
    })

    test('根意图 entry 被 pop（不留残留）', async () => {
      const l3 = createMockL3([])
      state.l3 = l3

      await l1MainLoop({ type: 'noop', params: {} }, state)

      expect(state.stack).toEqual([])
    })
  })

  // ============== 线性序列（move + execute_op）==============
  describe('线性序列（move + execute_op）', () => {
    test('move literal → $r0，op 读 $r0 写 $r1，结果正确', async () => {
      const children: StackEntry[] = [
        { id: 'm1', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 5 }, to: { kind: 'internal', name: '$r0' } },
        { id: 'op1', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'mock_op',
          inputs: { x: { kind: 'internal', name: '$r0' } },
          outputs: { result: { kind: 'internal', name: '$r1' } },
          status: 'pending' }
      ]
      const l3 = createMockL3(children)
      state.l3 = l3

      await l1MainLoop({ type: 'linear', params: {} }, state)

      // mock_op: result = x * 2 = 5 * 2 = 10
      expect(state.internalStore.get('$r1')).toBe(10)
      // move 写入 $r0 = 5
      expect(state.internalStore.get('$r0')).toBe(5)
      // 栈空
      expect(state.stack.length).toBe(0)
      // op 被调用一次
      expect(mockL2.tracker.getCallCount()).toBe(1)
    })

    test('多个 op 顺序执行（依赖链）', async () => {
      const children: StackEntry[] = [
        { id: 'm1', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 3 }, to: { kind: 'internal', name: '$r0' } },
        { id: 'op1', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'mock_op',
          inputs: { x: { kind: 'internal', name: '$r0' } },
          outputs: { result: { kind: 'internal', name: '$r1' } },
          status: 'pending' },
        { id: 'op2', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'mock_op',
          inputs: { x: { kind: 'internal', name: '$r1' } },
          outputs: { result: { kind: 'internal', name: '$r2' } },
          status: 'pending' }
      ]
      const l3 = createMockL3(children)
      state.l3 = l3

      await l1MainLoop({ type: 'chain', params: {} }, state)

      // 3 → 6 → 12
      expect(state.internalStore.get('$r2')).toBe(12)
      expect(mockL2.tracker.getCallCount()).toBe(2)
      // 调用顺序：先 op1 后 op2
      const calls = mockL2.tracker.getCalls()
      expect(calls[0].inputs.x).toBe(3)
      expect(calls[1].inputs.x).toBe(6)
    })
  })

  // ============== DAG if-then-else ==============
  describe('DAG if-then-else（conditional_skip + skip_n）', () => {
    // 编译产物结构（读文件失败则走 else 分支）：
    // [op_read, conditional_skip($r_err, n=2), else_block(op), skip_n(1), then_block(op)]
    // - 条件为真（$r_err truthy，文件不存在）→ 跳过 else_block + skip_n → 执行 then_block
    // - 条件为假（$r_err falsy，文件存在）→ 执行 else_block → skip_n 跳过 then_block

    function buildIfElseChildren(registerValue: unknown): StackEntry[] {
      return [
        { id: 'read', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'mock_op',
          inputs: { x: { kind: 'internal', name: '$r0' } },
          outputs: { result: { kind: 'internal', name: '$r_err' } },
          status: 'pending' },
        { id: 'cs', parentIntentId: null, createdAt: 0,
          kind: 'conditional_skip', conditionAddr: { kind: 'internal', name: '$r_err' }, n: 2 },
        { id: 'else_block', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'mock_op',
          inputs: { x: { kind: 'internal', name: '$r0' } },
          outputs: { result: { kind: 'internal', name: '$r_else' } },
          status: 'pending' },
        { id: 'sn', parentIntentId: null, createdAt: 0,
          kind: 'skip_n', n: 1 },
        { id: 'then_block', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'mock_op',
          inputs: { x: { kind: 'internal', name: '$r0' } },
          outputs: { result: { kind: 'internal', name: '$r_then' } },
          status: 'pending' }
      ]
    }

    test('条件为真（$r_err truthy）→ 跳过 else，执行 then', async () => {
      // 先设置 $r_err 为 truthy（模拟文件不存在）
      state.internalStore.set('$r0', 2)  // op 读 $r0
      // mock_op: result = x*2 = 4 → $r_err = 4（truthy）

      const children = buildIfElseChildren(4)
      const l3 = createMockL3(children)
      state.l3 = l3

      await l1MainLoop({ type: 'if_else', params: {} }, state)

      // 条件为真 → then_block 执行（$r_then = 2*2 = 4）
      // else_block 被跳过（$r_else 未写）
      expect(state.internalStore.get('$r_then')).toBe(4)
      expect(state.internalStore.has('$r_else')).toBe(false)
      // op 调用 2 次：read + then_block
      expect(mockL2.tracker.getCallCount()).toBe(2)
    })

    test('条件为假（$r_err falsy）→ 执行 else，跳过 then', async () => {
      state.internalStore.set('$r0', 0)  // op 读 $r0
      // mock_op: result = 0*2 = 0（falsy）→ $r_err = 0（falsy）

      const children = buildIfElseChildren(0)
      const l3 = createMockL3(children)
      state.l3 = l3

      await l1MainLoop({ type: 'if_else', params: {} }, state)

      // 条件为假 → else_block 执行（$r_else = 0*2 = 0）
      // then_block 被跳过（$r_then 未写）
      expect(state.internalStore.get('$r_else')).toBe(0)
      expect(state.internalStore.has('$r_then')).toBe(false)
      // op 调用 2 次：read + else_block
      expect(mockL2.tracker.getCallCount()).toBe(2)
    })
  })

  // ============== 嵌套意图 ==============
  describe('嵌套意图（intent → children 含子 intent）', () => {
    test('根意图展开后含子意图，递归执行', async () => {
      const subChildren: StackEntry[] = [
        { id: 'sub_move', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 7 }, to: { kind: 'internal', name: '$r10' } }
      ]
      const rootChildren: StackEntry[] = [
        { id: 'root_move', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 1 }, to: { kind: 'internal', name: '$r0' } },
        { id: 'sub_intent', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'sub', params: {} },
          phase: 'pending', children: [] }
      ]

      // programmable L3：按 type 路由
      const l3 = createProgrammableL3()
      l3.setChildren('root', rootChildren)
      l3.setChildren('sub', subChildren)
      state.l3 = l3

      await l1MainLoop({ type: 'root', params: {} }, state)

      // 两个 move 都执行
      expect(state.internalStore.get('$r0')).toBe(1)
      expect(state.internalStore.get('$r10')).toBe(7)
      expect(state.stack.length).toBe(0)
    })

    test('深度嵌套（3 层）', async () => {
      const l3 = createProgrammableL3()
      // 层3：move
      l3.setChildren('level3', [
        { id: 'm3', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 3 }, to: { kind: 'internal', name: '$r3' } }
      ])
      // 层2：move + 子意图
      l3.setChildren('level2', [
        { id: 'm2', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 2 }, to: { kind: 'internal', name: '$r2' } },
        { id: 'i3', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'level3', params: {} },
          phase: 'pending', children: [] }
      ])
      // 层1：move + 子意图
      l3.setChildren('level1', [
        { id: 'm1', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 1 }, to: { kind: 'internal', name: '$r1' } },
        { id: 'i2', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'level2', params: {} },
          phase: 'pending', children: [] }
      ])
      state.l3 = l3

      await l1MainLoop({ type: 'level1', params: {} }, state)

      expect(state.internalStore.get('$r1')).toBe(1)
      expect(state.internalStore.get('$r2')).toBe(2)
      expect(state.internalStore.get('$r3')).toBe(3)
      expect(state.stack.length).toBe(0)
    })
  })

  // ============== 硬错误传播 ==============
  describe('硬错误传播', () => {
    test('throwing_op 抛错 → mainLoop 向上传播', async () => {
      const children: StackEntry[] = [
        { id: 'op_throw', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'throwing_op',
          inputs: {}, outputs: {}, status: 'pending' }
      ]
      const l3 = createMockL3(children)
      state.l3 = l3

      await expect(
        l1MainLoop({ type: 'throws', params: {} }, state)
      ).rejects.toThrow('mock_throw: hard error from throwing_op')
    })

    test('错误后栈状态保留（A10 将清理）', async () => {
      const children: StackEntry[] = [
        { id: 'op_throw', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'throwing_op',
          inputs: {}, outputs: {}, status: 'pending' }
      ]
      const l3 = createMockL3(children)
      state.l3 = l3

      try {
        await l1MainLoop({ type: 'throws', params: {} }, state)
      } catch {
        // 预期错误
      }

      // A9 骨架：错误直接传播，栈清理留给 A10
      // 此时栈残留 throwing_op entry（在栈顶）
      expect(state.stack.length).toBeGreaterThan(0)
    })

    test('L3 compile 抛错 → 向上传播', async () => {
      const throwingL3 = {
        compile: async () => { throw new Error('L3 compile exploded') },
        getExperience: () => null,
        recordFeedback: async () => {},
        listExperiences: () => [],
        recompile: async () => []
      }
      state.l3 = throwingL3

      await expect(
        l1MainLoop({ type: 'bad', params: {} }, state)
      ).rejects.toThrow('L3 compile exploded')
    })
  })

  // ============== maxSteps 防御 ==============
  describe('maxSteps 防御', () => {
    test('超限抛 L1MaxStepsError', async () => {
      // 无限递归意图（L3 总是返回含 execute_intent 的 children）
      const l3 = createProgrammableL3()
      l3.setChildren('loop', [
        { id: 'self', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'loop', params: {} },
          phase: 'pending', children: [] }
      ])
      state.l3 = l3

      await expect(
        l1MainLoop({ type: 'loop', params: {} }, state, { maxSteps: 10 })
      ).rejects.toThrow('L1 main loop exceeded max steps')
    })

    test('L1MaxStepsError 是 Error 子类', () => {
      const err = new L1MaxStepsError(42)
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('L1MaxStepsError')
      expect(err.message).toContain('42')
    })

    test('maxSteps 足够时正常完成', async () => {
      const children: StackEntry[] = [
        { id: 'm1', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 1 }, to: { kind: 'internal', name: '$r0' } }
      ]
      const l3 = createMockL3(children)
      state.l3 = l3

      // 3 步足够（root intent + move）
      await l1MainLoop({ type: 'small', params: {} }, state, { maxSteps: 5 })

      expect(state.stack.length).toBe(0)
      expect(state.internalStore.get('$r0')).toBe(1)
    })
  })

  // ============== 5-case dispatch 完整性 ==============
  describe('5-case dispatch 完整性', () => {
    test('五种 primitive 都能被主循环处理', async () => {
      // 构造包含全部 5 种 kind 的序列
      // move → op → skip_n(0) → conditional_skip(false) → intent
      const children: StackEntry[] = [
        { id: 'mv', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 1 }, to: { kind: 'internal', name: '$r0' } },
        { id: 'op', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'mock_op',
          inputs: { x: { kind: 'internal', name: '$r0' } },
          outputs: { result: { kind: 'internal', name: '$r1' } },
          status: 'pending' },
        { id: 'sn', parentIntentId: null, createdAt: 0,
          kind: 'skip_n', n: 0 },
        { id: 'cs', parentIntentId: null, createdAt: 0,
          kind: 'conditional_skip', conditionAddr: { kind: 'internal', name: '$r_flag' }, n: 0 },
        { id: 'it', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'inner', params: {} },
          phase: 'pending', children: [] }
      ]

      // inner intent 返回空
      const l3 = createProgrammableL3()
      l3.setChildren('all_kinds', children)
      l3.setChildren('inner', [])
      state.l3 = l3

      await l1MainLoop({ type: 'all_kinds', params: {} }, state)

      // 所有 entry 执行完成，栈空
      expect(state.stack.length).toBe(0)
      // op 执行了一次（mock_op: 1*2=2）
      expect(state.internalStore.get('$r1')).toBe(2)
      expect(mockL2.tracker.getCallCount()).toBe(1)
    })

    test('assertNever 类型检查（编译期）', () => {
      // 编译期验证：StackEntry union 的 5 种 kind
      const kinds: StackEntry['kind'][] = [
        'move', 'execute_op', 'execute_intent', 'skip_n', 'conditional_skip'
      ]
      expect(kinds).toHaveLength(5)
    })
  })

  // ============== 状态保留 ==============
  describe('状态保留', () => {
    test('publicStore 数据保留', async () => {
      state.publicStore.set('config', { mode: 'test' })
      const l3 = createMockL3([])
      state.l3 = l3

      await l1MainLoop({ type: 'noop', params: {} }, state)

      expect(state.publicStore.get('config')).toEqual({ mode: 'test' })
    })

    test('allocator 可被 L3 compile 使用（state 传递）', async () => {
      // 验证 compile 收到 state（含 allocator）
      let receivedAllocator: unknown = null
      const customL3 = {
        compile: async (_intent: RecognizedIntent, s: ExecutionState) => {
          receivedAllocator = s.allocator
          return []
        },
        getExperience: () => null,
        recordFeedback: async () => {},
        listExperiences: () => [],
        recompile: async () => []
      }
      state.l3 = customL3

      await l1MainLoop({ type: 'alloc_test', params: {} }, state)

      expect(receivedAllocator).toBe(state.allocator)
    })
  })

  // ============== 连续运行 ==============
  describe('连续运行', () => {
    test('同一 state 可运行多次（reset 后）', async () => {
      const l3 = createMockL3([])
      state.l3 = l3

      await l1MainLoop({ type: 'run1', params: {} }, state)
      expect(state.stack.length).toBe(0)

      // 再次运行
      await l1MainLoop({ type: 'run2', params: {} }, state)
      expect(state.stack.length).toBe(0)
    })
  })
})