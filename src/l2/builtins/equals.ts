/**
 * L2 equals operation（条件计算 op 族 - 基础）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2.1（条件计算 op 族）
 * @see ../../docs/mvp/10-reactive-execution-model.md §6.5（循环模式：equals/gte）
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B6
 *
 * 设计（2026-08-20）：
 * - 严格相等比较（=== 语义）
 * - 与 not_equals 互补
 *
 * 测试：tests/phase-b/tier-b06-conditional-ops.test.ts
 */

import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

/**
 * equals op：严格相等比较
 *
 * inputs:
 *   - a: any（required）— 左值
 *   - b: any（required）— 右值
 *
 * outputs:
 *   - result: boolean（required）— a === b
 *   - error: OperationError（optional）
 */
export const equalsOp: Operation = {
  name: 'equals',
  description: '严格相等比较（===）',

  formalSpec: {
    inputs: {
      a: { businessName: 'a', register: '$r0', type: 'any', required: true, description: '左值' },
      b: { businessName: 'b', register: '$r1', type: 'any', required: true, description: '右值' }
    },
    outputs: {
      result: { businessName: 'result', register: '$r2', type: 'boolean', required: true, description: 'a === b' },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false, description: '错误信息' }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const a = inputs.a
    const b = inputs.b
    return { result: a === b, error: null }
  }
}

/**
 * not_equals op：严格不等（= equals 取反）
 */
export const notEqualsOp: Operation = {
  name: 'not_equals',
  description: '严格不等比较（!==）',

  formalSpec: {
    inputs: {
      a: { businessName: 'a', register: '$r0', type: 'any', required: true, description: '左值' },
      b: { businessName: 'b', register: '$r1', type: 'any', required: true, description: '右值' }
    },
    outputs: {
      result: { businessName: 'result', register: '$r2', type: 'boolean', required: true, description: 'a !== b' },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false, description: '错误信息' }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    return { result: inputs.a !== inputs.b, error: null }
  }
}

// 抑制 lint 警告（createOperationError 未来在类型校验时可能用到）
void createOperationError