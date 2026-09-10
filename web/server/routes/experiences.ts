/**
 * 经验 API 路由(F3.1)
 *
 * 提供经验 CRUD + 编译预览 API。
 *
 * 端点:
 *   GET    /api/experiences          列表(含元数据摘要)
 *   GET    /api/experiences/:id      详情(含 XML + 元数据)
 *   GET    /api/experiences/:id/xml  XML 原文
 *   GET    /api/experiences/:id/l3   编译后的 L3 Experience JSON
 *   GET    /api/experiences/:id/stack compileExperience 输出的 StackEntry 序列
 *   PUT    /api/experiences/:id/metadata 更新元数据(F3.9)
 *
 * @see tasks/phase-f3/README.md F3.1
 */

import type { FastifyInstance } from 'fastify'
import type { ExperienceStore } from '../services/experience-store.js'
import type { SearchService } from '../services/search-service.js'
import { parseEntryXml } from '../services/experience-store.js'
import { compileXmlToL3 } from '../../shared/xml-to-l3.js'
import { validateXmlExperience } from '../../shared/xml-validator.js'
import { validateMetadata } from '../../shared/metadata.js'

// ============== 路由注册 ==============

export interface RouteContext {
  store: ExperienceStore
  search: SearchService
}

export async function registerExperienceRoutes(
  app: FastifyInstance,
  ctx: RouteContext
): Promise<void> {
  const { store, search } = ctx

  // ============== 列表 ==============

  app.get('/api/experiences', async (_req, reply) => {
    const entries = await search.list()
    const summaries = entries.map(e => ({
      id: e.id,
      description: e.metadata.description,
      tags: e.metadata.tags,
      category: e.metadata.category,
      sideEffects: e.metadata.sideEffects,
      version: e.metadata.version,
      updatedAt: e.metadata.updatedAt
    }))
    return reply.send({ experiences: summaries, total: summaries.length })
  })

  // ============== 详情 ==============

  app.get<{ Params: { id: string } }>('/api/experiences/:id', async (req, reply) => {
    const entry = await store.get(req.params.id)
    if (!entry) {
      return reply.code(404).send({ error: '经验不存在' })
    }
    const xmlExp = parseEntryXml(entry)
    return reply.send({
      id: entry.id,
      xml: entry.xml,
      metadata: entry.metadata,
      parsed: xmlExp
    })
  })

  // ============== XML 原文 ==============

  app.get<{ Params: { id: string } }>('/api/experiences/:id/xml', async (req, reply) => {
    const entry = await store.get(req.params.id)
    if (!entry) {
      return reply.code(404).send({ error: '经验不存在' })
    }
    return reply.type('text/xml').send(entry.xml)
  })

  // ============== L3 编译结果 ==============

  app.get<{ Params: { id: string } }>('/api/experiences/:id/l3', async (req, reply) => {
    const entry = await store.get(req.params.id)
    if (!entry) {
      return reply.code(404).send({ error: '经验不存在' })
    }
    const xmlExp = parseEntryXml(entry)
    if (!xmlExp) {
      return reply.code(500).send({ error: 'XML 解析失败' })
    }

    // R1-R6 校验
    const validation = validateXmlExperience(xmlExp)
    if (!validation.valid) {
      return reply.code(400).send({
        error: 'XML 校验失败',
        details: validation.errors
      })
    }

    // 编译
    try {
      const l3 = compileXmlToL3(xmlExp)
      return reply.send({ experience: l3 })
    } catch (e) {
      return reply.code(500).send({
        error: `编译失败: ${e instanceof Error ? e.message : String(e)}`
      })
    }
  })

  // ============== StackEntry 序列 ==============

  app.get<{ Params: { id: string } }>('/api/experiences/:id/stack', async (req, reply) => {
    const entry = await store.get(req.params.id)
    if (!entry) {
      return reply.code(404).send({ error: '经验不存在' })
    }
    const xmlExp = parseEntryXml(entry)
    if (!xmlExp) {
      return reply.code(500).send({ error: 'XML 解析失败' })
    }

    const validation = validateXmlExperience(xmlExp)
    if (!validation.valid) {
      return reply.code(400).send({
        error: 'XML 校验失败',
        details: validation.errors
      })
    }

    try {
      // 延迟导入避免循环依赖
      const { compileExperience } = await import('../../../src/l3/compiler.js')
      const { createInitialState } = await import('../../../src/l1/execution-state.js')
      const { ExperienceService } = await import('../../../src/l3/experience-service.js')
      const { CORE_EXPERIENCES } = await import('../../../src/l3/experience-library.js')
      const { L2Registry } = await import('../../../src/l2/registry.js')
      const { fileReadOp } = await import('../../../src/l2/builtins/file-read.js')
      const { fileWriteOp } = await import('../../../src/l2/builtins/file-write.js')
      const { shellExecOp } = await import('../../../src/l2/builtins/shell-exec.js')
      const { globMatchOp } = await import('../../../src/l2/builtins/glob-match.js')
      const { grepSearchOp } = await import('../../../src/l2/builtins/grep-search.js')
      const { stringReplaceOp } = await import('../../../src/l2/builtins/string-replace.js')
      const { evaluateExprOp } = await import('../../../src/l2/builtins/evaluate-expr.js')
      const { evaluateCollectionOp } = await import('../../../src/l2/builtins/evaluate-collection.js')
      const { incrementCounterOp } = await import('../../../src/l2/builtins/increment-counter.js')
      const { decrementCounterOp } = await import('../../../src/l2/builtins/decrement-counter.js')
      const { sortByOp } = await import('../../../src/l2/builtins/sort-by.js')
      const { takeFirstOp } = await import('../../../src/l2/builtins/take-first.js')

      const registry = new L2Registry()
      registry.register(fileReadOp); registry.register(fileWriteOp); registry.register(shellExecOp)
      registry.register(globMatchOp); registry.register(grepSearchOp); registry.register(stringReplaceOp)
      registry.register(evaluateExprOp); registry.register(evaluateCollectionOp)
      registry.register(incrementCounterOp); registry.register(decrementCounterOp)
      registry.register(sortByOp); registry.register(takeFirstOp)

      const l3 = compileXmlToL3(xmlExp)
      const experiences = new Map(CORE_EXPERIENCES.map(e => [e.id, e]))
      experiences.set(l3.id, l3)
      const service = new ExperienceService(CORE_EXPERIENCES, registry)
      const state = createInitialState(registry, service)

      // 根据经验输入 schema 生成默认参数(与 compile-validator buildTestIntent 一致)
      const params: Record<string, unknown> = {}
      for (const [name, spec] of Object.entries(l3.inputs)) {
        if (spec.default !== undefined) {
          params[name] = spec.default
        } else if (spec.required) {
          switch (spec.type) {
            case 'string': params[name] = 'test-value'; break
            case 'number': params[name] = 0; break
            case 'boolean': params[name] = false; break
            case 'path': params[name] = '/tmp/test-path'; break
            case 'object': params[name] = []; break
            default: params[name] = null
          }
        }
      }

      const intent = { type: l3.id, params }
      const allocator = state.frameScopeAllocator
      if (allocator) allocator.enterScope()
      try {
        const entries = compileExperience(intent, state, experiences, registry, {
          useFixedSlotConvention: true
        })
        return reply.send({ stack: entries })
      } finally {
        if (allocator) allocator.exitScope()
      }
    } catch (e) {
      return reply.code(500).send({
        error: `编译失败: ${e instanceof Error ? e.message : String(e)}`
      })
    }
  })

  // ============== 更新元数据 ==============

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/experiences/:id/metadata',
    async (req, reply) => {
      const entry = await store.get(req.params.id)
      if (!entry) {
        return reply.code(404).send({ error: '经验不存在' })
      }

      // 合并更新
      const updatedMeta = {
        ...entry.metadata,
        ...req.body,
        id: req.params.id,  // id 不可改
        updatedAt: Date.now()
      }

      // 校验
      const validation = validateMetadata(updatedMeta)
      if (!validation.success || !validation.data) {
        return reply.code(400).send({
          error: '元数据校验失败',
          details: validation.errors
        })
      }

      // 保存
      await store.save({
        id: req.params.id,
        xml: entry.xml,
        metadata: validation.data
      })

      // 刷新搜索索引
      await search.refresh()

      return reply.send({ metadata: validation.data })
    }
  )
}
