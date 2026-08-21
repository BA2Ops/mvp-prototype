/**
 * L2 glob_match operation（真实实现）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B4
 *
 * 设计（2026-08-20）：
 * - 使用 Node 22+ 内置 fs.promises.glob（** 通配符原生支持）
 * - 返回匹配的文件路径列表 + 匹配数
 * - cwd 参数：搜索根目录（默认 process.cwd()）
 *
 * 错误处理：与 B01-B03 一致
 * - 已知错误码（ENOENT/EACCES）作为数据返回
 * - 其他异常 throw → L1 冒泡
 *
 * 测试：tests/phase-b/tier-b04-file-search.test.ts（真实 tmpdir）
 */

import { promises as fs } from 'fs'

// Node 22+ fs.promises.glob（TS 类型未识别；运行时支持）
// 完整签名见 Node.js 文档；MVP 用 cwd 选项足够
type FsWithGlob = typeof fs & {
  glob(pattern: string, options?: { cwd?: string }): AsyncIterable<string>
}
const fsWithGlob = fs as FsWithGlob
import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

/**
 * glob_match op：glob 模式匹配文件
 *
 * inputs:
 *   - pattern: string（required）— glob 模式（支持 *、**、? 等）
 *   - cwd: string（optional）— 搜索根目录（默认 process.cwd()）
 *
 * outputs:
 *   - matches: list<string>（required）— 匹配的文件路径列表（相对 cwd）
 *   - count: number（required）— 匹配数
 *   - error: OperationError（optional）— 错误信息
 *
 * 行为：
 *   - 成功：{ matches: [...], count, error: null }
 *   - 无匹配：{ matches: [], count: 0, error: null }
 *   - 已知错误（ENOENT/EACCES）：返回 error 数据
 *   - 其他异常：throw
 */
export const globMatchOp: Operation = {
  name: 'glob_match',
  description: 'glob 模式匹配文件路径（递归通配 ** 原生支持）',

  formalSpec: {
    inputs: {
      pattern: {
        businessName: 'pattern',
        register: '$r0',
        type: 'string',
        required: true,
        description: 'glob 模式（如 *.ts、**/*.test.ts）'
      },
      cwd: {
        businessName: 'cwd',
        register: '$r1',
        type: 'path',
        required: false,
        description: '搜索根目录（默认 process.cwd()）'
      }
    },
    outputs: {
      matches: {
        businessName: 'matches',
        register: '$r2',
        type: 'object',  // list<string>
        required: true,
        description: '匹配的文件路径列表'
      },
      count: {
        businessName: 'count',
        register: '$r3',
        type: 'number',
        required: true,
        description: '匹配数'
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
    const pattern = inputs.pattern as string
    const cwd = (inputs.cwd as string | undefined) ?? process.cwd()

    // 先 stat cwd（fs.glob 在 cwd 不存在时可能不抛错；显式检查）
    try {
      await fs.stat(cwd)
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EACCES') {
        return {
          matches: [],
          count: 0,
          error: createOperationError(code, (err as Error).message, 'glob_match') as unknown as Value
        }
      }
      throw err
    }

    try {
      // Node 22+ fs.promises.glob：原生支持 ** 递归通配
      const matches: string[] = []
      for await (const match of fsWithGlob.glob(pattern, { cwd })) {
        matches.push(match)
      }
      return {
        matches,
        count: matches.length,
        error: null
      }
    } catch (err: unknown) {
      // 已知错误码：返回数据
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EACCES') {
        return {
          matches: [],
          count: 0,
          error: createOperationError(
            code,
            (err as Error).message,
            'glob_match'
          ) as unknown as Value
        }
      }
      // 其他异常：throw → L1 bubbleError
      throw err
    }
  }
}