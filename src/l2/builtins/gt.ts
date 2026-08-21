/**
 * L2 gt operation（条件计算 op 族 - 基础）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2.1
 *
 * 设计（2026-08-20）：
 * - 严格大于（> 语义）
 * - 仅当两值都是数字或都是字符串时给出明确语义
 *
 * 测试：tests/phase-b/tier-b06-conditional-ops.test.ts
 */

import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

/**
 * gt op：严格大于
 *
 * inputs:
 *   - a: number | string（required）— 左值
 *   - b: number | string（required）— 右值
 *
 * outputs:
 *   - result: boolean（required）— a > b
 *   - error: OperationError（optional）
 */
export const gtOp: Operation = {
  name: 'gt',
  description: '严格大于比较',

  formalSpec: {
    inputs: {
      a: { businessName: 'a', register: '$r0', type: 'any', required: true, description: '左值' },
      b: { businessName: 'b', register: '$r1', type: 'any', required: true, description: '右值' }
    },
    outputs: {
      result: { businessName: 'result', register: '$r2', type: 'boolean', required: true, description: 'a > b' },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false, description: '错误信息' }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const a = inputs.a
    const b = inputs.b

    if (typeof a === 'number' && typeof b === 'number') {
      return { result: a > b, error: null }
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return { result: a > b, error: null }
    }
    return {
      result: false,
      error: createOperationError(
        'INVALID_INPUT',
        `gt requires both args to be number or string, got ${typeof a}, ${typeof b}`,
        'gt'
      ) as unknown as Value
    }
  }
}

/**
 * lt op：严格小于
 */
export const ltOp: Operation = {
  name: 'lt',
  description: '严格小于比较',

  formalSpec: {
    inputs: {
      a: { businessName: 'a', register: '$r0', type: 'any', required: true, description: '左值' },
      b: { businessName: 'b', register: '$r1', type: 'any', required: true, description: '右值' }
    },
    outputs: {
      result: { businessName: 'result', register: '$r2', type: 'boolean', required: true, description: 'a < b' },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false, description: '错误信息' }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const a = inputs.a
    const b = inputs.b

    if (typeof a === 'number' && typeof b === 'number') {
      return { result: a < b, error: null }
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return { result: a < b, error: null }
    }
    return {
      result: false,
      /* v8 ignore next 4 -- 防御代码：lt INVALID_INPUT 分支（与 gt 类似） */
      error: createOperationError(
        'INVALID_INPUT',
        `lt requires both args to be number or string, got ${typeof a}, ${typeof b}`,
        'lt'
      ) as unknown as Value
    }
  }
}

void createOperationError