/**
 * MVP 演示脚本：确定的 L3 输入 → 整体运行结果观察
 *
 * 运行：npx tsx demo.ts
 *
 * 演示链路：
 *   RecognizedIntent（L3 输入）
 *     → ExperienceService.compile（L3 静态展开）
 *     → l1MainLoop（L1 执行）
 *     → L2 真实 op（fs / execFile）
 *     → 观察：internalStore 寄存器 + 真实世界副作用 + $r_err
 */

import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { l1MainLoop } from './src/l1/main-loop.js'
import { createInitialState } from './src/l1/execution-state.js'
import { L2Registry } from './src/l2/registry.js'
import { ExperienceService } from './src/l3/experience-service.js'
import { CORE_EXPERIENCES } from './src/l3/experience-library.js'
import type { RecognizedIntent, Value } from './src/l1/types.js'

import { fileReadOp } from './src/l2/builtins/file-read.js'
import { fileWriteOp } from './src/l2/builtins/file-write.js'
import { shellExecOp } from './src/l2/builtins/shell-exec.js'
import { globMatchOp } from './src/l2/builtins/glob-match.js'
import { grepSearchOp } from './src/l2/builtins/grep-search.js'
import { stringReplaceOp } from './src/l2/builtins/string-replace.js'
import { evaluateExprOp } from './src/l2/builtins/evaluate-expr.js'

// ============== 环境 ==============

function buildEnv() {
  const registry = new L2Registry()
  registry.register(fileReadOp)
  registry.register(fileWriteOp)
  registry.register(shellExecOp)
  registry.register(globMatchOp)
  registry.register(grepSearchOp)
  registry.register(stringReplaceOp)
  registry.register(evaluateExprOp)
  const service = new ExperienceService(CORE_EXPERIENCES, registry)
  const state = createInitialState(registry, service)
  return { service, state }
}

/** 运行一个确定的 L3 输入，返回观察结果 */
async function runIntent(intent: RecognizedIntent) {
  const { service, state } = buildEnv()
  const t0 = Date.now()
  await l1MainLoop(intent, state, { rootHandleError: service.shouldHandleError(intent.type) })
  const elapsed = Date.now() - t0

  // 收集本经验产生的寄存器（过滤编译器内部临时寄存器）
  const regs: Record<string, Value> = {}
  for (const [k, v] of state.internalStore) {
    if (k.startsWith('$r_argtmp_') || k.startsWith('$r_cond_') || k.startsWith('$r_judge_')) continue
    regs[k] = v
  }
  return { regs, elapsed, steps: state.stack.length }
}

function show(title: string, intent: RecognizedIntent, result: Awaited<ReturnType<typeof runIntent>>) {
  console.log(`\n${'='.repeat(62)}`)
  console.log(`▶ ${title}`)
  console.log(`${'='.repeat(62)}`)
  console.log('L3 输入 (RecognizedIntent):')
  console.log(`  { type: '${intent.type}', params: ${JSON.stringify(intent.params)} }`)
  console.log('输出寄存器:')
  for (const [k, v] of Object.entries(result.regs)) {
    const display = typeof v === 'string' && v.length > 60 ? JSON.stringify(v.slice(0, 60) + '…') : JSON.stringify(v)
    console.log(`  ${k} = ${display}`)
  }
  console.log(`(执行耗时 ${result.elapsed}ms)`)
}

// ============== 演示 ==============

const dir = await fs.mkdtemp(join(tmpdir(), 'mvp-demo-'))
console.log(`工作目录: ${dir}`)

// ---------- 演示 1：写文件 + 读回 ----------
const notePath = join(dir, 'note.txt')
show('演示 1: write_file（真实写盘）',
  { type: 'write_file', params: { path: notePath, content: 'hello MVP\nline2\nline3' } },
  await runIntent({ type: 'write_file', params: { path: notePath, content: 'hello MVP\nline2\nline3' } }))
console.log(`真实世界副作用: ${JSON.stringify(await fs.readFile(notePath, 'utf-8'))}`)

show('演示 2: read_file（真实读盘）',
  { type: 'read_file', params: { path: notePath } },
  await runIntent({ type: 'read_file', params: { path: notePath } }))

// ---------- 演示 3：条件分支（运行时 if/else）----------
show('演示 3: read_file_with_default → 文件存在 → 走 normal 路径',
  { type: 'read_file_with_default', params: { path: notePath, default_content: 'DEFAULT' } },
  await runIntent({ type: 'read_file_with_default', params: { path: notePath, default_content: 'DEFAULT' } }))

const missingPath = join(dir, 'no-such-file.txt')
show('演示 4: read_file_with_default → ENOENT → 走 use_default 路径（运行时分支）',
  { type: 'read_file_with_default', params: { path: missingPath, default_content: 'DEFAULT' } },
  await runIntent({ type: 'read_file_with_default', params: { path: missingPath, default_content: 'DEFAULT' } }))

// ---------- 演示 5：safe_write（已存在则不覆盖）----------
show('演示 5: safe_write → 目标已存在 → abort 路径（bytes=0，不覆盖）',
  { type: 'safe_write', params: { path: notePath, content: 'OVERWRITE!' } },
  await runIntent({ type: 'safe_write', params: { path: notePath, content: 'OVERWRITE!' } }))
console.log(`真实世界副作用: 文件未被覆盖 = ${JSON.stringify(await fs.readFile(notePath, 'utf-8'))}`)

// ---------- 演示 6：三步链（读→替换→写）----------
show('演示 6: replace_in_file（读 → string_replace → 写 三步寄存器链）',
  { type: 'replace_in_file', params: { path: notePath, find: 'line', replace: 'LINE' } },
  await runIntent({ type: 'replace_in_file', params: { path: notePath, find: 'line', replace: 'LINE' } }))
console.log(`真实世界副作用: ${JSON.stringify(await fs.readFile(notePath, 'utf-8'))}`)

// ---------- 演示 7：glob + shell ----------
show('演示 7: find_files（glob 查找）',
  { type: 'find_files', params: { pattern: '*.txt', cwd: dir } },
  await runIntent({ type: 'find_files', params: { pattern: '*.txt', cwd: dir } }))

show('演示 8: run_shell（真实子进程）',
  { type: 'run_shell', params: { command: process.execPath, args: ['-e', 'process.stdout.write("stdout from child process")'] } },
  await runIntent({ type: 'run_shell', params: { command: process.execPath, args: ['-e', 'process.stdout.write("stdout from child process")'] } }))

// ---------- 演示 9：异常处置权（handleError）----------
show('演示 9: check_file_exists → 不存在的文件 → exists=false（错误数据化，不抛出）',
  { type: 'check_file_exists', params: { path: join(dir, 'ghost.txt') } },
  await runIntent({ type: 'check_file_exists', params: { path: join(dir, 'ghost.txt') } }))

await fs.rm(dir, { recursive: true, force: true })
console.log(`\n${'='.repeat(62)}`)
console.log('✅ 演示完成：L3 输入 → L3 编译 → L1 执行 → L2 真实操作 → 结果观察')
console.log('   9 个确定输入，全部得到预期整体运行结果（寄存器 + 真实世界副作用）')
