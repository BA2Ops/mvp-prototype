/**
 * Phase A Tier A11 - 递归深度跟踪（enterIntent / exitIntent）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §三（递归深度安全网）
 * @see ../../docs/mvp/09-l1-implementation.md §循环支持
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase A11
 *
 * 覆盖：
 * 1. enterIntent/exitIntent 单元行为（递增/递减/归零/防御）
 * 2. 超限抛 RecursionDepthError（信息完整）
 * 3. 集成：有限递归（countdown）正常完成 + 深度归零
 * 4. 集成：无限递归 + maxRecursionDepth → RecursionDepthError
 * 5. RecursionDepthError 不走业务冒泡（handleError 帧也不截获）
 * 6. 异常冒泡穿过递归帧 → 深度计数清理（无泄漏）
 * 7. 异常截获在 handleError 帧 → 深度保留，完成后归零
 * 8. 不同 intent 深度独立计数
 */

import { describe, expect, test, beforeEach } from 'vitest'
import { l1MainLoop, UnhandledError } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import type { ExecutionState } from '../../src/l1/execution-state.js'
import type { RecognizedIntent, StackEntry } from '../../src/l1/types.js'
import {
  DEFAULT_MAX_RECURSION_DEPTH,
  enterIntent,
  exitIntent,
  RecursionDepthError
} from '../../src/l1/recursion.js'
import type { Operation } from '../../src/l2/operation.js'
import { createMockL2 } from '../../src/mocks/mock-l2.js'
import { createProgrammableL3 } from '../../src/mocks/mock-l3.js'

