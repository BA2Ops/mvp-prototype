/**
 * L2 sort_by operation（真实实现）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B5
 *
 * 设计（2026-08-20）：
 * - 按对象的指定字段排序（数字按大小，字符串按字典序，其他类型用 < / >）
 * - desc=true 降序；默认升序
 * - 不修改原 items（创建副本）
 *
 * 错误处理：INVALID_INPUT（items 不是数组）数据化
 *
 * 测试：tests/phase-b/tier-b05-data-processing.test.ts
 */

import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

/**
 * sort_by op：按字段排序列表
 *
 * inputs:
 *   - items: list<object>（required）— 待排序对象列表
 *   - by: string（required）— 排序字段名
 *   - desc: boolean（optional, default false）— 降序
 *
 * outputs:
 *   - sorted: list<object>（required）— 排序后列表
 *   - count: number（required）— 列表长度
 *   - error: OperationError（optional）
 */
export const sortByOp: Operation = {
  name: 'sort_by',
  description: '按字段对对象列表排序',

  formalSpec: {
    inputs: {
      items: {
        businessName: 'items',
        register: '$r0', slotIndex: 0,
        type: 'object',  // list<object>
        required: true,
        description: '待排序对象列表'
      },
      by: {
        businessName: 'by',
        register: '$r1', slotIndex: 1,
        type: 'string',
        required: true,
        description: '排序字段名'
      },
      desc: {
        businessName: 'desc',
        register: '$r2', slotIndex: 2,
        type: 'boolean',
        required: false,
        description: '降序（默认 false 升序）'
      }
    },
    outputs: {
      sorted: {
        businessName: 'sorted',
        register: '$r3', slotIndex: 3,
        type: 'object',  // list<object>
        required: true,
        description: '排序后列表'
      },
      count: {
        businessName: 'count',
        register: '$r4', slotIndex: 4,
        type: 'number',
        required: true,
        description: '列表长度'
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
    const by = inputs.by as string
    const desc = (inputs.desc as boolean | undefined) ?? false

    // 校验 items 是数组
    if (!Array.isArray(items)) {
      return {
        sorted: [],
        count: 0,
        error: createOperationError(
          'INVALID_INPUT',
          'items must be an array',
          'sort_by'
        ) as unknown as Value
      }
    }

    // 副本排序（不修改原数组）
    const sorted = [...items].sort((a, b) => {
      const av = (a as Record<string, unknown>)[by]
      const bv = (b as Record<string, unknown>)[by]

      // 比较：数字 < 数字；字符串 < 字符串；其他用 < 运算符
      let cmp = 0
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv
      } else if (typeof av === 'string' && typeof bv === 'string') {
        cmp = av < bv ? -1 : av > bv ? 1 : 0
      } else {
        /* v8 ignore next 3 -- 防御代码：通用 < / > 比较（未指定混合类型排序场景）*/
        cmp = (av as never) < (bv as never) ? -1 : (av as never) > (bv as never) ? 1 : 0
      }
      return desc ? -cmp : cmp
    })

    return { sorted, count: sorted.length, error: null }
  }
}