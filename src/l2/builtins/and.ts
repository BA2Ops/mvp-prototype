/**
 * L2 and / or / not operations（条件计算 op 族 - 基础）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2.1
 *
 * 设计（2026-08-20）：
 * - and/or：多操作数 list<boolean>，短路语义（第一个 falsy / truthy 决定结果）
 * - not：单操作数 boolean 取反
 *
 * 测试：tests/phase-b/tier-b06-conditional-ops.test.ts
 */

import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

export const andOp: Operation = {
  name: 'and',
  description: '逻辑与（二元）',

  formalSpec: {
    inputs: {
      a: { businessName: 'a', register: '$r0', type: 'any', required: true, description: '左值' },
      b: { businessName: 'b', register: '$r1', type: 'any', required: true, description: '右值' }
    },
    outputs: {
      result: { businessName: 'result', register: '$r2', type: 'boolean', required: true, description: 'a && b（短路）' },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false, description: '错误信息' }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const a = inputs.a
    const b = inputs.b
    // 短路：a falsy 直接返 false
    return { result: Boolean(a) && Boolean(b), error: null }
  }
}

export const orOp: Operation = {
  name: 'or',
  description: '逻辑或（二元）',

  formalSpec: {
    inputs: {
      a: { businessName: 'a', register: '$r0', type: 'any', required: true, description: '左值' },
      b: { businessName: 'b', register: '$r1', type: 'any', required: true, description: '右值' }
    },
    outputs: {
      result: { businessName: 'result', register: '$r2', type: 'boolean', required: true, description: 'a || b（短路）' },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false, description: '错误信息' }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    // 短路：a truthy 直接返 true
    return { result: Boolean(inputs.a) || Boolean(inputs.b), error: null }
  }
}

export const notOp: Operation = {
  name: 'not',
  description: '逻辑非',

  formalSpec: {
    inputs: {
      value: { businessName: 'value', register: '$r0', type: 'any', required: true, description: '输入值' }
    },
    outputs: {
      result: { businessName: 'result', register: '$r1', type: 'boolean', required: true, description: '!value（truthy 取反）' },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false, description: '错误信息' }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    return { result: !inputs.value, error: null }
  }
}