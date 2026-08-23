/**
 * L2 string_replace operation（真实实现）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B5
 *
 * 设计（2026-08-20）：
 * - 字面量/正则替换
 * - 仅替换第一处（默认）或全部替换（replace_all=true）
 * - replace 字符串保留 JS 语义（$1, $&, etc.）——与 String.prototype.replace 一致
 *
 * 错误处理：INVALID_REGEX 数据化
 *
 * 测试：tests/phase-b/tier-b05-data-processing.test.ts
 */

import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

/**
 * string_replace op：字符串替换
 *
 * inputs:
 *   - text: string（required）— 输入文本
 *   - find: string（required）— 查找字符串（字面量或正则源）
 *   - replace: string（required）— 替换字符串
 *   - regex: boolean（optional, default false）— 是否正则
 *   - replace_all: boolean（optional, default false）— 全局替换
 *
 * outputs:
 *   - result: string（required）— 替换后文本
 *   - count: number（required）— 替换次数
 *   - error: OperationError（optional）
 */
export const stringReplaceOp: Operation = {
  name: 'string_replace',
  description: '字符串替换（字面量或正则，可选全局）',

  formalSpec: {
    inputs: {
      text: {
        businessName: 'text',
        register: '$r0', slotIndex: 0,
        type: 'string',
        required: true,
        description: '输入文本'
      },
      find: {
        businessName: 'find',
        register: '$r1', slotIndex: 1,
        type: 'string',
        required: true,
        description: '查找字符串'
      },
      replace: {
        businessName: 'replace',
        register: '$r2', slotIndex: 2,
        type: 'string',
        required: true,
        description: '替换字符串'
      },
      regex: {
        businessName: 'regex',
        register: '$r3', slotIndex: 3,
        type: 'boolean',
        required: false,
        description: '是否正则（默认 false 字面量）'
      },
      replace_all: {
        businessName: 'replace_all',
        register: '$r4', slotIndex: 4,
        type: 'boolean',
        required: false,
        description: '全局替换（默认 false 仅第一处）'
      }
    },
    outputs: {
      result: {
        businessName: 'result',
        register: '$r5', slotIndex: 5,
        type: 'string',
        required: true,
        description: '替换后文本'
      },
      count: {
        businessName: 'count',
        register: '$r6', slotIndex: 6,
        type: 'number',
        required: true,
        description: '替换次数'
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
    const text = inputs.text as string
    const find = inputs.find as string
    const replace = inputs.replace as string
    const regex = (inputs.regex as boolean | undefined) ?? false
    const replaceAll = (inputs.replace_all as boolean | undefined) ?? false

    try {
      if (regex) {
        // 正则模式
        const flags = replaceAll ? 'g' : ''
        const re = new RegExp(find, flags)
        // 先计算次数（match 数量）
        const matches = text.match(new RegExp(find, replaceAll ? 'g' : ''))
        const count = matches ? matches.length : 0
        const result = text.replace(re, replace)
        return { result, count, error: null }
      } else {
        // 字面量模式：split+length 统计次数
        if (!replaceAll) {
          // 仅第一处
          const idx = text.indexOf(find)
          if (idx === -1) {
            return { result: text, count: 0, error: null }
          }
          const result = text.substring(0, idx) + replace + text.substring(idx + find.length)
          return { result, count: 1, error: null }
        } else {
          // 全局替换
          let count = 0
          let result = ''
          let pos = 0
          while (true) {
            const idx = text.indexOf(find, pos)
            if (idx === -1) {
              result += text.substring(pos)
              break
            }
            result += text.substring(pos, idx) + replace
            count++
            pos = idx + find.length
          }
          return { result, count, error: null }
        }
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        return {
          result: text,
          count: 0,
          error: createOperationError(
            'INVALID_REGEX',
            err.message,
            'string_replace'
          ) as unknown as Value
        }
      }
      /* v8 ignore next 3 -- 防御代码：try 内仅 RegExp 构造可能抛错（已捕获为 INVALID_REGEX）；此 throw 为不可预测运行时异常，走 L1 bubbleError */
      throw err
    }
  }
}