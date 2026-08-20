/**
 * 演示：手动调用 L2（双区架构版）
 *
 * 展示：
 * 1. 直接调用 mock L2 op（模拟 file_read）
 * 2. 把结果集成到 internalStore（寄存器）
 * 3. 与 executeMove 集成跨区
 *
 * 注意：真实 file_read 在 Phase B1 实现。
 */

import { describe, test, expect } from 'vitest'
import { createMockL2 } from '../../src/mocks/mock-l2.js'
import { createMockL3 } from '../../src/mocks/mock-l3.js'
import {
  createInitialState,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { resolveAddress, writeAddress } from '../../src/l1/address-resolver.js'
import { executeMove } from '../../src/l1/primitives/move.js'

describe('演示：手动调用 L2 + 集成到 state（双区架构版）', () => {
  test('演示 1：直接调用 mock_op', async () => {
    const { ops: l2Ops, tracker } = createMockL2()

    const result = await l2Ops.mock_op.execute({ x: 100 })

    expect(result).toEqual({ result: 200 })
    expect(tracker.getCallCount()).toBe(1)
  })

  test('演示 2：手动调用 + 写入 internalStore', async () => {
    const { registry: l2, ops: l2Ops } = createMockL2()
    const l3 = createMockL3([])
    const state = createInitialState(l2, l3)

    // 1. 手动调 L2
    const result = await l2Ops.mock_op.execute({ x: 100 })

    // 2. 写入 internalStore（双区架构：$r1 是 register）
    await writeAddress(
      { kind: 'internal', name: '$r1' }, // mock_op formalSpec.outputs.result.register
      result.result,
      state
    )

    expect(state.internalStore.get('$r1')).toBe(200)
  })

  test('演示 3：完整流程（手动模拟 main loop）', async () => {
    const { registry: l2, ops: l2Ops, tracker } = createMockL2()
    const l3 = createMockL3([])
    const state = createInitialState(l2, l3)

    // === 步骤 1: 手动构造 OpEntry ===
    // mock_op formalSpec: input x → $r0, output result → $r1
    const opEntry = {
      id: 'op1',
      parentIntentId: null,
      createdAt: 0,
      kind: 'execute_op' as const,
      operation: 'mock_op',
      inputs: { x: { kind: 'internal' as const, name: '$r0' } },
      outputs: { result: { kind: 'internal' as const, name: '$r1' } },
      status: 'pending' as const
    }

    // === 步骤 2: 模拟执行 ===
    // 1. 准备输入（move: literal → $r0）
    await executeMove({
      id: 'm1', parentIntentId: null, createdAt: 0,
      kind: 'move',
      from: { kind: 'literal', value: 100 },
      to: { kind: 'internal', name: '$r0' }
    }, state)

    // 2. 解析 inputs（从 internalStore）
    const resolvedInputs: Record<string, any> = {}
    for (const [key, addr] of Object.entries(opEntry.inputs)) {
      resolvedInputs[key] = await resolveAddress(addr, state)
    }

    // 3. 调用 L2
    const outputs = await l2Ops[opEntry.operation].execute(resolvedInputs)

    // 4. 写入 outputs（到 internalStore）
    for (const [key, value] of Object.entries(outputs)) {
      const outAddr = opEntry.outputs[key]
      await writeAddress(outAddr, value, state)
    }

    // === 验证 ===
    expect(state.internalStore.get('$r0')).toBe(100)  // input
    expect(state.internalStore.get('$r1')).toBe(200)  // output
    expect(tracker.getCallCount()).toBe(1)
  })

  test('演示 4：与 executeMove 集成（内部→公共）', async () => {
    const { registry: l2, ops: l2Ops } = createMockL2()
    const l3 = createMockL3([])
    const state = createInitialState(l2, l3)

    // 1. 调 L2
    const result = await l2Ops.mock_op.execute({ x: 100 })

    // 2. 写入 $r1（output register）
    await writeAddress(
      { kind: 'internal', name: '$r1' },
      result.result,
      state
    )

    // 3. move: $r1 → public（保存到业务）
    await executeMove({
      id: 'm2', parentIntentId: null, createdAt: 0,
      kind: 'move',
      from: { kind: 'internal', name: '$r1' },
      to: { kind: 'public', name: 'output_content' }
    }, state)

    expect(state.internalStore.get('$r1')).toBe(200)
    expect(state.publicStore.get('output_content')).toBe(200)
  })

  test('演示 5：throwing_op 模拟硬错误', async () => {
    const { ops: l2Ops, tracker } = createMockL2()

    let caughtError: Error | undefined
    try {
      await l2Ops.throwing_op.execute({})
    } catch (err) {
      caughtError = err as Error
    }

    expect(caughtError).toBeDefined()
    expect(caughtError!.message).toContain('hard error')
    expect(tracker.getCallCount()).toBe(1)
  })
})