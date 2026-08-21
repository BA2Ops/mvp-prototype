/**
 * L2 decrement_counter operation（真实实现）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B5
 *
 * 设计（2026-08-20）：
 * - 单纯 -1，返回新值
 * - 与 increment_counter 对称
 *
 * 测试：tests/phase-b/tier-b05-data-processing.test.ts
 */

import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

/**
 * decrement_counter op：计数器 -1
 *
 * inputs:
 *   - value: number（required）— 当前值
 *
 * outputs:
 *   - new_value: number（required）— 当前值 - 1
 *   - error: OperationError（optional）
 */
export const decrementCounterOp: Operation = {
  name: 'decrement_counter',
  description: '计数器 -1，返回新值',

  formalSpec: {
    inputs: {
      value: {
        businessName: 'value',
        register: '$r0',
        type: 'number',
        required: true,
        description: '当前计数'
      }
    },
    outputs: {
      new_value: {
        businessName: 'new_value',
        register: '$r1',
        type: 'number',
        required: true,
        description: '当前值 - 1'
      },
      error: {
        businessName: 'error',
        register: '$r_err',
        type: 'object',
        required: false,
        description: '错误信息'
      }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const value = inputs.value

    if (typeof value !== 'number' || Number.isNaN(value)) {
      return {
        new_value: 0,
        error: createOperationError(
          'INVALID_INPUT',
          `value must be a number, got ${typeof value}`,
          'decrement_counter'
        ) as unknown as Value
      }
    }

    return { new_value: value - 1, error: null }
  }
}