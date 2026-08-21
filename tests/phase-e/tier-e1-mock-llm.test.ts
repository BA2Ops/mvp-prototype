/**
 * Phase E Tier E1 - L4 Mock + 端到端 Pipeline 测试
 *
 * @see ../../src/l4/mock-llm.ts
 * @see ../../src/l4/pipeline.ts
 *
 * 验证「LLM 不能直接调 L2」边界的演示闭环：
 * 自然语言 → intent → L3 编译 → L1 执行 → L2 真实操作 → 结果观察
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MockL4, INTENT_RULES, UnrecognizedInputError } from '../../src/l4/mock-llm.js'
import { AgentPipeline } from '../../src/l4/pipeline.js'
import { ExperienceService } from '../../src/l3/experience-service.js'
import { CORE_EXPERIENCES } from '../../src/l3/experience-library.js'
import { L2Registry } from '../../src/l2/registry.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { shellExecOp } from '../../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../../src/l2/builtins/evaluate-expr.js'

// ============== 环境 ==============

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'e1-l4-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function mkPipeline(): AgentPipeline {
  const registry = new L2Registry()
  registry.register(fileReadOp)
  registry.register(fileWriteOp)
  registry.register(shellExecOp)
  registry.register(globMatchOp)
  registry.register(grepSearchOp)
  registry.register(stringReplaceOp)
  registry.register(evaluateExprOp)
  const service = new ExperienceService(CORE_EXPERIENCES, registry)
  return new AgentPipeline(service, registry, { baseDir: dir })
}

// ============== L4 识别 ==============

describe('E1: MockL4 识别', () => {
  const l4 = new MockL4()

  test('9 条规则覆盖全部核心经验（每条至少可被一句话命中）', () => {
    const covered = new Set<string>()
    for (const rule of INTENT_RULES) {
      // 规则存在即视为覆盖入口；具体话语命中在下方各测试验证
      covered.add(rule.name)
    }
    for (const expId of CORE_EXPERIENCES.map(e => e.id)) {
      expect(covered.has(expId)).toBe(true)
    }
  })

  test('读取文件', () => {
    expect(l4.recognize('读取 note.txt 的内容'))
      .toEqual({ type: 'read_file', params: { path: 'note.txt' } })
  })

  test('读取不存在就用默认（具体模式优先于 read_file）', () => {
    expect(l4.recognize('读取 config.ini，如果不存在就用 hello world'))
      .toEqual({ type: 'read_file_with_default', params: { path: 'config.ini', default_content: 'hello world' } })
  })

  test('检查是否存在', () => {
    expect(l4.recognize('检查 note.txt 是否存在'))
      .toEqual({ type: 'check_file_exists', params: { path: 'note.txt' } })
    expect(l4.recognize('note.txt 是否存在？'))
      .toEqual({ type: 'check_file_exists', params: { path: 'note.txt' } })
  })

  test('安全写入（优先于普通写入）', () => {
    expect(l4.recognize("安全地把 'my config' 写入 app.ini"))
      .toEqual({ type: 'safe_write', params: { content: 'my config', path: 'app.ini' } })
  })

  test('普通写入', () => {
    expect(l4.recognize("把 'hello mvp' 写入 note.txt"))
      .toEqual({ type: 'write_file', params: { content: 'hello mvp', path: 'note.txt' } })
  })

  test('替换（读→替换→写）', () => {
    expect(l4.recognize('把 note.txt 里的 foo 替换为 bar'))
      .toEqual({ type: 'replace_in_file', params: { path: 'note.txt', find: 'foo', replace: 'bar' } })
  })

  test('查找文件（glob）', () => {
    const r = l4.recognize('查找 *.txt 文件')
    expect(r.type).toBe('find_files')
    expect((r.params as Record<string, unknown>).pattern).toBe('*.txt')
  })

  test('搜索内容', () => {
    expect(l4.recognize('在 logs 中搜索 ERROR'))
      .toEqual({ type: 'search_in_files', params: { path: 'logs', pattern: 'ERROR' } })
  })

  test('执行命令（首词 command，其余 args）', () => {
    const r = l4.recognize('执行 node --version')
    expect(r.type).toBe('run_shell')
    expect(r.params).toEqual({ command: 'node', args: ['--version'] })
  })

  test('无法识别 → UnrecognizedInputError', () => {
    expect(() => l4.recognize('今天天气怎么样')).toThrow(UnrecognizedInputError)
  })
})

// ============== Pipeline 端到端 ==============

describe('E1: Pipeline 端到端（自然语言 → 真实世界）', () => {
  test('说话 → 写文件 → 磁盘真实落盘', async () => {
    const p = await mkPipeline().say(`把 'hello e1' 写入 note.txt`)
    expect(p.ok).toBe(true)
    expect(p.primary).toBe(8) // bytes_written（'hello e1' 共 8 字符）
    expect(await fs.readFile(join(dir, 'note.txt'), 'utf-8')).toBe('hello e1')
  })

  test('说话 → 读文件 → primary=content', async () => {
    await fs.writeFile(join(dir, 'a.txt'), 'content here', 'utf-8')
    const p = await mkPipeline().say('读取 a.txt 的内容')
    expect(p.primary).toBe('content here')
    expect(p.error).toBeNull()
  })

  test('说话 → 条件经验：缺文件走默认值分支', async () => {
    const p = await mkPipeline().say('读取 ghost.ini，如果不存在就用 fallback-value')
    expect(p.intent.type).toBe('read_file_with_default')
    expect(p.primary).toBe('fallback-value')
  })

  test('说话 → 替换链：磁盘内容真实变化', async () => {
    await fs.writeFile(join(dir, 'b.txt'), 'foo bar foo', 'utf-8')
    const p = await mkPipeline().say('把 b.txt 里的 foo 替换为 baz')
    expect(p.primary).toBe(2) // count
    expect(await fs.readFile(join(dir, 'b.txt'), 'utf-8')).toBe('baz bar baz')
  })

  test('说话 → 存在检查：primary=exists 布尔', async () => {
    await fs.writeFile(join(dir, 'c.txt'), 'x', 'utf-8')
    const pipeline = mkPipeline()
    expect((await pipeline.say('c.txt 是否存在')).primary).toBe(true)
    expect((await pipeline.say('missing.txt 是否存在')).primary).toBe(false)
  })

  test('相对路径自动拼接 baseDir（工作区上下文）', async () => {
    await fs.writeFile(join(dir, 'd.txt'), 'rel', 'utf-8')
    // 话语中只说相对路径，pipeline 拼接 baseDir 后 file_read 成功
    const p = await mkPipeline().say('读取 d.txt 的内容')
    expect(p.primary).toBe('rel')
  })

  test('连续对话共享同一 pipeline（每次独立 state）', async () => {
    const pipeline = mkPipeline()
    await pipeline.say("把 'v1' 写入 s.txt")
    const p2 = await pipeline.say('读取 s.txt 的内容')
    expect(p2.primary).toBe('v1')
  })

  test('无法识别的话语 → 友好引导回复（不抛异常、不执行）', async () => {
    const r = await mkPipeline().say('讲个笑话')
    expect(r.ok).toBe(false)
    expect(r.intent).toBeUndefined()
    // 引导信息包含能力清单（来自 L3 经验库的业务描述）
    expect(r.message).toContain('我能处理这些操作')
    expect(r.message).toContain('read_file')
    expect(r.message).toContain('读取文件内容')
  })
})
