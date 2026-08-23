/**
 * Mock L2 Operations（双区架构版）
 *
 * @see ../../docs/mvp/11-prototype-implementation-plan.md §Phase A
 * @see ../../docs/mvp/06-execution-layer.md §7.2.1
 *
 * 为 L1 单元测试提供可编程的 L2 operation mock。
 *
 * 设计：
 * - mock_op 使用 formalSpec 声明形参
 * - throwing_op 模拟硬错误（throw Error）
 * - programmableOp() 工厂创建可定制行为的 mock
 * - 所有 mock 都遵守 Operation 接口（含 formalSpec）
 */

import type { Operation, OperationFormalSpec } from '../l2/operation.js'
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

// ============== Programmable Mock ==============

/**
 * 可编程 mock 的行为配置
 */
export type MockBehavior =
  /** 返回成功结果 */
  | { kind: 'return'; outputs: Record<string, Value> }
  /** 返回已知错误（OperationError，写入 error 输出）*/
  | { kind: 'returnError'; code: string; message?: string }
  /** 抛出硬错误（让 L1 捕获并向上传播）*/
  | { kind: 'throw'; error: Error }

/**
 * 可编程 mock op 的配置
 */
export interface ProgrammableMockConfig {
  /** op 名称 */
  name: string
  /** 形参定义 */
  formalSpec: OperationFormalSpec
  /** 行为配置（返回 / 返回错误 / 抛错）*/
  behavior: MockBehavior
}

/**
 * 创建可编程 mock operation
 *
 * 每个调用都会：
 * 1. 记录到 tracker
 * 2. 根据 behavior 决定行为：
 *    - 'return': 返回 outputs
 *    - 'returnError': 返回 { ..., error: OperationError }
 *    - 'throw': 抛出 error
 *
 * 用于 A7+ 测试各种 L2 op 行为路径。
 */
export function createProgrammableOp(
  config: ProgrammableMockConfig,
  tracker: MockOpTracker
): Operation {
  return {
    name: config.name,
    description: `Programmable mock op: ${config.name}`,
    formalSpec: config.formalSpec,
    execute: async (inputs: Record<string, Value>) => {
      tracker.record(config.name, inputs)

      switch (config.behavior.kind) {
        case 'return':
          return config.behavior.outputs

        case 'returnError': {
          // 返回错误模式：除 error 输出外，其他 outputs 设为 null/undefined
          const outputs: Record<string, Value> = {}
          for (const key of Object.keys(config.formalSpec.outputs)) {
            if (key === 'error') {
              outputs[key] = {
                code: config.behavior.code,
                message: config.behavior.message ?? `Error from ${config.name}`,
                op: config.name,
                timestamp: Date.now()
              }
            } else {
              outputs[key] = null
            }
          }
          return outputs
        }

        case 'throw':
          throw config.behavior.error
      }
    }
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
 * - mock_op：x → x*2（使用 formalSpec，x=$r0, result=$r1）
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
          slotIndex: 0,
          type: 'number',
          required: true,
          description: 'input number'
        }
      },
      outputs: {
        result: {
          businessName: 'result',
          register: '$r1',
          slotIndex: 1,
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

  // throwing_op: 总是抛错
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