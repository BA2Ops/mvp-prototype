/**
 * Phase B Tier B03 - shell_exec operation（真实实现）测试
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase B3
 *
 * 覆盖：
 * 1. formalSpec 结构
 * 2. execute 单元：stdout / args / cwd / timeout / 非零退出 / stderr / ENOENT / 安全（防注入）
 * 3. 集成（l1MainLoop）：完整链路
 *
 * 跨平台：使用 process.execPath（node 自身）作为命令执行 JS 代码
 */

import { describe, expect, test } from 'vitest'
import { l1MainLoop } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { L2Registry } from '../../src/l2/registry.js'
import { isOperationError } from '../../src/l2/errors.js'
import { shellExecOp } from '../../src/l2/builtins/shell-exec.js'
import { createProgrammableL3 } from '../../src/mocks/mock-l3.js'

// 跨平台：node 自身作为命令（process.execPath）
const NODE_CMD = process.execPath

describe('B03: shell_exec operation（真实实现）', () => {
  // ============== formalSpec ==============
  describe('formalSpec', () => {
    test('op 名称与 description', () => {
      expect(shellExecOp.name).toBe('shell_exec')
      expect(shellExecOp.description).toBeTruthy()
    })

    test('inputs：command (required) + args/cwd/timeout_ms (optional)', () => {
      expect(shellExecOp.formalSpec.inputs.command.required).toBe(true)
      expect(shellExecOp.formalSpec.inputs.args.required).toBe(false)
      expect(shellExecOp.formalSpec.inputs.cwd.required).toBe(false)
      expect(shellExecOp.formalSpec.inputs.timeout_ms.required).toBe(false)
    })

    test('outputs：stdout/stderr/exit_code + error($r_err)', () => {
      expect(shellExecOp.formalSpec.outputs.stdout.register).toBe('$r4')
      expect(shellExecOp.formalSpec.outputs.stderr.register).toBe('$r5')
      expect(shellExecOp.formalSpec.outputs.exit_code.register).toBe('$r6')
      expect(shellExecOp.formalSpec.outputs.exit_code.type).toBe('number')
      expect(shellExecOp.formalSpec.outputs.error.register).toBe('$r_err')
    })
  })

  // ============== execute 单元 ==============
  describe('execute 单元测试', () => {
    test('简单命令：node -e 输出 hello', async () => {
      const result = await shellExecOp.execute({
        command: NODE_CMD,
        args: ['-e', 'console.log("hello")']
      })

      expect(result.stdout).toBe('hello\n')
      expect(result.stderr).toBe('')
      expect(result.exit_code).toBe(0)
      expect(result.error).toBeNull()
    })

    test('多参数传递（不经过 shell 解析）', async () => {
      const result = await shellExecOp.execute({
        command: NODE_CMD,
        args: ['-e', 'console.log(process.argv.slice(1).join(" "))', 'arg1', 'arg2 with space']
      })

      expect(result.stdout).toBe('arg1 arg2 with space\n')
      expect(result.exit_code).toBe(0)
    })

    test('cwd 工作目录', async () => {
      // node -e "process.cwd()" 输出当前目录
      const result = await shellExecOp.execute({
        command: NODE_CMD,
        args: ['-e', 'console.log(process.cwd())'],
        cwd: process.cwd()
      })

      expect(result.stdout.trim()).toBe(process.cwd())
      expect(result.exit_code).toBe(0)
    })

    test('非零退出码：exit_code != 0，error=null', async () => {
      // node -e "process.exit(42)"
      const result = await shellExecOp.execute({
        command: NODE_CMD,
        args: ['-e', 'process.exit(42)']
      })

      expect(result.exit_code).toBe(42)
      expect(result.error).toBeNull()
    })

    test('stderr 输出捕获', async () => {
      const result = await shellExecOp.execute({
        command: NODE_CMD,
        args: ['-e', 'console.error("err msg")']
      })

      expect(result.stderr).toBe('err msg\n')
      expect(result.stdout).toBe('')
      expect(result.exit_code).toBe(0)
    })

    test('timeout：短 timeout + 慢命令 → TIMEOUT 错误', async () => {
      // node -e "setTimeout(() => {}, 5000)"  慢命令
      const result = await shellExecOp.execute({
        command: NODE_CMD,
        args: ['-e', 'setTimeout(() => {}, 5000)'],
        timeout_ms: 100  // 100ms 超时
      })

      expect(result.error).not.toBeNull()
      const err = result.error as { code: string; message: string }
      expect(err.code).toBe('TIMEOUT')
      expect(err.message).toContain('exceeded timeout')
      expect(err.message).toContain('100')
    })

    test('ENOENT：命令不存在', async () => {
      const result = await shellExecOp.execute({
        command: 'definitely-not-a-real-command-xyz123'
      })

      expect(isOperationError(result.error)).toBe(true)
      const err = result.error as { code: string; op: string }
      expect(err.code).toBe('ENOENT')
      expect(err.op).toBe('shell_exec')
    })

    test('安全性（防 shell 注入）：args 含特殊字符不执行', async () => {
      // 即使 args 含 ; rm -rf 等危险字符串，execFile 也不应执行（无 shell）
      const dangerous = ['-e', 'console.log("payload: ; rm -rf /")']
      const result = await shellExecOp.execute({
        command: NODE_CMD,
        args: dangerous
      })

      expect(result.exit_code).toBe(0)
      expect(result.stdout).toContain('payload: ; rm -rf /')
    })
  })

  // ============== 集成测试（l1MainLoop） ==============
  describe('集成：l1MainLoop + shell_exec', () => {
    function realL2Registry(): L2Registry {
      const r = new L2Registry()
      r.register(shellExecOp)
      return r
    }

    test('完整链路：move command/args → shell_exec → stdout/stderr/exit_code', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        {
          id: 'mv_cmd', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: NODE_CMD },
          to: { kind: 'internal', name: '$r0' }
        },
        {
          id: 'mv_args', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: ['-e', 'console.log("integration ok")'] },
          to: { kind: 'internal', name: '$r1' }
        },
        {
          id: 'se', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'shell_exec',
          inputs: {
            command: { kind: 'internal', name: '$r0' },
            args: { kind: 'internal', name: '$r1' }
          },
          outputs: {
            stdout: { kind: 'internal', name: '$r_stdout' },
            stderr: { kind: 'internal', name: '$r_stderr' },
            exit_code: { kind: 'internal', name: '$r_exit' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        }
      ])
      const state = createInitialState(realL2Registry(), l3)

      await l1MainLoop({ type: 'plan', params: {} }, state)

      expect(state.internalStore.get('$r_stdout')).toBe('integration ok\n')
      expect(state.internalStore.get('$r_stderr')).toBe('')
      expect(state.internalStore.get('$r_exit')).toBe(0)
      expect(state.internalStore.get('$r_err')).toBeNull()
      expect(state.stack.length).toBe(0)
    })

    test('非零退出码：exit_code 传递到寄存器', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        {
          id: 'mv_cmd', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: NODE_CMD },
          to: { kind: 'internal', name: '$r0' }
        },
        {
          id: 'mv_args', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: ['-e', 'process.exit(7)'] },
          to: { kind: 'internal', name: '$r1' }
        },
        {
          id: 'se', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'shell_exec',
          inputs: {
            command: { kind: 'internal', name: '$r0' },
            args: { kind: 'internal', name: '$r1' }
          },
          outputs: {
            stdout: { kind: 'internal', name: '$r_stdout' },
            stderr: { kind: 'internal', name: '$r_stderr' },
            exit_code: { kind: 'internal', name: '$r_exit' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        }
      ])
      const state = createInitialState(realL2Registry(), l3)

      await l1MainLoop({ type: 'plan', params: {} }, state)

      // 非零退出码是有效结果（不是错误）
      expect(state.internalStore.get('$r_exit')).toBe(7)
      expect(state.internalStore.get('$r_err')).toBeNull()
    })

    test('ENOENT 路径：$r_err 写入 OperationError', async () => {
      const l3 = createProgrammableL3()
      l3.setChildren('plan', [
        {
          id: 'mv_cmd', parentIntentId: null, createdAt: 0,
          kind: 'move',
          from: { kind: 'literal', value: 'nonexistent-cmd-xyz' },
          to: { kind: 'internal', name: '$r0' }
        },
        {
          id: 'se', parentIntentId: null, createdAt: 0,
          kind: 'execute_op', operation: 'shell_exec',
          inputs: {
            command: { kind: 'internal', name: '$r0' }
          },
          outputs: {
            stdout: { kind: 'internal', name: '$r_stdout' },
            stderr: { kind: 'internal', name: '$r_stderr' },
            exit_code: { kind: 'internal', name: '$r_exit' },
            error: { kind: 'internal', name: '$r_err' }
          },
          status: 'pending'
        }
      ])
      const state = createInitialState(realL2Registry(), l3)

      await l1MainLoop({ type: 'plan', params: {} }, state)

      const errVal = state.internalStore.get('$r_err') as { code: string; op: string }
      expect(errVal.code).toBe('ENOENT')
      expect(errVal.op).toBe('shell_exec')
    })
  })
})