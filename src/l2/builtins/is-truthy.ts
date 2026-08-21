/**
 * L2 is_truthy / is_empty operations（条件计算 op 族 - 基础）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2.1
 *
 * 设计（2026-08-20）：
 * - is_truthy: JS truthy 判断（非 false / 0 / '' / null / undefined / NaN）
 * - is_empty:
 *   - string: length === 0
 *   - list/array: length === 0
 *   - object: Object.keys().length === 0
 *   - null/undefined: true
 *   - number: false（数字永远非空）
 *
 * 测试：tests/phase-b/tier-b06-conditional-ops.test.ts
 */

import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

export const isTruthyOp: Operation = {
  name: 'is_truthy',
  description: 'truthy 判断（JS truthy/falsy 语义）',

  formalSpec: {
    inputs: {
      value: { businessName: 'value', register: '$r0', type: 'any', required: true, description: '输入值' }
    },
    outputs: {
      result: { businessName: 'result', register: '$r1', type: 'boolean', required: true, description: 'truthy?' },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false, description: '错误信息' }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    return { result: Boolean(inputs.value), error: null }
  }
}

export const isEmptyOp: Operation = {
  name: 'is_empty',
  description: '空值判断（string/list/object）',

  formalSpec: {
    inputs: {
      value: { businessName: 'value', register: '$r0', type: 'any', required: true, description: '输入值' }
    },
    outputs: {
      result: { businessName: 'result', register: '$r1', type: 'boolean', required: true, description: '空?' },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false, description: '错误信息' }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const v = inputs.value
    let empty = false
    if (v === null || v === undefined) {
      empty = true
    } else if (typeof v === 'string' || Array.isArray(v)) {
      empty = (v as unknown[]).length === 0
    } else if (typeof v === 'object') {
      empty = Object.keys(v as object).length === 0
    } else {
      // number / boolean：永不为空（但 is_empty 仍可工作）
      empty = false
    }
    return { result: empty, error: null }
  }
}

void createOperationError