describe('A11: 递归深度跟踪（enterIntent/exitIntent）', () => {
  let state: ExecutionState

  beforeEach(() => {
    state = createInitialState(createMockL2().registry, createProgrammableL3())
  })

  // ============== 单元测试：enterIntent / exitIntent ==============
  describe('enterIntent / exitIntent 单元行为', () => {
    test('enterIntent 递增并记录深度', () => {
      enterIntent('A', state)
      expect(state.recursionDepth.get('A')).toBe(1)

      enterIntent('A', state)
      expect(state.recursionDepth.get('A')).toBe(2)
    })

    test('exitIntent 递减深度', () => {
      enterIntent('A', state)
      enterIntent('A', state)
      exitIntent('A', state)
      expect(state.recursionDepth.get('A')).toBe(1)
    })

    test('exitIntent 归零时删除键（Map 保持干净）', () => {
      enterIntent('A', state)
      exitIntent('A', state)
      expect(state.recursionDepth.has('A')).toBe(false)
      expect(state.recursionDepth.size).toBe(0)
    })

    test('exitIntent 对未 enter 的意图不抛错（防御）', () => {
      // 空计数上 exit：静默返回，不破坏状态
      expect(() => exitIntent('nonexistent', state)).not.toThrow()
      expect(state.recursionDepth.size).toBe(0)
    })

    test('不同 intent 深度独立计数', () => {
      enterIntent('A', state)
      enterIntent('A', state)
      enterIntent('B', state)

      expect(state.recursionDepth.get('A')).toBe(2)
      expect(state.recursionDepth.get('B')).toBe(1)

      exitIntent('A', state)
      expect(state.recursionDepth.get('A')).toBe(1)
      expect(state.recursionDepth.get('B')).toBe(1)
    })

    test('超限抛 RecursionDepthError（含意图名与深度）', () => {
      enterIntent('loop', state)
      enterIntent('loop', state)

      expect(() => enterIntent('loop', state, 2)).toThrow(RecursionDepthError)
      expect(() => enterIntent('loop', state, 2)).toThrow(/loop.*exceeded max recursion depth/)
    })

    test('RecursionDepthError 是 Error 子类', () => {
      const err = new RecursionDepthError('loop', 4)
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('RecursionDepthError')
      expect(err.message).toContain('loop')
      expect(err.message).toContain('4')
    })

    test('默认最大深度为 1000', () => {
      expect(DEFAULT_MAX_RECURSION_DEPTH).toBe(1000)
    })

    test('enterIntent 不超限时正常递增（边界：next === maxDepth 允许）', () => {
      enterIntent('A', state)
      enterIntent('A', state)
      // next = 3, maxDepth = 3 → 允许
      expect(() => enterIntent('A', state, 3)).not.toThrow()
      expect(state.recursionDepth.get('A')).toBe(3)
      // next = 4 > 3 → 超限
      expect(() => enterIntent('A', state, 3)).toThrow(RecursionDepthError)
    })
  })

  // ============== countdown 递归经验辅助 ==============
  /**
   * 循环模式（doc 10 §6.5）：children = [inc($r_counter, → $r_stop), conditional_skip($r_stop, n=1), execute_intent(countdown)]
   *
   * - inc：$r_counter += 1，返回 stop = ($r_counter >= max)
   * - conditional_skip：stop truthy → 跳过 execute_intent(self) → 终止
   * - stop falsy → 执行 self → 递归
   *
   * $r_counter 初始 0，max=3：inc 调用 3 次（0→1, 1→2, 2→3），深度最大 4（root + 3 层）
   */
  function setupCountdown(): { incCalls: () => number } {
    const l3 = createProgrammableL3()
    let incCalls = 0

    const incrementOp: Operation = {
      name: 'increment',
      description: 'increments counter, returns stop when >= max',
      formalSpec: {
        inputs: { value: { businessName: 'value', register: '$r0', type: 'number', required: true } },
        outputs: {
          value: { businessName: 'value', register: '$r1', type: 'number', required: true },
          stop: { businessName: 'stop', register: '$r2', type: 'boolean', required: true }
        }
      },
      execute: async (inputs) => {
        incCalls++
        const next = (inputs.value as number) + 1
        return { value: next, stop: next >= 3 }
      }
    }
    state.l2.register(incrementOp)

    const countdownChildren: StackEntry[] = [
      {
        id: 'inc', parentIntentId: null, createdAt: 0,
        kind: 'execute_op', operation: 'increment',
        inputs: { value: { kind: 'internal', name: '$r_counter' } },
        outputs: {
          value: { kind: 'internal', name: '$r_counter' },
          stop: { kind: 'internal', name: '$r_stop' }
        },
        status: 'pending'
      },
      {
        id: 'cs', parentIntentId: null, createdAt: 0,
        kind: 'conditional_skip',
        conditionAddr: { kind: 'internal', name: '$r_stop' },
        n: 1
      },
      {
        id: 'self', parentIntentId: null, createdAt: 0,
        kind: 'execute_intent', intent: { type: 'countdown', params: {} },
        phase: 'pending', children: [], handleError: false
      }
    ]
    l3.setChildren('countdown', countdownChildren)
    state.l3 = l3

    return { incCalls: () => incCalls }
  }

  // ============== 集成：有限递归 ==============
  describe('有限递归（countdown 3→0）', () => {
    test('正常完成：inc 调用 3 次，深度归零，栈空', async () => {
      const { incCalls } = setupCountdown()
      state.internalStore.set('$r_counter', 0)

      await l1MainLoop({ type: 'countdown', params: {} }, state)

      expect(incCalls()).toBe(3)
      expect(state.internalStore.get('$r_counter')).toBe(3)
      expect(state.internalStore.get('$r_stop')).toBe(true)
      expect(state.stack.length).toBe(0)
      // 深度计数全部释放
      expect(state.recursionDepth.size).toBe(0)
    })

    test('maxRecursionDepth 边界：3 允许完成，2 超限', async () => {
      state.internalStore.set('$r_counter', 0)
      setupCountdown()

      // 实际深度：root(1) + self(2) + self2(3) = 3（第 3 次 inc 后 stop=true 不再递归）
      await l1MainLoop({ type: 'countdown', params: {} }, state, { maxRecursionDepth: 3 })
      expect(state.stack.length).toBe(0)

      // maxDepth=2 → self2 进入时超限
      state = createInitialState(createMockL2().registry, createProgrammableL3())
      setupCountdown()
      state.internalStore.set('$r_counter', 0)
      await expect(
        l1MainLoop({ type: 'countdown', params: {} }, state, { maxRecursionDepth: 2 })
      ).rejects.toThrow(RecursionDepthError)
    })
  })

  // ============== 集成：无限递归 + 深度超限 ==============
  describe('无限递归（深度超限防御）', () => {
    test('无终止递归 → RecursionDepthError 抛给调用者', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('loop', [
        {
          id: 'self', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'loop', params: {} },
          phase: 'pending', children: [], handleError: false
        }
      ])
      state.l3 = l3

      await expect(
        l1MainLoop({ type: 'loop', params: {} }, state, { maxRecursionDepth: 3 })
      ).rejects.toThrow(RecursionDepthError)
    })

    test('RecursionDepthError 不走业务冒泡（handleError=true 帧也不截获）', async () => {
      // 每个递归帧 handleError=true——若防御错误走冒泡会被截获 → 无限重试
      const l3 = createProgrammableL3()
      l3.setChildren('loop', [
        {
          id: 'self', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'loop', params: {} },
          phase: 'pending', children: [], handleError: true
        }
      ])
      state.l3 = l3

      await expect(
        l1MainLoop({ type: 'loop', params: {} }, state, { maxRecursionDepth: 3 })
      ).rejects.toThrow(RecursionDepthError)
    })

    test('超限错误不是 UnhandledError（无冒泡包装）', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('loop', [
        {
          id: 'self', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'loop', params: {} },
          phase: 'pending', children: [], handleError: false
        }
      ])
      state.l3 = l3

      try {
        await l1MainLoop({ type: 'loop', params: {} }, state, { maxRecursionDepth: 3 })
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(RecursionDepthError)
        expect(err).not.toBeInstanceOf(UnhandledError)
      }
    })
  })

  // ============== 集成：异常冒泡与深度清理 ==============
  describe('异常冒泡与深度计数清理', () => {
    test('冒泡无 handler → 所有帧 exitIntent，深度归零', async () => {
      // root → B(无标志) → [throwing_op]
      const l3 = createProgrammableL3()
      l3.setChildren('root', [
        {
          id: 'b', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'B', params: {} },
          phase: 'pending', children: [], handleError: false
        }
      ])
      l3.setChildren('B', [
        {
          id: 'op', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'throwing_op',
          inputs: {}, outputs: {}, status: 'pending'
        }
      ])
      state.l3 = l3

      await expect(
        l1MainLoop({ type: 'root', params: {} }, state)
      ).rejects.toThrow(UnhandledError)

      // root 和 B 都已被释放
      expect(state.recursionDepth.size).toBe(0)
    })

    test('冒泡截获在 handleError 帧 → 深度保留，帧完成后再释放', async () => {
      // root(无标志) → [G(handleError=true), op_after]
      // G → [throwing_op]
      // 异常截获在 G → G 保留（catch 逻辑）→ G 完成 → op_after → root 完成
      const l3 = createProgrammableL3()
      l3.setChildren('root', [
        {
          id: 'g', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'G', params: {} },
          phase: 'pending', children: [], handleError: true
        },
        {
          id: 'after', parentIntentId: null, createdAt: 0,
          kind: 'move', from: { kind: 'literal', value: 1 }, to: { kind: 'internal', name: '$r_done' }
        }
      ])
      l3.setChildren('G', [
        {
          id: 'op', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'throwing_op',
          inputs: {}, outputs: {}, status: 'pending'
        }
      ])
      state.l3 = l3

      await l1MainLoop({ type: 'root', params: {} }, state)

      // 全部完成：深度归零、栈空、catch 后的指令执行
      expect(state.recursionDepth.size).toBe(0)
      expect(state.stack.length).toBe(0)
      expect(state.internalStore.get('$r_done')).toBe(1)
      // $r_err 记录了异常（截获后 DAG 可读）
      expect(state.internalStore.get('$r_err')).toBeDefined()
    })

    test('多层递归中异常冒泡 → 每层 exitIntent（不泄漏）', async () => {
      // loop(无限递归) + 深处 throwing：冒泡无 handler → 所有帧释放
      const l3 = createProgrammableL3()
      l3.setChildren('loop', [
        {
          id: 'op', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'throwing_op',
          inputs: {}, outputs: {}, status: 'pending'
        },
        {
          id: 'self', parentIntentId: null, createdAt: 0,
          kind: 'execute_intent', intent: { type: 'loop', params: {} },
          phase: 'pending', children: [], handleError: false
        }
      ])
      state.l3 = l3

      // children = [op, self] 逆序压栈 → op 先执行 → 抛错 → 冒泡穿过递归帧
      await expect(
        l1MainLoop({ type: 'loop', params: {} }, state)
      ).rejects.toThrow(UnhandledError)

      expect(state.recursionDepth.size).toBe(0)
    })
  })
})
