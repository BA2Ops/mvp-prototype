/**
 * Mock L2 Operations
 *
 * @see ../../docs/mvp/11-prototype-implementation-plan.md §Phase A
 *
 * 为 L1 单元测试提供可编程的 L2 operation mock。
 *
 * 设计原则：
 * - 不模拟真实业务逻辑（那是 Phase B 的事）
 * - 提供最小的可观测能力（call tracking）
 * - 支持硬错误模拟（throwing_op）
 */

import type { Operation } from '../l2/operation.js'
import type { Value } from '../l1/types.js'
import { L2Registry } from '../l2/registry.js'

// ============== MockOpTracker ==============

/**
 * 追踪 L1 对 mock operation 的所有调用
 *
 * 用途：
 * - 验证 L1 调用了几次
 * - 验证 L1 传递了什么参数
 * - 验证 L1 调用顺序
 */
export class MockOpTracker {
  private calls: Array<{ op: string; inputs: Record<string, Value> }> = []

  record(op: string, inputs: Record<string, Value>): void {
    this.calls.push({ op, inputs })
  }

  getCalls(): Array<{ op: string; inputs: Record<string, Value> }> {
    return [...this.calls]
  }

  getCallCount(): number {
    return this.calls.length
  }

  reset(): void {
    this.calls = []
  }
}

// ============== Mock Operation Factories ==============

/**
 * 创建一个可编程的 mock L2 registry
 *
 * 内置 2 种 mock operation：
 * - mock_op：x → x*2（用于测试基本数据流）
 * - throwing_op：总是抛错（用于测试硬错误传播）
 */
export interface MockL2 {
  registry: L2Registry
  tracker: MockOpTracker
  ops: {
    mock_op: Operation
    throwing_op: Operation
  }
}

export function createMockL2(): MockL2 {
  const tracker = new MockOpTracker()
  const registry = new L2Registry()

  // mock_op: x → x * 2
  const mockOp: Operation = {
    name: 'mock_op',
    description: 'Mock op: doubles input x',
    inputs: { x: { type: 'number', required: true } },
    outputs: { result: { type: 'number', required: true } },
    execute: async (inputs: Record<string, Value>) => {
      tracker.record('mock_op', inputs)
      return { result: (inputs.x as number) * 2 }
    }
  }

  // throwing_op: 总是抛错（用于硬错误测试）
  const throwingOp: Operation = {
    name: 'throwing_op',
    description: 'Mock op: always throws',
    inputs: {},
    outputs: {},
    execute: async () => {
      tracker.record('throwing_op', {})
      throw new Error('mock_throw: hard error from throwing_op')
    }
  }

  registry.register(mockOp)
  registry.register(throwingOp)

  return {
    registry,
    tracker,
    ops: {
      mock_op: mockOp,
      throwing_op: throwingOp
    }
  }
}