/**
 * Phase A Tier A6 - conditional_skip primitive 测试（双区架构版）
 *
 * 验证：
 * 1. 各种值类型的 truthy 判断（isTruthy helper）
 * 2. 基本行为：truthy 跳 / falsy 仅跳 self
 * 3. conditionAddr 必须是 internal（双区架构约束）
 * 4. n < 0 抛 ConditionalSkipError
 * 5. 内部寄存器不存在视为 falsy（graceful）
 * 6. DAG if-then-else 场景
 * 7. 与 move/execute_op 配合
 * 8. 状态保留
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  executeConditionalSkip,
  isTruthy,
  ConditionalSkipError
} from '../../src/l1/primitives/conditional-skip.js'
import {
  createInitialState,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { createMockL2 } from '../../src/mocks/mock-l2.js'
import { createMockL3 } from '../../src/mocks/mock-l3.js'
import type { ConditionalSkip, StackEntry } from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'

describe('A6: conditional_skip primitive（双区架构版）', () => {
  let state: ExecutionState

  beforeEach(() => {
    const { registry: l2 } = createMockL2()
    const l3 = createMockL3([])
    state = createInitialState(l2, l3)
  })

  // ============== isTruthy helper ==============
  describe('isTruthy helper', () => {
    test('null/undefined → false', () => {
      expect(isTruthy(null)).toBe(false)
      expect(isTruthy(undefined)).toBe(false)
    })

    test('boolean → 本身', () => {
      expect(isTruthy(true)).toBe(true)
      expect(isTruthy(false)).toBe(false)
    })

    test('number: 0 → false, 非零 → true', () => {
      expect(isTruthy(0)).toBe(false)
      expect(isTruthy(-0)).toBe(false)
      expect(isTruthy(1)).toBe(true)
      expect(isTruthy(-1)).toBe(true)
      expect(isTruthy(42)).toBe(true)
    })

    test('string: 空串 → false, 非空 → true', () => {
      expect(isTruthy('')).toBe(false)
      expect(isTruthy('hello')).toBe(true)
      expect(isTruthy(' ')).toBe(true)  // 空格视为非空
    })

    test('array: 空数组 → false, 非空 → true', () => {
      expect(isTruthy([])).toBe(false)
      expect(isTruthy([1, 2, 3])).toBe(true)
      expect(isTruthy([null])).toBe(true)  // 含 null 元素的数组非空
    })

    test('object: 空对象 → false, 非空 → true', () => {
      expect(isTruthy({})).toBe(false)
      expect(isTruthy({ key: 'value' })).toBe(true)
      expect(isTruthy({ null: null })).toBe(true)  // null 值仍算 key
    })

    test('error-as-data 场景：OperationError 对象 → truthy', () => {
      const err = { code: 'ENOENT', message: 'not found', op: 'file_read' }
      expect(isTruthy(err)).toBe(true)  // 非空对象
    })

    test('conditional_skip 用空对象作为条件值（false 分支）', async () => {
      // 空对象 {} 走 Object.keys().length > 0 的 false 分支
      state.internalStore.set('$r_cond', {})
      const cond = createConditionalSkip('$r_cond', 0)
      state.stack.push(createMarker('then_block'))  // 保留
      state.stack.push(cond)                        // 弹出

      await executeConditionalSkip(cond, state)

      // 空对象是 falsy → 仅弹 self
      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('then_block')
    })
  })

  // ============== 基本行为 ==============
  describe('基本行为', () => {
    test('truthy + n=0：弹出 self', async () => {
      state.internalStore.set('$r_cond', true)
      const cond = createConditionalSkip('$r_cond', 0)
      state.stack.push(createMarker('m1'))  // bottom
      state.stack.push(cond)                 // top

      await executeConditionalSkip(cond, state)

      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('m1')
    })

    test('truthy + n=2：弹出 self + 2 个后续', async () => {
      state.internalStore.set('$r_cond', true)
      const cond = createConditionalSkip('$r_cond', 2)
      state.stack.push(createMarker('keep'))  // bottom
      state.stack.push(createMarker('m1'))    // 弹出
      state.stack.push(createMarker('m2'))    // 弹出
      state.stack.push(cond)                  // 弹出

      await executeConditionalSkip(cond, state)

      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('keep')
    })

    test('falsy + n=0：仅弹出 self', async () => {
      state.internalStore.set('$r_cond', false)
      const cond = createConditionalSkip('$r_cond', 0)
      state.stack.push(createMarker('m1'))    // bottom
      state.stack.push(createMarker('m2'))    // 弹出
      state.stack.push(cond)                  // 弹出

      await executeConditionalSkip(cond, state)

      expect(state.stack.length).toBe(2)
      expect(state.stack[0].id).toBe('m1')
      expect(state.stack[1].id).toBe('m2')
    })

    test('falsy + n=2：仅弹出 self，不跳 m1/m2', async () => {
      state.internalStore.set('$r_cond', null)
      const cond = createConditionalSkip('$r_cond', 2)
      state.stack.push(createMarker('keep'))  // bottom
      state.stack.push(createMarker('m1'))    // 保留
      state.stack.push(createMarker('m2'))    // 保留
      state.stack.push(cond)                  // 弹出

      await executeConditionalSkip(cond, state)

      expect(state.stack.length).toBe(3)
      expect(state.stack[0].id).toBe('keep')
      expect(state.stack[1].id).toBe('m1')
      expect(state.stack[2].id).toBe('m2')
    })

    test('$r_err = null（成功）→ falsy', async () => {
      state.internalStore.set('$r_err', null)
      const cond = createConditionalSkip('$r_err', 0)
      state.stack.push(createMarker('then_block'))
      state.stack.push(cond)

      await executeConditionalSkip(cond, state)

      // falsy → 仅弹 self，then_block 保留
      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('then_block')
    })

    test('$r_err = OperationError（失败）→ truthy', async () => {
      state.internalStore.set('$r_err', {
        code: 'ENOENT', message: 'not found', op: 'file_read', timestamp: Date.now()
      })
      const cond = createConditionalSkip('$r_err', 1)
      state.stack.push(createMarker('then_block'))  // 弹出（跳过）
      state.stack.push(cond)                          // 弹出

      await executeConditionalSkip(cond, state)

      // truthy → 弹 self + then_block
      expect(state.stack.length).toBe(0)
    })
  })

  // ============== 双区架构约束 ==============
  describe('conditionAddr 必须是 internal', () => {
    test('literal kind 抛 ConditionalSkipError', async () => {
      const cond: ConditionalSkip = {
        id: 'cs1', parentIntentId: null, createdAt: 0,
        kind: 'conditional_skip',
        conditionAddr: { kind: 'literal', value: true } as any,  // 故意传错
        n: 0
      }
      state.stack.push(cond)

      await expect(executeConditionalSkip(cond, state))
        .rejects.toThrow(ConditionalSkipError)
      await expect(executeConditionalSkip(cond, state))
        .rejects.toThrow(/must be internal/)
    })

    test('public kind 抛 ConditionalSkipError', async () => {
      const cond: ConditionalSkip = {
        id: 'cs2', parentIntentId: null, createdAt: 0,
        kind: 'conditional_skip',
        conditionAddr: { kind: 'public', name: 'business_var' } as any,
        n: 0
      }
      state.stack.push(cond)

      await expect(executeConditionalSkip(cond, state))
        .rejects.toThrow(ConditionalSkipError)
    })

    test('file kind 抛 ConditionalSkipError', async () => {
      const cond: ConditionalSkip = {
        id: 'cs3', parentIntentId: null, createdAt: 0,
        kind: 'conditional_skip',
        conditionAddr: { kind: 'file', path: '/tmp/x' } as any,
        n: 0
      }
      state.stack.push(cond)

      await expect(executeConditionalSkip(cond, state))
        .rejects.toThrow(ConditionalSkipError)
    })

    test('internal kind 通过校验', async () => {
      state.internalStore.set('$r_cond', true)
      const cond = createConditionalSkip('$r_cond', 0)
      state.stack.push(cond)

      await expect(executeConditionalSkip(cond, state)).resolves.not.toThrow()
    })
  })

  // ============== 参数校验 ==============
  describe('n < 0 抛错', () => {
    test('n=-1 抛 ConditionalSkipError', async () => {
      state.internalStore.set('$r_cond', true)
      const cond = createConditionalSkip('$r_cond', -1)

      await expect(executeConditionalSkip(cond, state))
        .rejects.toThrow(ConditionalSkipError)
      await expect(executeConditionalSkip(cond, state))
        .rejects.toThrow(/n must be >= 0/)
    })

    test('n=-100 抛 ConditionalSkipError', async () => {
      const cond = createConditionalSkip('$r_cond', -100)

      await expect(executeConditionalSkip(cond, state))
        .rejects.toThrow(ConditionalSkipError)
    })
  })

  // ============== Graceful 处理 ==============
  describe('边界与 graceful', () => {
    test('内部寄存器不存在视为 falsy（不抛错）', async () => {
      // $r_uninit 未设置
      const cond = createConditionalSkip('$r_uninit', 0)
      state.stack.push(createMarker('m'))
      state.stack.push(cond)

      // 应不抛错，falsy 弹 self
      await expect(executeConditionalSkip(cond, state)).resolves.not.toThrow()
      expect(state.stack.length).toBe(1)
    })

    test('栈不足时不抛错（truthy 但栈已空）', async () => {
      state.internalStore.set('$r_cond', true)
      const cond = createConditionalSkip('$r_cond', 5)
      state.stack.push(cond)

      // 只剩 self，请求弹 6 个
      await expect(executeConditionalSkip(cond, state)).resolves.not.toThrow()
      expect(state.stack.length).toBe(0)
    })
  })

  // ============== DAG if-then-else 场景 ==============
  describe('DAG if-then-else', () => {
    test('完整流程：file_read 错误 → 走 else 块', async () => {
      // 编译产物（栈从底到顶）：
      //   [then_block, skip_n(1), else_block, conditional_skip($r_err, n=2), file_read_entry]
      //
      // 假设 file_read 已完成（已 pop），$r_err = OperationError
      // 现在栈：[then_block, skip_n(1), else_block, cond_skip]
      //   cond_skip: conditionAddr=$r_err, n=2

      state.internalStore.set('$r_err', { code: 'ENOENT', message: 'nf', op: 'file_read', timestamp: 0 })
      const condSkip = createConditionalSkip('$r_err', 2)
      const elseBlock = createMarker('else_block')
      const skipN = createSkipN(1)
      const thenBlock = createMarker('then_block')

      state.stack.push(thenBlock)
      state.stack.push(skipN)
      state.stack.push(elseBlock)
      state.stack.push(condSkip)

      // 执行 cond_skip：$r_err 是 truthy → 弹 self + 2 (elseBlock, skipN)
      await executeConditionalSkip(condSkip, state)

      // 栈剩 [then_block]
      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('then_block')

      // 模拟执行 then_block
      state.stack.pop()
      expect(state.stack.length).toBe(0)
    })

    test('完整流程：file_read 成功 → 走 then 块', async () => {
      // $r_err = null（成功），cond_skip falsy → 仅弹 self，继续执行 elseBlock
      state.internalStore.set('$r_err', null)
      const condSkip = createConditionalSkip('$r_err', 2)
      const elseBlock = createMarker('else_block')
      const skipN = createSkipN(1)
      const thenBlock = createMarker('then_block')

      state.stack.push(thenBlock)
      state.stack.push(skipN)
      state.stack.push(elseBlock)
      state.stack.push(condSkip)

      await executeConditionalSkip(condSkip, state)

      // falsy → 仅弹 self，剩 [then_block, skipN, elseBlock]
      expect(state.stack.length).toBe(3)
      expect(state.stack[0].id).toBe('then_block')
      expect(state.stack[1].id).toBe(skipN.id)
      expect(state.stack[2].id).toBe('else_block')
    })
  })

  // ============== 与 execute_op / move 配合 ==============
  describe('与其他 primitive 配合', () => {
    test('先 move 写入 $r_cond，再 conditional_skip', async () => {
      const move = createMarker('move_entry', { kind: 'move' as const })
      const cond = createConditionalSkip('$r_cond', 0)

      // 模拟：先执行 move（literal true → $r_cond）
      state.stack.push(cond)
      state.stack.push(move)
      state.stack.pop()  // move done
      // 现在栈顶是 cond，且 $r_cond 未设置（move 未真正执行）

      // 但 executeConditionalSkip 直接读 internalStore
      // 这里直接预设置 $r_cond 模拟 move 效果
      state.internalStore.set('$r_cond', true)
      await executeConditionalSkip(cond, state)

      expect(state.stack.length).toBe(0)
    })
  })

  // ============== 多次连续调用 ==============
  describe('多次连续调用', () => {
    test('连续两个 conditional_skip', async () => {
      state.internalStore.set('$r_a', true)
      state.internalStore.set('$r_b', false)

      const cond1 = createConditionalSkip('$r_a', 0)
      const cond2 = createConditionalSkip('$r_b', 0)

      state.stack.push(cond1)
      state.stack.push(cond2)

      // cond2 falsy → 仅弹 self
      await executeConditionalSkip(cond2, state)
      expect(state.stack.length).toBe(1)

      // cond1 truthy → 弹 self
      await executeConditionalSkip(cond1, state)
      expect(state.stack.length).toBe(0)
    })
  })

  // ============== 状态保留 ==============
  describe('状态保留', () => {
    test('不动 publicStore', async () => {
      state.publicStore.set('business_data', 'preserve')
      state.internalStore.set('$r_cond', true)
      const cond = createConditionalSkip('$r_cond', 0)
      state.stack.push(cond)

      await executeConditionalSkip(cond, state)

      expect(state.publicStore.get('business_data')).toBe('preserve')
    })

    test('不动其他 internal 寄存器', async () => {
      state.internalStore.set('$r_other', 'preserve')
      state.internalStore.set('$r_cond', true)
      const cond = createConditionalSkip('$r_cond', 0)
      state.stack.push(cond)

      await executeConditionalSkip(cond, state)

      expect(state.internalStore.get('$r_other')).toBe('preserve')
    })

    test('不动 allocator', async () => {
      state.allocator.allocate()
      state.allocator.allocate()
      const before = state.allocator.maxAllocated()

      state.internalStore.set('$r_cond', true)
      const cond = createConditionalSkip('$r_cond', 0)
      state.stack.push(cond)

      await executeConditionalSkip(cond, state)

      expect(state.allocator.maxAllocated()).toBe(before)
    })
  })

  // ============== ConditionalSkipError 类型 ==============
  describe('ConditionalSkipError', () => {
    test('是 Error 子类', () => {
      const err = new ConditionalSkipError('test')
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('ConditionalSkipError')
      expect(err.message).toBe('test')
    })
  })
})

// ============== Helpers ==============

/**
 * 创建一个 ConditionalSkip entry
 */
function createConditionalSkip(conditionReg: string, n: number): ConditionalSkip {
  return {
    id: generateId('cs'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'conditional_skip',
    conditionAddr: { kind: 'internal', name: conditionReg },
    n
  }
}

/**
 * 创建一个 SkipN entry
 */
function createSkipN(n: number): StackEntry {
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