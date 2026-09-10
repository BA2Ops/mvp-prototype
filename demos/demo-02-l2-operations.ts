/**
 * Demo 02 — L2 真实操作层（11 个 operation 的执行契约）
 *
 * 演示能力：直接调用 op.execute，观察 L2 统一契约：
 *          inputs → { outputs..., error }（已知错误数据化，不抛出）
 *
 * 运行：npx tsx demos/demo-02-l2-operations.ts
 *
 * 核心观察点：
 * - 文件类 op 的真实磁盘副作用
 * - 错误作为数据返回（$r_err 结构：code/message/op/timestamp）
 * - shell_exec 的 execFile 语义与三路输出
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { setupDemo, step, observe, note, verify, teardownDemo, type DemoCtx } from './lib.js'
import { fileReadOp } from '../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../src/l2/builtins/file-write.js'
import { shellExecOp } from '../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../src/l2/builtins/string-replace.js'
import { evaluateCollectionOp } from '../src/l2/builtins/evaluate-collection.js'
import { incrementCounterOp } from '../src/l2/builtins/increment-counter.js'
import { createInitialState } from '../src/l1/execution-state.js'
import { L2Registry } from '../src/l2/registry.js'
import { createProgrammableL3 } from '../src/mocks/mock-l3.js'

const ctx = await setupDemo('Demo 02 — L2 真实操作层')

// ============== 准备：演示数据 ==============

step('0', '准备演示数据（真实 tmpdir）')
const notesFile = join(ctx.dir, 'notes.txt')
await fs.writeFile(notesFile, 'alpha line\nbeta line\ngamma line', 'utf-8')
await fs.writeFile(join(ctx.dir, 'a.log'), 'log-a', 'utf-8')
await fs.writeFile(join(ctx.dir, 'b.log'), 'log-b', 'utf-8')
observe('演示文件', ['notes.txt', 'a.log', 'b.log'].map(f => join(ctx.dir, f)))

/** 直接调用 op.execute 的辅助（绕过 L1，纯 L2 契约展示）*/
async function run(op: { execute: (i: never) => Promise<Record<string, unknown>> }, inputs: Record<string, unknown>) {
  return op.execute(inputs as never) as Promise<Record<string, never>>
}

// ============== 步骤 1: file_write / file_read ==============

step('1', 'file_write → file_read（真实写盘 + 读盘往返）')
{
  const target = join(ctx.dir, 'roundtrip.txt')
  const w = await run(fileWriteOp, { path: target, content: 'L2 round trip' })
  observe('bytes_written', w.bytes_written)
  const r = await run(fileReadOp, { path: target })
  observe('content', r.content)
  verify(ctx, 'file_write 落盘字节数正确', () => w.bytes_written === 13 && w.error === null)
  verify(ctx, 'file_read 读回内容一致且 error=null', () => r.content === 'L2 round trip' && r.error === null)
}

// ============== 步骤 2: 已知错误数据化 ==============

step('2', 'file_read 对不存在文件 → ENOENT 作为数据返回（不抛出）')
{
  const r = await run(fileReadOp, { path: join(ctx.dir, 'no-such.txt') })
  observe('error.code', (r.error as { code: string }).code)
  observe('error.op', (r.error as { op: string }).op)
  note('错误结构: { code, message, op, timestamp } —— 上层据此做条件分支而非 try/catch')
  verify(ctx, 'ENOENT 数据化返回且 content=null', () =>
    (r.error as { code: string }).code === 'ENOENT' && r.content === null)
}

// ============== 步骤 3: glob_match ==============

step('3', 'glob_match — 查找 *.log')
{
  const r = await run(globMatchOp, { pattern: '*.log', cwd: ctx.dir })
  observe('matches', r.matches)
  observe('count', r.count)
  verify(ctx, 'glob 找到 2 个 .log 文件', () => r.count === 2 && (r.matches as string[]).length === 2)
}

// ============== 步骤 4: grep_search ==============

step('4', 'grep_search — 在 notes.txt 中搜索 beta')
{
  const r = await run(grepSearchOp, { pattern: 'beta', path: notesFile })
  observe('count', r.count)
  observe('首条匹配行号', (r.matches as Array<{ line: number }>)[0]?.line)
  verify(ctx, 'grep 命中 1 处且行号为 2', () =>
    r.count === 1 && (r.matches as Array<{ line: number }>)[0]?.line === 2)
}

// ============== 步骤 5: string_replace ==============

step('5', 'string_replace — 全部替换 alpha→ALPHA')
{
  const r = await run(stringReplaceOp, {
    text: 'alpha and alpha again', find: 'alpha', replace: 'ALPHA', replace_all: true
  })
  observe('result', r.result)
  observe('count', r.count)
  verify(ctx, '替换 2 处且结果正确', () => r.count === 2 && r.result === 'ALPHA and ALPHA again')
}

// ============== 步骤 6: evaluate_collection / increment_counter ==============

step('6', 'evaluate_collection (take) + increment_counter（数据处理类 op）')
{
  // evaluate_collection 需要 state,通过 L1 集成执行
  const expr = { type: 'op', name: 'take', args: [
    { type: 'literal', value: [10, 20, 30, 40] },
    { type: 'literal', value: 2 }
  ] }
  const l3 = createProgrammableL3()
  l3.setChildren('plan', [
    { id: 'mv_expr', parentIntentId: null, createdAt: 0, kind: 'move',
      from: { kind: 'literal', value: expr },
      to: { kind: 'internal', name: '$r0' } },
    { id: 'ev', parentIntentId: null, createdAt: 0, kind: 'execute_op',
      operation: 'evaluate_collection',
      inputs: { expr: { kind: 'internal', name: '$r0' } },
      outputs: {
        result: { kind: 'internal', name: '$r_result' },
        count: { kind: 'internal', name: '$r_count' },
        error: { kind: 'internal', name: '$r_err' }
      },
      status: 'pending' }
  ])
  const reg = new L2Registry(); reg.register(evaluateCollectionOp)
  const state = createInitialState(reg, l3)
  const { l1MainLoop } = await import('../src/l1/main-loop.js')
  await l1MainLoop({ type: 'plan', params: {} }, state)
  const taken = state.internalStore.get('$r_result') as number[]
  observe('taken', taken)
  observe('count', state.internalStore.get('$r_count'))

  const c = await run(incrementCounterOp, { value: 41 })
  observe('new_value', c.new_value)
  verify(ctx, 'evaluate_collection take 取前 2 个元素', () =>
    taken.join(',') === '10,20' && state.internalStore.get('$r_count') === 2)
  verify(ctx, 'increment_counter 41+1=42', () => c.new_value === 42)
}

// ============== 步骤 7: shell_exec ==============

step('7', 'shell_exec — 真实子进程（execFile 语义，非 shell 注入）')
{
  const r = await run(shellExecOp, {
    command: process.execPath,
    args: ['-e', 'process.stdout.write("child-ok:" + (2+3))']
  })
  observe('stdout', r.stdout)
  observe('exit_code', r.exit_code)
  note('execFile 直接执行二进制、参数数组传递——无 shell 解释，天然防注入')
  verify(ctx, '子进程 stdout 正确且 exit_code=0', () =>
    r.stdout === 'child-ok:5' && r.exit_code === 0)
}

// ============== 结束验证 ==============

await teardownDemo(ctx)
