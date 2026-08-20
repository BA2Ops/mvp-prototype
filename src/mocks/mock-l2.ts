/**
 * Mock L2 Operations（双区架构版）
 *
 * @see ../../docs/mvp/11-prototype-implementation-plan.md §Phase A
 *
 * 为 L1 单元测试提供可编程的 L2 operation mock。
 *
 * 设计：
 * - mock_op 使用 formalSpec 声明形参
 * - throwing_op 模拟硬错误（throw Error）
 * - 所有 mock 都遵守新 Operation 接口（含 formalSpec）
 */

import type { Operation } from '../l2/operation.js'
import type { Value } from '../l1/types.js'
import { L2Registry } from '../l2/registry.js'

// ============== MockOpTracker ==============
/**
 * 追踪 L1 对 mock operation 的所有调用
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
export interface MockL2 {
  registry: L2Registry
  tracker: MockOpTracker
  ops: {
    mock_op: Operation
    throwing_op: Operation
  }
}

/**
 * 创建一个可编程的 mock L2 registry
 *
 * 内置 2 种 mock operation：
 * - mock_op：x → x*2（使用 formalSpec）
 * - throwing_op：总是抛错（用于硬错误测试）
 */
export function createMockL2(): MockL2 {
  const tracker = new MockOpTracker()
  const registry = new L2Registry()

  // mock_op: x → x*2（含 formalSpec）
  const mockOp: Operation = {
    name: 'mock_op',
    description: 'Mock op: doubles input x',
    formalSpec: {
      inputs: {
        x: {
          businessName: 'x',
          register: '$r0',
          type: 'number',
          required: true,
          description: 'input number'
        }
      },
      outputs: {
        result: {
          businessName: 'result',
          register: '$r1',
          type: 'number',
          required: true,
          description: 'doubled value'
        }
      }
    },
    execute: async (inputs: Record<string, Value>) => {
      tracker.record('mock_op', inputs)
      return { result: (inputs.x as number) * 2 }
    }
  }

  // throwing_op: 总是抛错（无 formalSpec，但保留接口兼容）
  const throwingOp: Operation = {
    name: 'throwing_op',
    description: 'Mock op: always throws',
    formalSpec: {
      inputs: {},
      outputs: {}
    },
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