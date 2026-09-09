/**
 * F2.7 测试:文件系统读写 + 模糊搜索 + type 校验
 *
 * @see tasks/phase-f2/README.md F2.7
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

import {
  FileSystemExperienceStore,
  createEntryFromXml
} from '../server/services/experience-store.js'
import { FuzzySearchIndex } from '../server/services/search-index.js'
import { SearchService } from '../server/services/search-service.js'
import { validateLiteralTypes, isTypeCompatible, inferValueType } from '../shared/type-validator.js'
import { validateMetadata } from '../shared/metadata.js'
import { ALL_XML_EXPERIENCES, readFileXml } from './fixtures/xml-experiences.js'
import type { XmlExperience } from '../shared/xml-schema.js'

// ============== 测试辅助 ==============

function mkTempDir(): string {
  return join(tmpdir(), `f2-test-${randomUUID()}`)
}

// ============== 测试 ==============

describe('F2.7: 元数据 + 文件系统存储 + 检索', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = mkTempDir()
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {})
  })

  // ============== F2.1 元数据 schema ==============

  describe('F2.1 元数据 schema', () => {
    it('合法元数据通过校验', () => {
      const meta = {
        id: 'test_exp',
        description: '测试经验',
        tags: ['test'],
        category: 'test',
        sideEffects: 'read-only',
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active'
      }
      const result = validateMetadata(meta)
      expect(result.success).toBe(true)
      expect(result.data?.id).toBe('test_exp')
    })

    it('缺少必填字段被拒绝', () => {
      const result = validateMetadata({
        id: 'test_exp'
        // 缺少 description, createdAt, updatedAt
      })
      expect(result.success).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('非法 sideEffects 被拒绝', () => {
      const result = validateMetadata({
        id: 'test',
        description: 'test',
        sideEffects: 'invalid-value',
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      expect(result.success).toBe(false)
    })
  })

  // ============== F2.2 文件系统存储 ==============

  describe('F2.2 文件系统存储', () => {
    it('保存经验 → 读取 → 验证内容一致', async () => {
      const store = new FileSystemExperienceStore(testDir)
      const xmlExp = readFileXml
      const entry = createEntryFromXml(xmlExp)

      await store.save(entry)
      expect(await store.exists(xmlExp.id)).toBe(true)

      const loaded = await store.get(xmlExp.id)
      expect(loaded).not.toBeNull()
      expect(loaded!.id).toBe(xmlExp.id)
      expect(loaded!.metadata.description).toBe(xmlExp.description)
      expect(loaded!.metadata.tags).toEqual(xmlExp.metadata.tags)
    })

    it('列出全部经验', async () => {
      const store = new FileSystemExperienceStore(testDir)

      // 保存 3 条经验
      for (const xmlExp of ALL_XML_EXPERIENCES.slice(0, 3)) {
        await store.save(createEntryFromXml(xmlExp))
      }

      const list = await store.list()
      expect(list).toHaveLength(3)
      expect(list.map(e => e.id).sort()).toEqual(
        ALL_XML_EXPERIENCES.slice(0, 3).map(e => e.id).sort()
      )
    })

    it('删除经验 → 目录清理', async () => {
      const store = new FileSystemExperienceStore(testDir)
      const entry = createEntryFromXml(readFileXml)

      await store.save(entry)
      expect(await store.exists(readFileXml.id)).toBe(true)

      await store.delete(readFileXml.id)
      expect(await store.exists(readFileXml.id)).toBe(false)
      expect(await store.get(readFileXml.id)).toBeNull()
    })

    it('空目录列表返回空数组', async () => {
      const store = new FileSystemExperienceStore(testDir)
      const list = await store.list()
      expect(list).toEqual([])
    })

    it('9 条经验持久化到文件系统', async () => {
      const store = new FileSystemExperienceStore(testDir)

      for (const xmlExp of ALL_XML_EXPERIENCES) {
        await store.save(createEntryFromXml(xmlExp))
      }

      const list = await store.list()
      expect(list).toHaveLength(9)
    })
  })

  // ============== F2.4 type 校验 ==============

  describe('F2.4 ParamSpec.type 编译期强校验', () => {
    it('path 声明 + string 字面量 → 通过(path 是 string 子类型)', () => {
      const xmlExp: XmlExperience = {
        ...readFileXml,
        nodes: [
          {
            kind: 'op',
            id: 'read',
            opName: 'file_read',
            inputs: [
              { name: 'path', source: { kind: 'literal', value: '/tmp/test.txt' } }
            ],
            outputs: [
              { name: 'content', as: '$r_content' },
              { name: 'error', as: '$r_err' }
            ]
          }
        ]
      }
      const result = validateLiteralTypes(xmlExp, { path: 'path' })
      expect(result.valid).toBe(true)
    })

    it('path 声明 + number 字面量 → 失败', () => {
      const xmlExp: XmlExperience = {
        ...readFileXml,
        nodes: [
          {
            kind: 'op',
            id: 'read',
            opName: 'file_read',
            inputs: [
              { name: 'path', source: { kind: 'literal', value: 12345 } }
            ],
            outputs: [
              { name: 'content', as: '$r_content' },
              { name: 'error', as: '$r_err' }
            ]
          }
        ]
      }
      const result = validateLiteralTypes(xmlExp, { path: 'path' })
      expect(result.valid).toBe(false)
      expect(result.errors[0].expectedType).toBe('path')
      expect(result.errors[0].actualType).toBe('number')
    })

    it('any 声明 + 任意类型 → 通过', () => {
      const xmlExp: XmlExperience = {
        ...readFileXml,
        inputs: [
          { name: 'path', type: 'path', required: true },
          { name: 'data', type: 'any', required: false }
        ],
        nodes: [
          {
            kind: 'op',
            id: 'read',
            opName: 'file_read',
            inputs: [
              { name: 'path', source: { kind: 'fromInput', inputName: 'path' } },
              { name: 'data', source: { kind: 'literal', value: { complex: 'object' } } }
            ],
            outputs: [
              { name: 'content', as: '$r_content' },
              { name: 'error', as: '$r_err' }
            ]
          }
        ]
      }
      const result = validateLiteralTypes(xmlExp)
      expect(result.valid).toBe(true)
    })

    it('isTypeCompatible 矩阵', () => {
      expect(isTypeCompatible('any', 'string')).toBe(true)
      expect(isTypeCompatible('any', 'number')).toBe(true)
      expect(isTypeCompatible('string', 'path')).toBe(true)
      expect(isTypeCompatible('string', 'string')).toBe(true)
      expect(isTypeCompatible('number', 'string')).toBe(false)
      expect(isTypeCompatible('path', 'string')).toBe(true)  // path 声明接受 string 字面量
    })

    it('inferValueType 推断', () => {
      expect(inferValueType('hello')).toBe('string')
      expect(inferValueType(42)).toBe('number')
      expect(inferValueType(true)).toBe('boolean')
      expect(inferValueType([1, 2])).toBe('object')
      expect(inferValueType({ a: 1 })).toBe('object')
      expect(inferValueType(null)).toBe('any')
    })
  })

  // ============== F2.5 模糊搜索 ==============

  describe('F2.5 模糊搜索索引', () => {
    it('搜索"文件"召回 file-io 类经验', async () => {
      const store = new FileSystemExperienceStore(testDir)
      for (const xmlExp of ALL_XML_EXPERIENCES) {
        await store.save(createEntryFromXml(xmlExp))
      }

      const entries = await store.list()
      const index = new FuzzySearchIndex(entries)
      const results = index.search('文件')

      const ids = results.map(r => r.id)
      expect(ids).toContain('read_file')
      expect(ids).toContain('write_file')
      expect(ids).toContain('safe_write')
      expect(ids).toContain('check_file_exists')
    })

    it('搜索"shell"召回 run_shell', async () => {
      const store = new FileSystemExperienceStore(testDir)
      for (const xmlExp of ALL_XML_EXPERIENCES) {
        await store.save(createEntryFromXml(xmlExp))
      }

      const entries = await store.list()
      const index = new FuzzySearchIndex(entries)
      const results = index.search('shell')

      const ids = results.map(r => r.id)
      expect(ids).toContain('run_shell')
    })

    it('搜索"search"召回 find_files 和 search_in_files', async () => {
      const store = new FileSystemExperienceStore(testDir)
      for (const xmlExp of ALL_XML_EXPERIENCES) {
        await store.save(createEntryFromXml(xmlExp))
      }

      const entries = await store.list()
      const index = new FuzzySearchIndex(entries)
      const results = index.search('search')

      const ids = results.map(r => r.id)
      expect(ids).toContain('find_files')
      expect(ids).toContain('search_in_files')
    })

    it('空查询返回全部经验', async () => {
      const store = new FileSystemExperienceStore(testDir)
      for (const xmlExp of ALL_XML_EXPERIENCES) {
        await store.save(createEntryFromXml(xmlExp))
      }

      const entries = await store.list()
      const index = new FuzzySearchIndex(entries)
      const results = index.search('')

      expect(results).toHaveLength(9)
    })

    it('结果按相关性排序', async () => {
      const store = new FileSystemExperienceStore(testDir)
      for (const xmlExp of ALL_XML_EXPERIENCES) {
        await store.save(createEntryFromXml(xmlExp))
      }

      const entries = await store.list()
      const index = new FuzzySearchIndex(entries)
      const results = index.search('file')

      // 精确匹配 read_file 应该在前
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score)
    })
  })

  // ============== F2.6 搜索 API ==============

  describe('F2.6 搜索 API', () => {
    it('SearchService.search 返回正确结果', async () => {
      const store = new FileSystemExperienceStore(testDir)
      for (const xmlExp of ALL_XML_EXPERIENCES) {
        await store.save(createEntryFromXml(xmlExp))
      }

      const service = new SearchService(store)
      await service.init()

      const response = await service.search('文件')
      expect(response.results.length).toBeGreaterThan(0)
      expect(response.total).toBe(response.results.length)
      expect(response.query).toBe('文件')

      const ids = response.results.map(r => r.id)
      expect(ids).toContain('read_file')
    })

    it('SearchService.list 返回全部经验', async () => {
      const store = new FileSystemExperienceStore(testDir)
      for (const xmlExp of ALL_XML_EXPERIENCES) {
        await store.save(createEntryFromXml(xmlExp))
      }

      const service = new SearchService(store)
      await service.init()

      const list = await service.list()
      expect(list).toHaveLength(9)
    })
  })
})
