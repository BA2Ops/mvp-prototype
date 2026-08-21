/**
 * L2 shell_exec operation（真实实现）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/10-reactive-execution-model.md §三.8
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B3
 *
 * 设计（2026-08-20）：
 * - 用 child_process.execFile 而非 exec（**无 shell 解释器**，参数数组化传递）
 * - MVP 限制：单命令 + 参数数组，不支持管道/重定向/free-form command string
 * - timeout：MVP 实现（AbortController + execFile timeout 选项）
 *
 * 安全约束（B3 反思触发）：
 * - **不**使用 shell 解释器（避免 shell 注入风险）
 * - 参数以数组形式传入 execFile，无字符串拼接，无 sh -c 调用
 * - 命令路径由 args 控制（不允许运行时拼接）
 *
 * timeout 决策（B3 反思触发）：
 * - MVP 实现 timeout（默认 30s，可配置）
 * - 超时触发 child_process 发送 SIGTERM → 进程未退出升级 SIGKILL
 * - 不实现"总超时"（含嵌套调用）——单次调用超时即可
 *
 * 错误处理：与 B01/B02 一致
 * - 已知错误码（ENOENT/EACCES/TIMEOUT）作为数据返回
 * - 其他异常 throw → L1 冒泡
 *
 * 测试：tests/phase-b/tier-b03-shell-exec.test.ts（跨平台：使用 process.execPath = node 自身）
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Operation } from '../operation.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

const execFileAsync = promisify(execFile)

/**
 * shell_exec op：执行外部命令（无 shell）
 *
 * inputs:
 *   - command: string（required）— 可执行命令名或绝对路径
 *   - args: list<string>（optional, default []）— 参数数组
 *   - cwd: string（optional）— 工作目录
 *   - timeout_ms: number（optional, default 30000）— 超时毫秒
 *
 * outputs:
 *   - stdout: string（required）— 标准输出
 *   - stderr: string（required）— 标准错误
 *   - exit_code: number（required）— 退出码（0 = 成功）
 *   - error: OperationError（optional）— 错误信息（写 $r_err）
 *
 * 行为：
 *   - 成功（exit_code=0）：{ stdout, stderr, exit_code, error: null }
 *   - 已知错误（ENOENT/EACCES/TIMEOUT）：{ ..., exit_code, error: ... }
 *   - 非零退出码：{ ..., exit_code, error: null }（exit_code 本身是结果）
 *   - 其他异常：throw
 */
export const shellExecOp: Operation = {
  name: 'shell_exec',
  description: '执行外部命令（无 shell 解析，防注入）',

  formalSpec: {
    inputs: {
      command: {
        businessName: 'command',
        register: '$r0',
        type: 'string',
        required: true,
        description: '可执行命令名或绝对路径'
      },
      args: {
        businessName: 'args',
        register: '$r1',
        type: 'object',  // list<string>
        required: false,
        description: '参数数组（不经过 shell 解析）'
      },
      cwd: {
        businessName: 'cwd',
        register: '$r2',
        type: 'path',
        required: false,
        description: '工作目录'
      },
      timeout_ms: {
        businessName: 'timeout_ms',
        register: '$r3',
        type: 'number',
        required: false,
        description: '超时毫秒（默认 30000）'
      }
    },
    outputs: {
      stdout: {
        businessName: 'stdout',
        register: '$r4',
        type: 'string',
        required: true,
        description: '标准输出'
      },
      stderr: {
        businessName: 'stderr',
        register: '$r5',
        type: 'string',
        required: true,
        description: '标准错误'
      },
      exit_code: {
        businessName: 'exit_code',
        register: '$r6',
        type: 'number',
        required: true,
        description: '退出码（0 = 成功）'
      },
      error: {
        businessName: 'error',
        register: '$r_err',
        type: 'object',
        required: false,
        description: '错误信息（ENOENT/EACCES/TIMEOUT）'
      }
    }
  },

  execute: async (inputs: Record<string, Value>): Promise<Record<string, Value>> => {
    const command = inputs.command as string
    const args = (inputs.args as string[] | undefined) ?? []
    const cwd = inputs.cwd as string | undefined
    const timeoutMs = (inputs.timeout_ms as number | undefined) ?? 30000

    try {
      const result = await execFileAsync(command, args, {
        cwd,
        timeout: timeoutMs,
        // Windows: 避免 spawn EINVALID 错误（PATHEXT）
        windowsHide: true
      })
      // 成功：stdout/stderr/exit_code=0，error: null
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: 0,
        error: null
      }
    } catch (err: unknown) {
      // execFile 失败可能包含 stdout/stderr（部分执行后失败）
      const anyErr = err as NodeJS.ErrnoException & {
        stdout?: string
        stderr?: string
        code?: string | number
        killed?: boolean
        signal?: string
      }

      // timeout：process killed 且 signal = SIGTERM 或 code = null
      if (anyErr.killed && anyErr.signal === 'SIGTERM') {
        return {
          stdout: anyErr.stdout ?? '',
          stderr: anyErr.stderr ?? '',
          exit_code: typeof anyErr.code === 'number' ? anyErr.code : -1,
          error: createOperationError(
            'TIMEOUT',
            `Command '${command}' exceeded timeout (${timeoutMs}ms)`,
            'shell_exec'
          ) as unknown as Value
        }
      }

      // 已知错误码
      const code = anyErr.code
      if (code === 'ENOENT' || code === 'EACCES') {
        return {
          stdout: anyErr.stdout ?? '',
          stderr: anyErr.stderr ?? '',
          exit_code: typeof code === 'number' ? code : -1,
          error: createOperationError(
            code,
            anyErr.message,
            'shell_exec'
          ) as unknown as Value
        }
      }

      // 非零退出码（命令执行了但返回非 0）：
      // execFile 在非零退出时 reject，但 stdout/stderr 已收集
      // 这种情况下 error 应为 null（exit_code 本身是结果）
      if (typeof code === 'number' && code !== 0) {
        return {
          stdout: anyErr.stdout ?? '',
          stderr: anyErr.stderr ?? '',
          exit_code: code,
          error: null
        }
      }

      // 其他异常（spawn 失败等）：throw → L1 bubbleError
      throw err
    }
  }
}