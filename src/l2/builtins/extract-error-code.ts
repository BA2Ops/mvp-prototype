/**
 * L2 extract_error_code operation（条件计算 op 族 - 基础）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2.1
 *
 * 设计（2026-08-20）：
 * - 输入：OperationError 对象或 null
 * - 输出：error.code 字符串；null 时返回 null；非法对象返回 null
 *
 * 用途：
 * - L3 编译 conditional_judgment.trigger 时需要从 $r_err 取 code 判断
 *
 * 测试：tests/phase-b/tier-b06-conditional-ops.test.ts
 */

import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

export const extractErrorCodeOp: Operation = {
  name: 'extract_error_code',
  description: '从 OperationError 取 code 字段',

  formalSpec: {
    inputs: {
      error_obj: {
        businessName: 'error_obj',
        register: '$r0',
        type: 'any',
        required: true,
        description: 'OperationError 对象或 null'
      }
    },
    outputs: {
      code: {
        businessName: 'code',
        register: '$r1',
        type: 'string',
        required: true,
        description: 'error.code；非 OperationError 时返回 null'
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
    const err = inputs.error_obj

    if (err === null || err === undefined) {
      return { code: null, error: null }
    }

    if (typeof err === 'object' && 'code' in (err as object)) {
      const code = (err as { code: unknown }).code
      return {
        code: typeof code === 'string' ? code : null,
        error: null
      }
    }

    return { code: null, error: null }
  }
}

void createOperationError