/**
 * L2 gte / lte operations（条件计算 op 族 - 高频扩展）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2.1
 * @see ../../docs/mvp/10-reactive-execution-model.md §6.5（循环模式 check_max = gte($count, max)）
 *
 * 设计（2026-08-20）：
 * - 高频 op，单独实现（也可由 not+lt 组合）
 * - 大于等于 / 小于等于
 *
 * 测试：tests/phase-b/tier-b06-conditional-ops.test.ts
 */

import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

export const gteOp: Operation = {
  name: 'gte',
  description: '大于等于（>=）',

  formalSpec: {
    inputs: {
      a: { businessName: 'a', register: '$r0', type: 'any', required: true, description: '左值' },
      b: { businessName: 'b', register: '$r1', type: 'any', required: true, description: '右值' }
    },
    outputs: {
      result: { businessName: 'result', register: '$r2', type: 'boolean', required: true, description: 'a >= b' },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false, description: '错误信息' }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const a = inputs.a
    const b = inputs.b

    if (typeof a === 'number' && typeof b === 'number') {
      return { result: a >= b, error: null }
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return { result: a >= b, error: null }
    }
    return {
      result: false,
      error: createOperationError(
        'INVALID_INPUT',
        `gte requires both args to be number or string`,
        'gte'
      ) as unknown as Value
    }
  }
}

export const lteOp: Operation = {
  name: 'lte',
  description: '小于等于（<=）',

  formalSpec: {
    inputs: {
      a: { businessName: 'a', register: '$r0', type: 'any', required: true, description: '左值' },
      b: { businessName: 'b', register: '$r1', type: 'any', required: true, description: '右值' }
    },
    outputs: {
      result: { businessName: 'result', register: '$r2', type: 'boolean', required: true, description: 'a <= b' },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false, description: '错误信息' }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const a = inputs.a
    const b = inputs.b

    if (typeof a === 'number' && typeof b === 'number') {
      return { result: a <= b, error: null }
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return { result: a <= b, error: null }
    }
    return {
      result: false,
      error: createOperationError(
        'INVALID_INPUT',
        `lte requires both args to be number or string`,
        'lte'
      ) as unknown as Value
    }
  }
}