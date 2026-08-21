/**
 * Demo 08 — 自然语言端到端（L4 Mock → MVP 三层 → 真实世界）
 *
 * 演示能力：系统的完整闭环——自然语言是唯一入口
 *          话语 → L4 识别 → L3 编译 → L1 执行 → L2 真实操作 → 人话回复
 *
 * D-E2-1（信息返回权在 L3）：
 *          每条经验的 response/failure 模板在 L3 确定消息内容，
 *          L4 只做插值渲染——每句话都有人类可读的回复，失败显性化。
 *
 * 运行：npx tsx demos/demo-08-nl-pipeline.ts
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { setupDemo, step, observe, note, verify, teardownDemo, type DemoCtx } from './lib.js'
import { AgentPipeline } from '../src/l4/pipeline.js'
import { ExperienceService } from '../src/l3/experience-service.js'
import { CORE_EXPERIENCES } from '../src/l3/experience-library.js'
import { L2Registry } from '../src/l2/registry.js'
import { fileReadOp } from '../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../src/l2/builtins/file-write.js'
import { shellExecOp } from '../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../src/l2/builtins/evaluate-expr.js'

const ctx = await setupDemo('Demo 08 — 自然语言端到端（含人话回复）')

// ============== 准备 ==============

step('0', '准备：组装 AgentPipeline（L4 mock + 经验库 + registry）')
const registry = new L2Registry()
for (const op of [fileReadOp, fileWriteOp, shellExecOp, globMatchOp, grepSearchOp, stringReplaceOp, evaluateExprOp]) {
  registry.register(op)
}
const service = new ExperienceService(CORE_EXPERIENCES, registry)
const agent = new AgentPipeline(service, registry, { baseDir: ctx.dir })
note('回复消息由 L3 经验的 response/failure 模板生成（信息返回权在 L3），L4 只做渲染')

/** 对话辅助：打印用户话语 + 系统人话回复 */
async function say(utterance: string): Promise<string> {
  console.log(`\n  👤 "${utterance}"`)
  const r = await agent.say(utterance)
  for (const line of r.message.split('\n')) {
    console.log(`  🤖 ${line}`)
  }
  return r.message
}

// ============== 步骤 1: 写入 ==============

step('1', '写入文件（磁盘副作用 + 人话确认）')
{
  const msg = await say("把 'hello demo 08' 写入 note.txt")
  const disk = await fs.readFile(join(ctx.dir, 'note.txt'), 'utf-8')
  observe('磁盘内容', disk)
  verify(ctx, '回复含「已写入」且磁盘真实落盘', () =>
    msg.startsWith('已写入') && disk === 'hello demo 08')
}

// ============== 步骤 2: 读取 ==============

step('2', '读取文件')
{
  const msg = await say('读取 note.txt 的内容')
  verify(ctx, '回复为「已读取 …的内容」', () => msg === `已读取 ${join(ctx.dir, 'note.txt')} 的内容`)
}

// ============== 步骤 3: 失败显性化（人类可读错误）==============

step('3', '读取不存在的文件 → 明确的错误消息（而非静默 null）')
{
  const msg = await say('读取 missing.txt 的内容')
  note('修复前：主输出=null，用户一无所知；修复后：L3 failure 模板生成明确错误')
  verify(ctx, '回复含「读取失败」与「不存在」', () =>
    msg.includes('读取失败') && msg.includes('不存在'))
}

// ============== 步骤 4: 条件经验分支消息 ==============

step('4', '条件经验：缺文件走默认值 → 分支专属消息')
{
  const msg = await say('读取 ghost.ini，如果不存在就用 fallback-v1')
  verify(ctx, '回复为「不存在，已使用默认内容」（use_default 路径文案）', () =>
    msg.includes('不存在，已使用默认内容') && msg.includes('fallback-v1' ) === false)
}

// ============== 步骤 5: 幂等写入 ==============

step('5', '幂等写入：safe_write 已存在 → 跳过消息')
{
  await say("把 'original' 写入 keep.txt")
  const msg = await say('安全地把 "SHOULD-NOT-APPEAR" 写入 keep.txt')
  const disk = await fs.readFile(join(ctx.dir, 'keep.txt'), 'utf-8')
  verify(ctx, '回复「已存在，按安全模式跳过」且磁盘未变', () =>
    msg.includes('已存在，按安全模式跳过') && disk === 'original')
}

// ============== 步骤 6: 替换链 ==============

step('6', '替换链：读 → 替换 → 写（三步寄存器传递）')
{
  const msg = await say('把 note.txt 里的 hello 替换为 goodbye')
  const disk = await fs.readFile(join(ctx.dir, 'note.txt'), 'utf-8')
  verify(ctx, '回复「替换完成…1 处」且磁盘更新', () =>
    msg.includes('替换完成') && msg.includes('1 处') && disk === 'goodbye demo 08')
}

// ============== 步骤 7: glob + 存在检查 ==============

step('7', '查找与存在检查')
{
  const glob = await say('查找 *.txt 文件')
  const exists = await say('note.txt 是否存在')
  verify(ctx, '回复含匹配计数与检查结果', () =>
    glob.includes('共找到 2 个') && exists.includes('存在检查完成'))
}

// ============== 步骤 8: 无法识别 ==============

step('8', '无法识别 → 引导性回复（含能力清单，不抛异常）')
{
  const msg = await say('讲个笑话')
  observe('回复首行', msg.split('\n')[0])
  verify(ctx, '回复含「没有理解」与能力清单', () =>
    msg.includes('没有理解') && msg.includes('read_file') && msg.includes('我能处理这些操作'))
}

// ============== 结束验证 ==============

await teardownDemo(ctx)
