/**
 * Demo 08 — 自然语言端到端（L4 Mock → MVP 三层 → 真实世界）
 *
 * 演示能力：系统的完整闭环——自然语言是唯一入口
 *          话语 → L4 识别 → L3 编译 → L1 执行 → L2 真实操作 → 结果观察
 *
 * 运行：npx tsx demos/demo-08-nl-pipeline.ts
 *
 * 核心观察点：
 * - 每句话识别出的 intent.type 与 params
 * - 主输出（经验的语义返回值）
 * - 磁盘真实副作用
 * - 无法识别的话语不进入执行
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { setupDemo, step, observe, note, verify, verifyAsync, teardownDemo, type DemoCtx } from './lib.js'
import { AgentPipeline } from '../src/l4/pipeline.js'
import { ExperienceService } from '../src/l3/experience-service.js'
import { CORE_EXPERIENCES } from '../src/l3/experience-library.js'
import { UnrecognizedInputError } from '../src/l4/mock-llm.js'
import { L2Registry } from '../src/l2/registry.js'
import { fileReadOp } from '../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../src/l2/builtins/file-write.js'
import { shellExecOp } from '../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../src/l2/builtins/evaluate-expr.js'

const ctx = await setupDemo('Demo 08 — 自然语言端到端')

// ============== 准备 ==============

step('0', '准备：组装 AgentPipeline（L4 mock + 经验库 + registry）')
const registry = new L2Registry()
for (const op of [fileReadOp, fileWriteOp, shellExecOp, globMatchOp, grepSearchOp, stringReplaceOp, evaluateExprOp]) {
  registry.register(op)
}
const service = new ExperienceService(CORE_EXPERIENCES, registry)
const agent = new AgentPipeline(service, registry, { baseDir: ctx.dir })
note('baseDir = 演示工作目录：话语中的相对路径自动拼接（模拟真实工作区上下文）')
note('替换 MockL4.recognize 为真 LLM 调用即可接入真实模型——接口形状已一致')

/** 对话辅助：打印 + 返回结果 */
async function say(utterance: string) {
  console.log(`\n  👤 "${utterance}"`)
  const r = await agent.say(utterance)
  observe(`intent`, `${r.intent.type} ${JSON.stringify(r.intent.params)}`)
  const primaryDisplay = Array.isArray(r.primary)
    ? `[${r.primary.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(', ')}]`
    : JSON.stringify(r.primary)
  observe('主输出', primaryDisplay)
  return r
}

// ============== 步骤 1: 写入 ==============

step('1', '写入文件（磁盘副作用验证）')
{
  const r = await say("把 'hello demo 08' 写入 note.txt")
  const disk = await fs.readFile(join(ctx.dir, 'note.txt'), 'utf-8')
  observe('磁盘内容', disk)
  verify(ctx, 'write_file 识别正确且落盘', () =>
    r.intent.type === 'write_file' && disk === 'hello demo 08' && r.error === null)
}

// ============== 步骤 2: 读取 ==============

step('2', '读取文件')
{
  const r = await say('读取 note.txt 的内容')
  verify(ctx, 'read_file 主输出 = 文件内容', () => r.primary === 'hello demo 08')
}

// ============== 步骤 3: 条件经验（运行时分支）==============

step('3', '条件经验：缺文件走默认值分支')
{
  const r = await say('读取 ghost.ini，如果不存在就用 fallback-v1')
  note('error_code($r_err)==ENOENT 判断为真 → use_default 路径（编译产物在运行时真实分叉）')
  verify(ctx, '缺文件时返回默认值', () =>
    r.intent.type === 'read_file_with_default' && r.primary === 'fallback-v1')
}

// ============== 步骤 4: 幂等写入 ==============

step('4', '幂等写入：safe_write 已存在则跳过')
{
  const before = await fs.readFile(join(ctx.dir, 'note.txt'), 'utf-8')
  const r = await say('安全地把 "SHOULD-NOT-APPEAR" 写入 note.txt')
  const after = await fs.readFile(join(ctx.dir, 'note.txt'), 'utf-8')
  observe('主输出（bytes，0=跳过）', r.primary)
  verify(ctx, '已存在文件未被覆盖', () =>
    r.primary === 0 && before === after && !after.includes('SHOULD-NOT-APPEAR'))
}

// ============== 步骤 5: 替换链 ==============

step('5', '替换链：读 → 替换 → 写（三步寄存器传递）')
{
  const r = await say('把 note.txt 里的 hello 替换为 goodbye')
  const disk = await fs.readFile(join(ctx.dir, 'note.txt'), 'utf-8')
  observe('磁盘内容', disk)
  verify(ctx, '替换计数=1 且磁盘更新', () =>
    r.primary === 1 && disk === 'goodbye demo 08')
}

// ============== 步骤 6: 存在检查 ==============

step('6', '存在检查（错误数据化 → 布尔结果）')
{
  const yes = await say('note.txt 是否存在')
  const no = await say('ghost.txt 是否存在')
  verify(ctx, 'exists 布尔两态正确', () => yes.primary === true && no.primary === false)
}

// ============== 步骤 7: 子进程 ==============

step('7', '执行命令（真实子进程）')
{
  const r = await say('执行 node --version')
  observe('stdout 首行', String(r.primary).split('\r\n')[0])
  verify(ctx, '拿到 node 版本且 exit=0', () =>
    String(r.primary).includes(process.versions.node) && (r.registers['$r_exit'] as number) === 0)
}

// ============== 步骤 8: 无法识别 ==============

step('8', '无法识别的话语 → 不进入执行')
{
  let threw = ''
  try {
    await agent.say('讲个笑话')
  } catch (e) { threw = (e as Error).constructor.name }
  observe('异常类型', threw)
  verifyAsync(ctx, 'UnrecognizedInputError 且未产生任何执行', async () => {
    // 磁盘上不应有笑话产生的任何新 .txt（除已知文件外）
    const files = (await fs.readdir(ctx.dir)).filter(f => f.endsWith('.txt'))
    return threw === 'UnrecognizedInputError' && files.every(f => ['note.txt'].includes(f))
  })
}

// ============== 结束验证 ==============

await teardownDemo(ctx)
