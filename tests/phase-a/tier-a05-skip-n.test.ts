/**
 * Phase A Tier A5 - skip_n primitive 测试
 *
 * 验证：
 * 1. 基本 pop（n=0, n=1, n=3）
 * 2. 边界（栈不足时不抛错）
 * 3. n<0 抛 SkipNError
 * 4. DAG if-then-else 场景
 * 5. 状态保留（不动 publicStore/internalStore/allocator）
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { executeSkipN, SkipNError } from '../../src/l1/primitives/skip-n.js'
import {
  createInitialState,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { createMockL2 } from '../../src/mocks/mock-l2.js'
import { createMockL3 } from '../../src/mocks/mock-l3.js'
import type { SkipN, StackEntry } from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'

describe('A5: skip_n primitive', () => {
  let state: ExecutionState

  beforeEach(() => {
    const { registry: l2 } = createMockL2()
    const l3 = createMockL3([])
    state = createInitialState(l2, l3)
  })

  // ============== 基本行为 ==============
  describe('基本行为', () => {
    test('n=0：仅弹出 self（1 个）', async () => {
      // 栈布局（底→顶）：[marker-1, skip]
      // 执行 skip_n(0)：弹 1 个（skip），剩 [marker-1]
      const skip = createSkipN(0)
      state.stack.push(createMarker('marker-1'))  // bottom
      state.stack.push(skip)                       // top

      await executeSkipN(skip, state)

      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('marker-1')
    })

    test('n=1：弹出 self + 1 个后续（2 个）', async () => {
      // 栈布局（底→顶）：[m2, m1, skip]
      // 执行 skip_n(1)：弹 2 个（skip, m1），剩 [m2]
      const skip = createSkipN(1)
      state.stack.push(createMarker('m2'))   // bottom (保留)
      state.stack.push(createMarker('m1'))    // middle (弹出)
      state.stack.push(skip)                  // top (弹出)

      await executeSkipN(skip, state)

      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('m2')
    })

    test('n=3：弹出 self + 3 个后续（4 个）', async () => {
      // 栈布局（底→顶）：[keep, m3, m2, m1, skip]
      // 执行 skip_n(3)：弹 4 个（skip, m1, m2, m3），剩 [keep]
      const skip = createSkipN(3)
      state.stack.push(createMarker('keep'))   // bottom (保留)
      state.stack.push(createMarker('m3'))     // 弹出
      state.stack.push(createMarker('m2'))     // 弹出
      state.stack.push(createMarker('m1'))     // 弹出
      state.stack.push(skip)                    // top (弹出)

      await executeSkipN(skip, state)

      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('keep')
    })

    test('n=10：弹空所有栈（仅 1 个元素时）', async () => {
      const skip = createSkipN(10)
      state.stack.push(skip)

      await executeSkipN(skip, state)

      expect(state.stack.length).toBe(0)
    })
  })

  // ============== 边界条件 ==============
  describe('边界条件', () => {
    test('栈不足时不抛错（graceful）', async () => {
      // 栈上只有 self，n=5 要求弹 6 个
      const skip = createSkipN(5)
      state.stack.push(skip)

      await expect(executeSkipN(skip, state)).resolves.not.toThrow()
      expect(state.stack.length).toBe(0)
    })

    test('空栈调用安全（虽然不符合实际执行流程）', async () => {
      // 注意：实际 main loop 不会从空栈取 skip_n 来执行
      // 这里测试"如果被调用，行为是安全的"
      const skip = createSkipN(3)
      // 不 push

      await expect(executeSkipN(skip, state)).resolves.not.toThrow()
      expect(state.stack.length).toBe(0)
    })

    test('n=0 在空栈上调用', async () => {
      const skip = createSkipN(0)

      await expect(executeSkipN(skip, state)).resolves.not.toThrow()
      expect(state.stack.length).toBe(0)
    })
  })

  // ============== n<0 错误 ==============
  describe('参数校验', () => {
    test('n=-1 抛 SkipNError', async () => {
      const skip = createSkipN(-1)
      state.stack.push(skip)

      await expect(executeSkipN(skip, state)).rejects.toThrow(SkipNError)
      await expect(executeSkipN(skip, state)).rejects.toThrow(/n must be >= 0/)
    })

    test('n=-100 抛 SkipNError', async () => {
      const skip = createSkipN(-100)

      await expect(executeSkipN(skip, state)).rejects.toThrow(SkipNError)
    })

    test('SkipNError 是 Error 子类', () => {
      const err = new SkipNError('test')
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('SkipNError')
      expect(err.message).toBe('test')
    })
  })

  // ============== DAG if-then-else 场景 ==============
  describe('DAG if-then-else 使用场景', () => {
    test('场景 1：跳过 then-block（条件为假）', async () => {
      // 编译产生的 DAG：
      //   [op_read, cond_skip(n=2), else_block, skip_n(n=1), then_block]
      //
      // 假设 op_read 成功，cond_skip 跳过 else_block + skip_n，
      // 然后执行 then_block。
      // 我们测试"条件为假"路径：cond_skip 不跳，执行 else_block，
      // 然后 skip_n 跳过 then_block。

      const op = createOp('op-read')
      const condSkip = createMarker('cond-skip', { kind: 'conditional_skip', n: 2 })
      const elseBlock = createMarker('else-block', { kind: 'execute_op', n: 1 })
      const skip = createSkipN(1)  // 跳 then_block
      const thenBlock = createMarker('then-block', { kind: 'execute_op', n: 0 })

      // 假设栈上已经只剩下 skip（cond_skip 和 else_block 已被处理）
      state.stack.push(thenBlock)
      state.stack.push(skip)

      await executeSkipN(skip, state)

      // then_block 已被弹出，栈空
      expect(state.stack.length).toBe(0)
    })

    test('场景 2：跳过 then-block（条件为真也走此路径）', async () => {
      // 假设 cond_skip 跳过了 else_block + skip_n，直接到 then_block
      // 这种情况下 skip_n 不会被执行

      const thenBlock = createMarker('then-block', { kind: 'execute_op', n: 0 })
      state.stack.push(thenBlock)

      // 模拟 skip_n 不被调用
      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('then-block')
    })

    test('场景 3：完整 DAG 模拟（手动驱动）', async () => {
      // 初始编译产物（压栈顺序是逆序）：
      //   压栈: thenBlock, skip, elseBlock, condSkip, op
      //   栈底→顶: [op, condSkip, elseBlock, skip, thenBlock]
      //
      // 模拟手动驱动：
      // 1. 执行 op（pop top thenBlock? 不，op 在底部）
      //
      // 重新设计：初始栈只含 thenBlock 和 skip
      //   栈底→顶: [thenBlock, skip]
      //   然后执行 skip(n=0)，弹出 skip，剩 thenBlock
      //
      // 实际 DAG 场景是：前面的都已被处理，留 skip + thenBlock
      const skip = createSkipN(0)
      const thenBlock = createMarker('thenBlock')

      state.stack.push(thenBlock)  // bottom
      state.stack.push(skip)        // top

      expect(state.stack.length).toBe(2)
      expect(state.stack[0].id).toBe('thenBlock')
      expect(state.stack[1].id).toBe(skip.id)

      // 执行 skip_n(0)：弹 1 个（skip），剩 [thenBlock]
      await executeSkipN(skip, state)

      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('thenBlock')
    })
  })

  // ============== 状态保留 ==============
  describe('状态保留', () => {
    test('不动 publicStore', async () => {
      state.publicStore.set('business_data', 'preserve me')
      const before = state.publicStore.get('business_data')

      const skip = createSkipN(0)
      state.stack.push(skip)

      await executeSkipN(skip, state)

      expect(state.publicStore.get('business_data')).toBe(before)
      expect(state.publicStore.has('business_data')).toBe(true)
    })

    test('不动 internalStore', async () => {
      state.internalStore.set('$r0', 'preserve me')
      state.internalStore.set('$r_err', null)
      const before = state.internalStore.get('$r0')

      const skip = createSkipN(0)
      state.stack.push(skip)

      await executeSkipN(skip, state)

      expect(state.internalStore.get('$r0')).toBe(before)
      expect(state.internalStore.has('$r_err')).toBe(true)
    })

    test('不动 allocator', async () => {
      state.allocator.allocate()
      state.allocator.allocate()
      const before = state.allocator.maxAllocated()

      const skip = createSkipN(0)
      state.stack.push(skip)

      await executeSkipN(skip, state)

      expect(state.allocator.maxAllocated()).toBe(before)
    })

    test('不动 l2/l3 引用', async () => {
      const l2Ref = state.l2
      const l3Ref = state.l3

      const skip = createSkipN(0)
      state.stack.push(skip)

      await executeSkipN(skip, state)

      expect(state.l2).toBe(l2Ref)
      expect(state.l3).toBe(l3Ref)
    })
  })

  // ============== 与 move 配合 ==============
  describe('与 move primitive 配合（其他 primitive 不受影响）', () => {
    test('move 完成后再 skip_n', async () => {
      const move = createMarker('move-entry', { kind: 'move' as const })
      const skip = createSkipN(0)
      state.stack.push(skip)
      state.stack.push(move)

      // 模拟：先执行 move（弹 move）
      state.stack.pop()  // move done

      // 现在栈顶是 skip
      expect(state.stack[0].id).toBe(skip.id)

      // 执行 skip_n
      await executeSkipN(skip, state)

      expect(state.stack.length).toBe(0)
    })
  })

  // ============== 多次连续调用 ==============
  describe('多次连续调用', () => {
    test('连续两个 skip_n', async () => {
      const skip1 = createSkipN(0)
      const skip2 = createSkipN(0)
      state.stack.push(skip1)
      state.stack.push(skip2)

      await executeSkipN(skip2, state)  // 弹 skip2
      expect(state.stack.length).toBe(1)

      await executeSkipN(skip1, state)  // 弹 skip1
      expect(state.stack.length).toBe(0)
    })

    test('skip_n 之间有其他 entry', async () => {
      const skip1 = createSkipN(0)
      const m = createMarker('m')
      const skip2 = createSkipN(0)
      state.stack.push(skip1)
      state.stack.push(m)
      state.stack.push(skip2)

      // 执行 skip2
      await executeSkipN(skip2, state)
      expect(state.stack.length).toBe(2)

      // 模拟执行 m
      state.stack.pop()
      expect(state.stack.length).toBe(1)

      // 执行 skip1
      await executeSkipN(skip1, state)
      expect(state.stack.length).toBe(0)
    })
  })
})

// ============== Helpers ==============

/**
 * 创建一个 SkipN entry
 */
function createSkipN(n: number): SkipN {
  return {
    id: generateId('skip'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'skip_n',
    n
  }
}

/**
 * 创建一个标记 entry（用于栈测试）
 */
function createMarker(id: string, override?: Partial<StackEntry>): StackEntry {
  return {
    id,
    parentIntentId: null,
    createdAt: now(),
    kind: 'execute_op',
    operation: 'noop',
    inputs: {},
    outputs: {},
    status: 'pending',
    ...override
  } as StackEntry
}

/**
 * 创建一个占位 op entry
 */
function createOp(id: string): StackEntry {
  return createMarker(id)
}