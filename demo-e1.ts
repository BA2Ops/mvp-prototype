/**
 * E1 演示：自然语言端到端——「说话进，真实文件操作出」
 *
 * 运行：npx tsx demo-e1.ts
 *
 * 链路：用户话语 → MockL4 识别 → L3 编译 → L1 执行 → L2 真实操作 → 结果观察
 * 架构边界演示：上层只能"说话"，永远接触不到指令栈和 L2 op。
 */

import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentPipeline } from './src/l4/pipeline.js'
import { ExperienceService } from './src/l3/experience-service.js'
import { CORE_EXPERIENCES } from './src/l3/experience-library.js'
import { L2Registry } from './src/l2/registry.js'
import { fileReadOp } from './src/l2/builtins/file-read.js'
import { fileWriteOp } from './src/l2/builtins/file-write.js'
import { shellExecOp } from './src/l2/builtins/shell-exec.js'
import { globMatchOp } from './src/l2/builtins/glob-match.js'
import { grepSearchOp } from './src/l2/builtins/grep-search.js'
import { stringReplaceOp } from './src/l2/builtins/string-replace.js'
import { evaluateExprOp } from './src/l2/builtins/evaluate-expr.js'

const dir = await fs.mkdtemp(join(tmpdir(), 'e1-demo-'))

const registry = new L2Registry()
registry.register(fileReadOp)
registry.register(fileWriteOp)
registry.register(shellExecOp)
registry.register(globMatchOp)
registry.register(grepSearchOp)
registry.register(stringReplaceOp)
registry.register(evaluateExprOp)
const service = new ExperienceService(CORE_EXPERIENCES, registry)
const agent = new AgentPipeline(service, registry, { baseDir: dir })

async function chat(utterance: string): Promise<void> {
  console.log(`\n👤 ${utterance}`)
  try {
    const r = await agent.say(utterance)
    const primaryDisplay =
      Array.isArray(r.primary)
        ? `[${r.primary.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(', ')}]`
        : JSON.stringify(r.primary)
    console.log(`   🤖 已识别: ${r.intent.type}`)
    console.log(`   ✅ 结果: ${primaryDisplay}${r.error ? `（$r_err: ${(r.error as { code: string }).code}）` : ''} [${r.elapsedMs}ms]`)
  } catch (err) {
    console.log(`   ❌ ${(err as Error).message}`)
  }
}

console.log('='.repeat(60))
console.log('E1 端到端演示：自然语言 → MVP 三层架构 → 真实世界')
console.log(`工作区: ${dir}`)
console.log('='.repeat(60))

await chat("把 'hello MVP architecture' 写入 note.txt")
console.log(`   📂 磁盘验证: ${JSON.stringify(await fs.readFile(join(dir, 'note.txt'), 'utf-8'))}`)

await chat('读取 note.txt 的内容')

await chat('读取 config.ini，如果不存在就用 default-config-v1')

await chat('安全地把 "new version" 写入 note.txt')
console.log(`   📂 磁盘验证（应未被覆盖）: ${JSON.stringify(await fs.readFile(join(dir, 'note.txt'), 'utf-8'))}`)

await chat('把 note.txt 里的 hello 替换为 goodbye')
console.log(`   📂 磁盘验证: ${JSON.stringify(await fs.readFile(join(dir, 'note.txt'), 'utf-8'))}`)

await chat('查找 *.txt 文件')

await chat('在 note.txt 中搜索 goodbye')

await chat('执行 node --version')

await chat('ghost.txt 是否存在')

await chat('讲个笑话')

await fs.rm(dir, { recursive: true, force: true })
console.log('\n' + '='.repeat(60))
console.log('✅ E1 演示完成：自然语言是系统的唯一入口（LLM 不能直接调 L2）')
