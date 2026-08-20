/**
 * Phase A Tier A7 - execute_op primitive 测试（双区架构版）
 *
 * 验证：
 * 1. 基本调用：从 internalStore 读取 inputs → 调用 mock_op → 写入 outputs
 * 2. 双区约束：inputs/outputs 必须是 internal（违规抛错）
 * 3. op 未注册：抛 ExecuteOpError
 * 4. 已知错误路径：op 返回 { error: OperationError } → 写入 $r_err
 * 5. 硬错误路径：op throw → 向上抛（由主循环处理）
 * 6. 多次调用、并发调用（验证 tracker）
 * 7. 与 move 配合（literal → internal → op → internal）
 * 8. 状态保留与清理
 * 9. entry.status 生命周期
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { executeOp, ExecuteOpError } from '../../src/l1/primitives/execute-op.js'
import {
  createInitialState,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { createMockL2, createProgrammableOp, type MockL2 } from '../../src/mocks/mock-l2.js'
import { createMockL3 } from '../../src/mocks/mock-l3.js'
import type { OpEntry, Address } from '../../src/l1/types.js'
import { isInternalAddress } from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'
import { L2Registry } from '../../src/l2/registry.js'
import type { Operation } from '../../src/l2/operation.js'

describe('A7: execute_op primitive（双区架构版）', () => {
  let mockL2: MockL2
  let state: ExecutionState

  beforeEach(() => {
    mockL2 = createMockL2()
    const l3 = createMockL3([])
    state = createInitialState(mockL2.registry, l3)
  })

  // ============== 基本调用 ==============
  describe('基本调用', () => {
    test('调用 mock_op：x → x*2', async () => {
      // 准备 input
      state.internalStore.set('$r0', 5)

      const entry = createOpEntry('mock_op', { x: '$r0' }, { result: '$r1' })
      state.stack.push(entry)

      await executeOp(entry, state)

      // result 应写入 $r1
      expect(state.internalStore.get('$r1')).toBe(10)

      // tracker 应记录调用
      expect(mockL2.tracker.getCallCount()).toBe(1)
      expect(mockL2.tracker.getCalls()[0].op).toBe('mock_op')
      expect(mockL2.tracker.getCalls()[0].inputs).toEqual({ x: 5 })

      // entry 状态
      expect(entry.status).toBe('done')
      expect(state.stack.length).toBe(0)  // pop
    })

    test('调用 throwing_op 应抛错（硬错误）', async () => {
      const entry = createOpEntry('throwing_op', {}, {})
      state.stack.push(entry)

      // throwing_op 总是 throw
      await expect(executeOp(entry, state)).rejects.toThrow('hard error')

      // entry 状态：应保持 'pending'（因为 hard error 在 status='running' 时抛出）
      // 实际上 entry.status 在 step 3 设置为 'running'，然后 op throw
      // 在我们当前实现中，entry.status = 'error' 应该在 catch 块中设置
      // 但当前实现没有 catch（让 main loop 处理）
      // 所以 entry.status 保持 'running'（不算 done 也不算 pending）
      // 这是设计选择：status='running' 表明"正在执行但未完成"
      expect(entry.status).toBe('running')

      // 栈不应 pop（硬错误时不清理）
      expect(state.stack.length).toBe(1)
    })

    test('多个 inputs', async () => {
      // 创建一个接受 2 个 input 的可编程 mock
      const doubleOp = createProgrammableOp({
        name: 'double_add',
        formalSpec: {
          inputs: {
            a: { businessName: 'a', register: '$r0', type: 'number', required: true },
            b: { businessName: 'b', register: '$r1', type: 'number', required: true }
          },
          outputs: {
            sum: { businessName: 'sum', register: '$r2', type: 'number', required: true }
          }
        },
        behavior: { kind: 'return', outputs: { sum: 99 } }
      }, mockL2.tracker)

      const customRegistry = new L2Registry()
      customRegistry.register(doubleOp)

      const customState = createInitialState(customRegistry, createMockL3([]))
      customState.internalStore.set('$r0', 10)
      customState.internalStore.set('$r1', 20)

      const entry: OpEntry = {
        id: 'op1', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'double_add',
        inputs: {
          a: { kind: 'internal', name: '$r0' },
          b: { kind: 'internal', name: '$r1' }
        },
        outputs: { sum: { kind: 'internal', name: '$r2' } },
        status: 'pending'
      }
      customState.stack.push(entry)

      await executeOp(entry, customState)

      expect(customState.internalStore.get('$r2')).toBe(99)
      expect(entry.status).toBe('done')
    })

    test('多个 outputs', async () => {
      const multiOutOp = createProgrammableOp({
        name: 'multi_out',
        formalSpec: {
          inputs: { x: { businessName: 'x', register: '$r0', type: 'number', required: true } },
          outputs: {
            out1: { businessName: 'out1', register: '$r1', type: 'number', required: true },
            out2: { businessName: 'out2', register: '$r2', type: 'number', required: true }
          }
        },
        behavior: { kind: 'return', outputs: { out1: 100, out2: 200 } }
      }, mockL2.tracker)

      const customRegistry = new L2Registry()
      customRegistry.register(multiOutOp)
      const customState = createInitialState(customRegistry, createMockL3([]))
      customState.internalStore.set('$r0', 5)

      const entry: OpEntry = {
        id: 'op1', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'multi_out',
        inputs: { x: { kind: 'internal', name: '$r0' } },
        outputs: {
          out1: { kind: 'internal', name: '$r1' },
          out2: { kind: 'internal', name: '$r2' }
        },
        status: 'pending'
      }
      customState.stack.push(entry)

      await executeOp(entry, customState)

      expect(customState.internalStore.get('$r1')).toBe(100)
      expect(customState.internalStore.get('$r2')).toBe(200)
    })
  })

  // ============== 双区架构约束 ==============
  describe('inputs 必须是 internal', () => {
    test('literal input 抛 ExecuteOpError', async () => {
      const entry: OpEntry = {
        id: 'op1', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'mock_op',
        inputs: { x: { kind: 'literal', value: 5 } as any },  // 故意传错
        outputs: { result: { kind: 'internal', name: '$r1' } },
        status: 'pending'
      }
      state.stack.push(entry)

      await expect(executeOp(entry, state)).rejects.toThrow(ExecuteOpError)
      await expect(executeOp(entry, state)).rejects.toThrow(/input 'x' must be internal/)
    })

    test('public input 抛错', async () => {
      const entry: OpEntry = {
        id: 'op1', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'mock_op',
        inputs: { x: { kind: 'public', name: 'business_var' } as any },
        outputs: { result: { kind: 'internal', name: '$r1' } },
        status: 'pending'
      }
      state.stack.push(entry)

      await expect(executeOp(entry, state)).rejects.toThrow(ExecuteOpError)
    })

    test('file input 抛错', async () => {
      const entry: OpEntry = {
        id: 'op1', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'mock_op',
        inputs: { x: { kind: 'file', path: '/tmp/x' } as any },
        outputs: { result: { kind: 'internal', name: '$r1' } },
        status: 'pending'
      }
      state.stack.push(entry)

      await expect(executeOp(entry, state)).rejects.toThrow(ExecuteOpError)
    })
  })

  describe('outputs 必须是 internal', () => {
    test('literal output 抛 ExecuteOpError', async () => {
      state.internalStore.set('$r0', 5)
      const entry: OpEntry = {
        id: 'op1', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'mock_op',
        inputs: { x: { kind: 'internal', name: '$r0' } },
        outputs: { result: { kind: 'literal', value: 0 } as any },  // 故意
        status: 'pending'
      }
      state.stack.push(entry)

      await expect(executeOp(entry, state)).rejects.toThrow(ExecuteOpError)
      await expect(executeOp(entry, state)).rejects.toThrow(/output 'result' must be internal/)
    })

    test('public output 抛错', async () => {
      state.internalStore.set('$r0', 5)
      const entry: OpEntry = {
        id: 'op1', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'mock_op',
        inputs: { x: { kind: 'internal', name: '$r0' } },
        outputs: { result: { kind: 'public', name: 'business_var' } as any },
        status: 'pending'
      }
      state.stack.push(entry)

      await expect(executeOp(entry, state)).rejects.toThrow(ExecuteOpError)
    })
  })

  // ============== op 注册 ==============
  describe('op 注册', () => {
    test('未注册的 op 抛 ExecuteOpError', async () => {
      const entry = createOpEntry('nonexistent_op', {}, {})
      state.stack.push(entry)

      await expect(executeOp(entry, state)).rejects.toThrow(ExecuteOpError)
      await expect(executeOp(entry, state)).rejects.toThrow(/not registered/)
    })

    test('throwing_op 在 registry 中能找到', () => {
      // sanity check：throwing_op 已注册
      expect(state.l2.has('throwing_op')).toBe(true)
      expect(state.l2.has('mock_op')).toBe(true)
    })
  })

  // ============== 已知错误路径 ==============
  describe('已知错误路径（op 返回 OperationError）', () => {
    test('op 返回 error → 写入 $r_err 寄存器', async () => {
      // 创建可返回错误的 mock
      const errorOp = createProgrammableOp({
        name: 'failing_op',
        formalSpec: {
          inputs: { x: { businessName: 'x', register: '$r0', type: 'number', required: true } },
          outputs: {
            result: { businessName: 'result', register: '$r1', type: 'number', required: false },
            error: { businessName: 'error', register: '$r_err', type: 'object', required: false }
          }
        },
        behavior: { kind: 'returnError', code: 'ENOENT', message: 'file not found' }
      }, mockL2.tracker)

      const customRegistry = new L2Registry()
      customRegistry.register(errorOp)
      const customState = createInitialState(customRegistry, createMockL3([]))
      customState.internalStore.set('$r0', 5)

      const entry: OpEntry = {
        id: 'op1', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'failing_op',
        inputs: { x: { kind: 'internal', name: '$r0' } },
        outputs: {
          result: { kind: 'internal', name: '$r1' },
          error: { kind: 'internal', name: '$r_err' }
        },
        status: 'pending'
      }
      customState.stack.push(entry)

      // 不应抛错（已知错误作为数据）
      await expect(executeOp(entry, customState)).resolves.not.toThrow()

      // $r_err 应包含 OperationError
      const err = customState.internalStore.get('$r_err')
      expect(err).toBeDefined()
      expect((err as any).code).toBe('ENOENT')
      expect((err as any).op).toBe('failing_op')

      // $r1 应为 null（result 是 null）
      expect(customState.internalStore.get('$r1')).toBeNull()

      // entry status = done（已知错误不中断执行）
      expect(entry.status).toBe('done')
    })

    test('多次执行：$r_err 被后一次 op 覆盖（last-wins）', async () => {
      const errorOp1 = createProgrammableOp({
        name: 'err_op_1',
        formalSpec: {
          inputs: {},
          outputs: { error: { businessName: 'error', register: '$r_err', type: 'object', required: false } }
        },
        behavior: { kind: 'returnError', code: 'E_FIRST' }
      }, mockL2.tracker)

      const errorOp2 = createProgrammableOp({
        name: 'err_op_2',
        formalSpec: {
          inputs: {},
          outputs: { error: { businessName: 'error', register: '$r_err', type: 'object', required: false } }
        },
        behavior: { kind: 'returnError', code: 'E_SECOND' }
      }, mockL2.tracker)

      const customRegistry = new L2Registry()
      customRegistry.register(errorOp1)
      customRegistry.register(errorOp2)
      const customState = createInitialState(customRegistry, createMockL3([]))

      const entry1: OpEntry = {
        id: 'op1', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'err_op_1',
        inputs: {},
        outputs: { error: { kind: 'internal', name: '$r_err' } },
        status: 'pending'
      }
      const entry2: OpEntry = {
        id: 'op2', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'err_op_2',
        inputs: {},
        outputs: { error: { kind: 'internal', name: '$r_err' } },
        status: 'pending'
      }

      customState.stack.push(entry1)
      await executeOp(entry1, customState)
      expect((customState.internalStore.get('$r_err') as any).code).toBe('E_FIRST')

      customState.stack.push(entry2)
      await executeOp(entry2, customState)
      // 第二次覆盖了 $r_err
      expect((customState.internalStore.get('$r_err') as any).code).toBe('E_SECOND')
    })
  })

  // ============== 硬错误路径 ==============
  describe('硬错误路径（op throw）', () => {
    test('op throw 时向上抛（不写入 outputs）', async () => {
      // throwing_op 总是 throw
      const entry = createOpEntry('throwing_op', {}, { result: '$r1' })
      state.stack.push(entry)

      await expect(executeOp(entry, state)).rejects.toThrow(/hard error/)

      // outputs 不应写入（throw 在 execute 阶段，未到 write 阶段）
      expect(state.internalStore.has('$r1')).toBe(false)
    })

    test('自定义 throw 的 Error 向上抛', async () => {
      const customThrow = createProgrammableOp({
        name: 'custom_throw',
        formalSpec: { inputs: {}, outputs: {} },
        behavior: { kind: 'throw', error: new Error('custom hard error') }
      }, mockL2.tracker)

      const customRegistry = new L2Registry()
      customRegistry.register(customThrow)
      const customState = createInitialState(customRegistry, createMockL3([]))

      const entry: OpEntry = {
        id: 'op1', parentIntentId: null, createdAt: 0,
        kind: 'execute_op',
        operation: 'custom_throw',
        inputs: {},
        outputs: {},
        status: 'pending'
      }
      customState.stack.push(entry)

      await expect(executeOp(entry, customState)).rejects.toThrow('custom hard error')
    })
  })

  // ============== entry.status 生命周期 ==============
  describe('entry.status 生命周期', () => {
    test('成功：pending → running → done', async () => {
      state.internalStore.set('$r0', 5)
      const entry = createOpEntry('mock_op', { x: '$r0' }, { result: '$r1' })
      state.stack.push(entry)

      expect(entry.status).toBe('pending')

      await executeOp(entry, state)

      expect(entry.status).toBe('done')
    })

    test('硬错误：pending → running（保持，因为 throw 后未到 done）', async () => {
      const entry = createOpEntry('throwing_op', {}, {})
      state.stack.push(entry)

      expect(entry.status).toBe('pending')

      try {
        await executeOp(entry, state)
      } catch { /* 预期抛错 */ }

      // status 是 'running'，因为在 catch 之前已设置为 running
      expect(entry.status).toBe('running')
    })
  })

  // ============== 与 move 配合 ==============
  describe('与 move 配合（literal → internal → op）', () => {
    test('完整流程：literal 5 → move → $r0 → mock_op → $r1', async () => {
      // 模拟：先用 move 把 literal 5 写到 $r0（这里直接设置，因为测试不模拟 main loop）
      state.internalStore.set('$r0', 5)

      const entry = createOpEntry('mock_op', { x: '$r0' }, { result: '$r1' })
      state.stack.push(entry)

      await executeOp(entry, state)

      expect(state.internalStore.get('$r1')).toBe(10)
    })

    test('后续可读 op 的 output 做下一轮 op 的 input', async () => {
      // round 1: 5 → $r1 = 10
      state.internalStore.set('$r0', 5)
      const op1 = createOpEntry('mock_op', { x: '$r0' }, { result: '$r1' })
      state.stack.push(op1)
      await executeOp(op1, state)
      expect(state.internalStore.get('$r1')).toBe(10)

      // round 2: 10 → $r3 = 20 (使用 round 1 的 output 作为 input)
      const op2 = createOpEntry('mock_op', { x: '$r1' }, { result: '$r3' })
      state.stack.push(op2)
      await executeOp(op2, state)
      expect(state.internalStore.get('$r3')).toBe(20)
    })
  })

  // ============== 多次调用 / tracker ==============
  describe('多次调用', () => {
    test('连续 3 次调用同一 op', async () => {
      for (let i = 1; i <= 3; i++) {
        state.internalStore.set('$r0', i)
        const entry = createOpEntry('mock_op', { x: '$r0' }, { result: `$r${i + 1}` })
        state.stack.push(entry)
        await executeOp(entry, state)
      }

      expect(mockL2.tracker.getCallCount()).toBe(3)
      expect(state.internalStore.get('$r2')).toBe(2)   // 1*2
      expect(state.internalStore.get('$r3')).toBe(4)   // 2*2
      expect(state.internalStore.get('$r4')).toBe(6)   // 3*2
    })

    test('tracker 记录每个调用的 inputs', async () => {
      const entries = [
        { input: 10, reg: '$r0', outReg: '$r2' },
        { input: 20, reg: '$r0', outReg: '$r3' },
        { input: 30, reg: '$r0', outReg: '$r4' }
      ]

      for (const { input, reg, outReg } of entries) {
        state.internalStore.set(reg, input)
        const entry = createOpEntry('mock_op', { x: reg }, { result: outReg })
        state.stack.push(entry)
        await executeOp(entry, state)
      }

      const calls = mockL2.tracker.getCalls()
      expect(calls).toHaveLength(3)
      expect(calls[0].inputs.x).toBe(10)
      expect(calls[1].inputs.x).toBe(20)
      expect(calls[2].inputs.x).toBe(30)
    })
  })

  // ============== 状态保留 ==============
  describe('状态保留', () => {
    test('不动 publicStore', async () => {
      state.publicStore.set('business_data', 'preserve')
      state.internalStore.set('$r0', 5)
      const entry = createOpEntry('mock_op', { x: '$r0' }, { result: '$r1' })
      state.stack.push(entry)

      await executeOp(entry, state)

      expect(state.publicStore.get('business_data')).toBe('preserve')
    })

    test('不动 allocator', async () => {
      state.allocator.allocate()
      state.allocator.allocate()
      const before = state.allocator.maxAllocated()

      state.internalStore.set('$r0', 5)
      const entry = createOpEntry('mock_op', { x: '$r0' }, { result: '$r1' })
      state.stack.push(entry)

      await executeOp(entry, state)

      expect(state.allocator.maxAllocated()).toBe(before)
    })

    test('不动其他内部寄存器', async () => {
      state.internalStore.set('$r_other', 'preserve')
      state.internalStore.set('$r0', 5)
      const entry = createOpEntry('mock_op', { x: '$r0' }, { result: '$r1' })
      state.stack.push(entry)

      await executeOp(entry, state)

      expect(state.internalStore.get('$r_other')).toBe('preserve')
    })
  })

  // ============== ExecuteOpError ==============
  describe('ExecuteOpError', () => {
    test('是 Error 子类', () => {
      const err = new ExecuteOpError('test')
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('ExecuteOpError')
      expect(err.message).toBe('test')
    })
  })
})

// ============== Helpers ==============

/**
 * 创建一个 OpEntry（简化测试代码）
 */
function createOpEntry(
  operation: string,
  inputs: Record<string, string>,
  outputs: Record<string, string>
): OpEntry {
  const inputAddrs: Record<string, Address> = {}
  for (const [name, reg] of Object.entries(inputs)) {
    inputAddrs[name] = { kind: 'internal', name: reg }
  }

  const outputAddrs: Record<string, Address> = {}
  for (const [name, reg] of Object.entries(outputs)) {
    outputAddrs[name] = { kind: 'internal', name: reg }
  }

  return {
    id: generateId('op'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'execute_op',
    operation,
    inputs: inputAddrs,
    outputs: outputAddrs,
    status: 'pending'
  }
}