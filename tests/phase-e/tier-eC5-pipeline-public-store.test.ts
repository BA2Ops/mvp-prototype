/**
 * CRR P2/T-2.4 pipeline.collect 去 PRIMARY_OUTPUT 硬编码测试
 *
 * @see docs/mvp/19c-implementation-plan.md §三 T-2.4
 * @see docs/mvp/19-register-file-core.md §C5
 *
 * 契约:
 *  ① pipeline.say() 完成后,primary 从 publicStore[expId.<key>] 读取 (首个 persist:true binding)
 *  ② 未声明 outputs_bindings → primary = null (legacy fallback = null,不是 undefined)
 *  ③ legacy fallback (publicStore 无 key → internalStore[binding.register]) 兼容 P2→P4 过渡
 *  ④ 全部 9 条 CORE 经验在 T-2.4 后都能正确产出 primary (回填完成)
 *  ⑤ 多 persist:true binding 时 primary 取第一个 (Object.entries 顺序)
 *  ⑥ PRIMARY_OUTPUT 表已删除 (rg 不应再匹配)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentPipeline } from '../../src/l4/pipeline.js'
import { L2Registry } from '../../src/l2/registry.js'
import { ExperienceService } from '../../src/l3/experience-service.js'
import { CORE_EXPERIENCES } from '../../src/l3/experience-library.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { shellExecOp } from '../../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../../src/l2/builtins/evaluate-expr.js'
import { evaluateCollectionOp } from '../../src/l2/builtins/evaluate-collection.js'
import { incrementCounterOp } from '../../src/l2/builtins/increment-counter.js'
import { decrementCounterOp } from '../../src/l2/builtins/decrement-counter.js'
import { evaluateCollectionOp } from '../../src/l2/builtins/evaluate-collection.js'

function mkRegistry(): L2Registry {
  const r = new L2Registry()
  r.register(fileReadOp); r.register(fileWriteOp); r.register(shellExecOp)
  r.register(globMatchOp); r.register(grepSearchOp); r.register(stringReplaceOp)
  r.register(evaluateExprOp); r.register(evaluateCollectionOp); r.register(incrementCounterOp); r.register(decrementCounterOp)
  return r
}

function mkService(): ExperienceService {
  return new ExperienceService(CORE_EXPERIENCES, mkRegistry())
}

function mkPipeline(baseDir?: string): AgentPipeline {
  return new AgentPipeline(mkService(), mkRegistry(), baseDir ? { baseDir } : undefined)
}

describe('CE5: pipeline.collect 去 PRIMARY_OUTPUT 硬编码 (T-2.4)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'ce5-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  describe('① 全部 9 条 CORE 经验 primary 提取正确', () => {
    it('read_file → primary = file content', async () => {
      await fs.writeFile(join(dir, 'a.txt'), 'hello read_file', 'utf-8')
      const p = await mkPipeline(dir).say('读取 a.txt')
      expect(p.primary).toBe('hello read_file')
      expect(p.error).toBeNull()
    })

    it('write_file → primary = bytes_written', async () => {
      const p = await mkPipeline(dir).say(`把 'CRR P2 test' 写入 w.txt`)
      expect(p.primary).toBe('CRR P2 test'.length) // 12
      const content = await fs.readFile(join(dir, 'w.txt'), 'utf-8')
      expect(content).toBe('CRR P2 test')
    })

    it('check_file_exists (true) → primary = true', async () => {
      await fs.writeFile(join(dir, 'exists.txt'), 'x')
      const p = await mkPipeline(dir).say('exists.txt 是否存在')
      expect(p.primary).toBe(true)
    })

    it('check_file_exists (false) → primary = false', async () => {
      const p = await mkPipeline(dir).say('nope.txt 是否存在')
      expect(p.primary).toBe(false)
    })

    it('safe_write success → primary = bytes_written', async () => {
      const p = await mkPipeline(dir).say(`安全地把 'safe content' 写入 safe.txt`)
      expect(p.primary).toBe('safe content'.length)
    })

    it('safe_write abort (file exists) → primary = 0 (abort path 显式写 0)', async () => {
      await fs.writeFile(join(dir, 'safe.txt'), 'preexisting')
      const p = await mkPipeline(dir).say(`安全地把 'new' 写入 safe.txt`)
      // abort path: evaluate_expr(lit(0)) → $r_bytes = 0 → publicStore.safe_write.bytes_written = 0
      // (这是 safe_write 经验的业务设计:bytes_written 总是有值,0 = 没写入)
      expect(p.primary).toBe(0)
      // 原文件未被覆盖
      const content = await fs.readFile(join(dir, 'safe.txt'), 'utf-8')
      expect(content).toBe('preexisting')
    })

    it('find_files → primary = matches (object)', async () => {
      await fs.writeFile(join(dir, 'f1.txt'), 'a')
      await fs.writeFile(join(dir, 'f2.txt'), 'b')
      const p = await mkPipeline(dir).say('查找 *.txt 文件')
      expect(p.primary).toBeDefined()
      expect(Array.isArray(p.primary) || typeof p.primary === 'object').toBe(true)
    })

    it('search_in_files → primary = matches', async () => {
      await fs.writeFile(join(dir, 's.txt'), 'searchable content')
      const p = await mkPipeline(dir).say('在 s.txt 中搜索 searchable')
      expect(p.primary).toBeDefined()
    })

    it('run_shell → primary = stdout', async () => {
      // 跨平台：用 node -e 代替 echo（echo 在 Windows 上是 cmd 内置命令，
      // execFile 无 shell 解释器会 ENOENT；与 tier-b03 的跨平台约定一致）
      const p = await mkPipeline(dir).say('运行命令 node -e console.log("T-2.4-success")')
      expect(typeof p.primary).toBe('string')
      expect(p.primary).toContain('T-2.4-success')
    })

    it('replace_in_file → primary = count', async () => {
      await fs.writeFile(join(dir, 'r.txt'), 'foo bar foo baz foo')
      const p = await mkPipeline(dir).say(`把 r.txt 中的 foo 替换成 BAR`)
      expect(p.primary).toBe(3) // foo 出现 3 次
      const content = await fs.readFile(join(dir, 'r.txt'), 'utf-8')
      expect(content).toBe('BAR bar BAR baz BAR')
    })
  })

  describe('② ⑥ PRIMARY_OUTPUT 表已删除', () => {
    it('pipeline.ts 中不应再出现 PRIMARY_OUTPUT export/import 引用', async () => {
      const { readFile } = await import('fs/promises')
      const path = join(process.cwd(), 'src/l4/pipeline.ts')
      const content = await readFile(path, 'utf-8')
      // 注释中允许出现 "PRIMARY_OUTPUT" (设计说明),但不应有 export/const/Record 定义
      expect(content).not.toMatch(/^const PRIMARY_OUTPUT:/m)
      expect(content).not.toMatch(/^export const PRIMARY_OUTPUT/m)
    })
  })

  describe('③ legacy fallback (P2→P4 过渡兼容)', () => {
    it('publicStore 缺失 + internalStore 存在 → fallback 读 internalStore', async () => {
      // 直接构造 scenario: 模拟 P2→P4 过渡期
      const registry = mkRegistry()
      const service = mkService()
      // 拿一个 exp, 故意把 binding 改成 register 不在 step outputs 中的
      const exp = CORE_EXPERIENCES.find(e => e.id === 'read_file')!
      const { createInitialState } = await import('../../src/l1/execution-state.js')
      const state = createInitialState(registry, service)
      // 模拟: 先写入 internalStore 的值,然后 publicStore 不写
      state.internalStore.set('$r_content', 'fallback-value')
      const p = new AgentPipeline(service, registry)
      // 直接调 collect (反射) — 通过 say + 手动 state injection
      // 这里改用更简单的方式: 验证 primary 提取函数
      const extractPrimary = (p as any).extractPrimary.bind(p)
      const primary = extractPrimary('read_file', exp, state)
      expect(primary).toBe('fallback-value')
    })

    it('publicStore 有值 → 不走 fallback', async () => {
      const registry = mkRegistry()
      const service = mkService()
      const exp = CORE_EXPERIENCES.find(e => e.id === 'read_file')!
      const { createInitialState } = await import('../../src/l1/execution-state.js')
      const state = createInitialState(registry, service)
      state.publicStore.set('read_file.content', 'public-value')
      state.internalStore.set('$r_content', 'fallback-should-not-be-used')
      const p = new AgentPipeline(service, registry)
      const extractPrimary = (p as any).extractPrimary.bind(p)
      const primary = extractPrimary('read_file', exp, state)
      expect(primary).toBe('public-value')
    })
  })

  describe('④ 未声明 outputs_bindings → primary = null', () => {
    it('exp 无 bindings 时 primary = null', async () => {
      const registry = mkRegistry()
      const service = mkService()
      const { createInitialState } = await import('../../src/l1/execution-state.js')
      const state = createInitialState(registry, service)
      // 模拟一个无 binding 的 exp
      const fakeExp = {
        id: 'fake', description: 'x', inputs: {}, outputs: {},
        target_op: { base_op: 'noop', default_path: 'normal', paths: [{ id: 'normal', steps: [] }] }
      }
      const p = new AgentPipeline(service, registry)
      const extractPrimary = (p as any).extractPrimary.bind(p)
      const primary = extractPrimary('fake', fakeExp, state)
      expect(primary).toBeNull()
    })

    it('binding 全部 persist:false → primary = null (opt-in 原则)', async () => {
      const registry = mkRegistry()
      const service = mkService()
      const { createInitialState } = await import('../../src/l1/execution-state.js')
      const state = createInitialState(registry, service)
      const fakeExp = {
        id: 'fake2', description: 'x', inputs: {}, outputs: {},
        outputs_bindings: {
          x: { register: '$r_x', type: 'string' as const, persist: false }
        },
        target_op: { base_op: 'noop', default_path: 'normal', paths: [{ id: 'normal', steps: [] }] }
      }
      const p = new AgentPipeline(service, registry)
      const extractPrimary = (p as any).extractPrimary.bind(p)
      const primary = extractPrimary('fake2', fakeExp, state)
      expect(primary).toBeNull()
    })
  })

  describe('⑤ 多 persist:true binding → primary 取首个', () => {
    it('多个 persist binding 时 primary = 第一个 (按 Object.entries 顺序)', async () => {
      const registry = mkRegistry()
      const service = mkService()
      const { createInitialState } = await import('../../src/l1/execution-state.js')
      const state = createInitialState(registry, service)
      const fakeExp = {
        id: 'multi', description: 'x', inputs: {},
        outputs: { x: { type: 'string' as const, required: true }, y: { type: 'string' as const, required: true } },
        outputs_bindings: {
          x: { register: '$r_x', type: 'string' as const, persist: true },
          y: { register: '$r_y', type: 'string' as const, persist: true }
        },
        target_op: { base_op: 'noop', default_path: 'normal', paths: [{ id: 'normal', steps: [] }] }
      }
      state.publicStore.set('multi.x', 'first-value')
      state.publicStore.set('multi.y', 'second-value')
      const p = new AgentPipeline(service, registry)
      const extractPrimary = (p as any).extractPrimary.bind(p)
      const primary = extractPrimary('multi', fakeExp, state)
      expect(primary).toBe('first-value')
    })
  })
})