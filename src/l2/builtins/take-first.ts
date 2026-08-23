/**
 * L2 take_first operation（真实实现）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B5
 *
 * 设计（2026-08-20）：
 * - 从列表取前 n 个元素
 * - n <= 0 → 空数组
 * - n > length → 返回全部
 * - 不修改原 items
 *
 * 错误处理：INVALID_INPUT（items 不是数组）数据化
 *
 * 测试：tests/phase-b/tier-b05-data-processing.test.ts
 */

import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

/**
 * take_first op：取列表前 n 个元素
 *
 * inputs:
 *   - items: list<any>（required）— 输入列表
 *   - n: number（optional, default 1）— 取前 n 个
 *
 * outputs:
 *   - taken: list<any>（required）— 取出的列表
 *   - count: number（required）— taken 长度
 *   - error: OperationError（optional）
 */
export const takeFirstOp: Operation = {
  name: 'take_first',
  description: '取列表前 n 个元素',

  formalSpec: {
    inputs: {
      items: {
        businessName: 'items',
        register: '$r0', slotIndex: 0,
        type: 'object',  // list<any>
        required: true,
        description: '输入列表'
      },
      n: {
        businessName: 'n',
        register: '$r1', slotIndex: 1,
        type: 'number',
        required: false,
        description: '取前 n 个（默认 1）'
      }
    },
    outputs: {
      taken: {
        businessName: 'taken',
        register: '$r2', slotIndex: 2,
        type: 'object',  // list<any>
        required: true,
        description: '取出的列表'
      },
      count: {
        businessName: 'count',
        register: '$r3', slotIndex: 3,
        type: 'number',
        required: true,
        description: 'taken 长度'
      },
      error: {
        businessName: 'error',
        register: '$r_err', slotIndex: 99,
        type: 'object',
        required: false,
        description: '错误信息'
      }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const items = inputs.items
    const n = (inputs.n as number | undefined) ?? 1

    if (!Array.isArray(items)) {
      return {
        taken: [],
        count: 0,
        error: createOperationError(
          'INVALID_INPUT',
          'items must be an array',
          'take_first'
        ) as unknown as Value
      }
    }

    if (n <= 0) {
      return { taken: [], count: 0, error: null }
    }

    // 不修改原数组
    const taken = items.slice(0, n)
    return { taken, count: taken.length, error: null }
  }
}