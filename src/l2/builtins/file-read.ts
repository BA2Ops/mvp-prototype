/**
 * L2 file_read operation（真实实现）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/10-reactive-execution-model.md §三.8
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B1
 *
 * 设计（2026-08-20）：
 * - 读取文件内容到 internal 寄存器
 * - 已知错误（ENOENT/EACCES/EISDIR）作为数据返回（写 $r_err）
 * - 其他异常 throw → 主循环 bubbleError → L3 handleError 决定处置权
 *
 * 错误处理契约（与 A10 一致）：
 * - op 自己不分类"硬错误"，让 L3 通过 handleError 标志决定
 * - 已知错误码作为 OperationError 数据返回（便于 DAG 用 conditional_skip 处理）
 * - 未识别的 fs 错误码 throw（让 L1 冒泡，handler 可截获）
 *
 * 测试：tests/phase-b/tier-b01-file-read.test.ts（真实 tmpdir）
 */

import { promises as fs } from 'fs'
import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

/**
 * file_read op：读取文件内容
 *
 * inputs:
 *   - path: string（required）— 文件路径
 *   - encoding: string（optional, default 'utf-8'）— 字符编码
 *
 * outputs:
 *   - content: string（required）— 文件内容（成功时）
 *   - error: OperationError（optional）— 错误信息（写 $r_err）
 *
 * 行为：
 *   - 成功：{ content, error: null }
 *   - ENOENT/EACCES/EISDIR：{ content: null, error: OperationError{ code, ... } }
 *   - 其他异常：throw → L1 冒泡
 */
export const fileReadOp: Operation = {
  name: 'file_read',
  description: '读取文件内容到 internal 寄存器',

  formalSpec: {
    inputs: {
      path: {
        businessName: 'path',
        register: '$r0', slotIndex: 0,
        type: 'path',
        required: true,
        description: '要读取的文件路径'
      },
      encoding: {
        businessName: 'encoding',
        register: '$r1', slotIndex: 1,
        type: 'string',
        required: false,
        description: '字符编码（默认 utf-8）'
      }
    },
    outputs: {
      content: {
        businessName: 'content',
        register: '$r2', slotIndex: 2,
        type: 'string',
        required: true,
        description: '文件内容'
      },
      error: {
        businessName: 'error',
        register: '$r_err', slotIndex: 99,
        type: 'object',
        required: false,
        description: '错误信息（ENOENT/EACCES/EISDIR）'
      }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const path = inputs.path as string
    const encoding = (inputs.encoding as string) ?? 'utf-8'

    try {
      const content = await fs.readFile(path, { encoding: encoding as BufferEncoding })
      // 成功：content + error: null
      return { content, error: null }
    } catch (err: unknown) {
      // 已知错误码：返回数据（供 conditional_skip 处理）
      // ENOENT = 文件不存在；EACCES = 权限拒绝；EISDIR = 是目录不是文件
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EACCES' || code === 'EISDIR') {
        return {
          content: null,
          // OperationError 是合法业务数据（写 internalStore），TS interface 无 index signature
          // 需要断言为 Value（与 errors.ts / main-loop.ts 模式一致）
          error: createOperationError(
            code,
            (err as Error).message,
            'file_read'
          ) as unknown as Value
        }
      }
      // 其他异常（磁盘故障、IO 错误等）：throw → L1 bubbleError → L3 handleError 处置权
      throw err
    }
  }
}