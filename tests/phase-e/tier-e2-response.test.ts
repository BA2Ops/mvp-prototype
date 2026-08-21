/**
 * Phase E Tier E2 - 结果消息解析（D-E2-1：信息返回权在 L3）
 *
 * @see ../../src/l3/response.ts
 * @see ../../docs/mvp/12-experience-model.md
 *
 * 设计验证：
 * - L3 确定消息内容（path.response / failure[code]，插值在 L3 完成）
 * - L4/pipeline 只做渲染（message 原样返回）
 * - 失败显性化：$r_err 非空时用户拿到错误消息而非静默 null
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveResponse } from '../../src/l3/response.js'
import { AgentPipeline } from '../../src/l4/pipeline.js'
import { ExperienceService } from '../../src/l3/experience-service.js'
import { CORE_EXPERIENCES } from '../../src/l3/experience-library.js'
import { L2Registry } from '../../src/l2/registry.js'
import type { Experience } from '../../src/l3/experience.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { shellExecOp } from '../../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../../src/l2/builtins/evaluate-expr.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'e2-resp-'))
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
  return new AgentPipeline(new ExperienceService(CORE_EXPERIENCES, registry), registry, { baseDir: dir })
}

// ============== resolveResponse 单元 ==============

describe('E2: resolveResponse（L3 消息解析）', () => {
  const exp = CORE_EXPERIENCES.find(e => e.id === 'read_file_with_default')!

  test('优先级 1：$r_err 非空 → failure[code] 模板', () => {
    const readFile = CORE_EXPERIENCES.find(e => e.id === 'read_file')!
    const msg = resolveResponse(readFile, {
      $r_err: { code: 'EACCES', message: 'permission denied', op: 'file_read', timestamp: 0 },
      $r_input_path: 'x.txt'
    })
    expect(msg).toContain('没有权限访问 x.txt')
    expect(msg).not.toContain('{path}')
  })

  test('failure[\'*\'] 兜底未知错误码', () => {
    const msg = resolveResponse(exp, {
      $r_err: { code: 'EWHOOPS', message: 'weird failure', op: 'x', timestamp: 0 }
    })
    expect(msg).toContain('weird failure')
  })

  test('无 failure 映射的经验 → 默认失败格式', () => {
    const noFailure: Experience = {
      id: 'nf', description: '', inputs: {}, outputs: {},
      target_op: { base_op: 'x', default_path: 'normal',
        paths: [{ id: 'normal', description: '', steps: [] }] }
    }
    const msg = resolveResponse(noFailure, {
      $r_err: { code: 'E1', message: 'boom', op: 'x', timestamp: 0 }
    })
    expect(msg).toContain('[E1] boom')
  })

  test('优先级 2：$r_path 标记 → 对应 path.response（分支消息）', () => {
    // 走 use_default 路径（$r_path 标记由编译器分支构造写入）
    const msg = resolveResponse(exp, {
      $r_path: 'use_default',
      $r_input_path: 'config.ini',
      content: 'fallback'
    })
    expect(msg).toBe('文件 config.ini 不存在，已使用默认内容')
  })

  test('优先级 3：无标记 → default_path.response', () => {
    const msg = resolveResponse(exp, { $r_input_path: 'config.ini' })
    expect(msg).toBe('已读取 config.ini 的内容')
  })

  test('插值：未知变量保留原样（不静默吞掉）', () => {
    const msg = resolveResponse(exp, { $r_path: 'normal' })
    // normal 路径模板有 {path}，但未提供 path 寄存器 → 保留 {path}
    expect(msg).toContain('{path}')
  })
})

// ============== 端到端：人话回复 ==============

describe('E2: 端到端——每句话都有人类可读回复', () => {
  test('写入 → 「已写入 note.txt（N 字节）」', async () => {
    const r = await mkPipeline().say("把 'hello' 写入 note.txt")
    expect(r.message).toBe(`已写入 ${join(dir, 'note.txt')}（5 字节）`)
  })

  test('读取 → 「已读取 …的内容」', async () => {
    await fs.writeFile(join(dir, 'a.txt'), 'data', 'utf-8')
    const r = await mkPipeline().say('读取 a.txt 的内容')
    expect(r.message).toBe(`已读取 ${join(dir, 'a.txt')} 的内容`)
  })

  test('缺文件读默认 → 分支消息「文件 …不存在，已使用默认内容」', async () => {
    const r = await mkPipeline().say('读取 ghost.ini，如果不存在就用 fallback')
    expect(r.message).toBe(`文件 ${join(dir, 'ghost.ini')} 不存在，已使用默认内容`)
  })

  test('失败显性化：读取不存在的文件 → 明确的错误消息而非静默 null', async () => {
    const r = await mkPipeline().say('读取 missing.txt 的内容')
    expect(r.primary).toBeNull()                                    // 机器视角仍为 null
    expect(r.message).toContain('读取失败')                          // 人话视角显性报错
    expect(r.message).toContain('不存在')
    expect(r.error).not.toBeNull()                                  // 结构化错误保留
  })

  test('safe_write 跳过 → 「已存在，按安全模式跳过」', async () => {
    await fs.writeFile(join(dir, 's.txt'), 'old', 'utf-8')
    const r = await mkPipeline().say("安全地把 'new' 写入 s.txt")
    expect(r.message).toBe(`文件 ${join(dir, 's.txt')} 已存在，按安全模式跳过写入`)
  })

  test('替换链 → 「替换完成，共 N 处」', async () => {
    await fs.writeFile(join(dir, 'b.txt'), 'foo foo', 'utf-8')
    const r = await mkPipeline().say('把 b.txt 里的 foo 替换为 bar')
    expect(r.message).toBe(`替换完成：${join(dir, 'b.txt')} 中共替换 2 处并已保存`)
  })

  test('glob → 「共找到 N 个」', async () => {
    await fs.writeFile(join(dir, 'x.log'), '1', 'utf-8')
    const r = await mkPipeline().say('查找 *.log 文件')
    expect(r.message).toContain('共找到 1 个匹配 *.log 的文件')
  })

  test('存在检查 → 布尔结果内嵌消息', async () => {
    const r = await mkPipeline().say('nope.txt 是否存在')
    expect(r.message).toContain('存在检查完成')
    expect(r.message).toContain('false')
  })
})
