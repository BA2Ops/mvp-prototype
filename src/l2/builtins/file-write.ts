/**
 * L2 file_write operation（真实实现）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/10-reactive-execution-model.md §三.8
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B2
 *
 * 设计（2026-08-20）：
 * - 写入内容到文件（overwrite 或 append）
 * - 已知错误（ENOENT/EACCES/EISDIR）作为数据返回（写 $r_err）
 * - 其他异常 throw → 主循环 bubbleError → L3 handleError 决定处置权
 *
 * 原子性评估（B2 反思触发，2026-08-20 决策）：
 * - MVP 不实现原子写入（write-to-temp + rename）
 * - 理由：MVP 场景是简单文件操作；崩溃风险低；复杂度收益不匹配
 * - 如未来需要：在 formalSpec 加 atomic 标志，execute 内实现 fs.writeFile(tmp) + fs.rename
 *
 * 测试：tests/phase-b/tier-b02-file-write.test.ts（真实 tmpdir）
 */

import { promises as fs } from 'fs'
import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

/**
 * file_write op：写入文件内容
 *
 * inputs:
 *   - path: string（required）— 文件路径
 *   - content: string（required）— 写入内容
 *   - mode: string（optional, default 'overwrite'）— 'overwrite' | 'append'
 *   - encoding: string（optional, default 'utf-8'）— 字符编码
 *
 * outputs:
 *   - bytes_written: number（required）— 写入字节数（content.length 字节近似值）
 *   - error: OperationError（optional）— 错误信息（写 $r_err）
 *
 * 行为：
 *   - 成功：{ bytes_written: Buffer.byteLength(content, encoding), error: null }
 *   - ENOENT/EACCES/EISDIR：{ bytes_written: 0, error: OperationError{ code, ... } }
 *   - 其他异常：throw → L1 冒泡
 */
export const fileWriteOp: Operation = {
  name: 'file_write',
  description: '写入文件内容（overwrite 或 append 模式）',

  formalSpec: {
    inputs: {
      path: {
        businessName: 'path',
        register: '$r0',
        type: 'path',
        required: true,
        description: '目标文件路径'
      },
      content: {
        businessName: 'content',
        register: '$r1',
        type: 'string',
        required: true,
        description: '写入内容'
      },
      mode: {
        businessName: 'mode',
        register: '$r2',
        type: 'string',
        required: false,
        description: "'overwrite'（默认）或 'append'"
      },
      encoding: {
        businessName: 'encoding',
        register: '$r3',
        type: 'string',
        required: false,
        description: '字符编码（默认 utf-8）'
      }
    },
    outputs: {
      bytes_written: {
        businessName: 'bytes_written',
        register: '$r4',
        type: 'number',
        required: true,
        description: '写入字节数'
      },
      error: {
        businessName: 'error',
        register: '$r_err',
        type: 'object',
        required: false,
        description: '错误信息（ENOENT/EACCES/EISDIR）'
      }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const path = inputs.path as string
    const content = inputs.content as string
    const mode = (inputs.mode as string) ?? 'overwrite'
    const encoding = (inputs.encoding as string) ?? 'utf-8'

    // 字节数（utf-8 编码下，英文 = 字符数；非英文 = 多字节）
    const bytesWritten = Buffer.byteLength(content, encoding as BufferEncoding)

    try {
      // flag: 'w' = overwrite（默认），'a' = append
      const flag = mode === 'append' ? 'a' : 'w'
      await fs.writeFile(path, content, {
        encoding: encoding as BufferEncoding,
        flag
      })
      // 成功：返回字节数 + error: null
      return { bytes_written: bytesWritten, error: null }
    } catch (err: unknown) {
      // 已知错误码：返回数据（供 conditional_skip 处理）
      // ENOENT = 父目录不存在；EACCES = 权限拒绝；EISDIR = 路径是目录
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EACCES' || code === 'EISDIR') {
        return {
          bytes_written: 0,
          // OperationError 是合法业务数据，TS interface 无 index signature，需断言
          error: createOperationError(
            code,
            (err as Error).message,
            'file_write'
          ) as unknown as Value
        }
      }
      // 其他异常（磁盘满、IO 错误等）：throw → L1 bubbleError → L3 handleError 处置权
      throw err
    }
  }
}