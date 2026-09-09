/**
 * 经验库文件系统存储(F2.2)
 *
 * 实现 XML + metadata.json 的文件系统读写。
 * 接口设计预留数据库适配空间(未来 SqlExperienceStore / VectorExperienceStore)。
 *
 * 目录结构:
 *   experiences/
 *   ├── read_file/
 *   │   ├── experience.xml
 *   │   └── metadata.json
 *   ├── safe_write/
 *   │   ├── experience.xml
 *   │   └── metadata.json
 *   ...
 *
 * @see tasks/phase-f2/README.md F2.2
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import type { ExperienceMetadata } from '../../shared/metadata.js'
import { validateMetadata } from '../../shared/metadata.js'
import { serializeXml, parseXml } from '../../shared/xml-parser.js'
import type { XmlExperience } from '../../shared/xml-schema.js'

// ============== 存储接口(预留数据库适配) ==============

/**
 * 经验库存储接口
 *
 * 文件系统实现:FileSystemExperienceStore
 * 未来实现:SqlExperienceStore / VectorExperienceStore
 */
export interface ExperienceStore {
  /** 列出所有经验(仅元数据摘要,不含 XML) */
  list(): Promise<ExperienceEntry[]>
  /** 获取单条经验(含 XML 文本) */
  get(id: string): Promise<ExperienceEntry | null>
  /** 保存经验(新建或更新) */
  save(entry: ExperienceEntry): Promise<void>
  /** 删除经验 */
  delete(id: string): Promise<void>
  /** 检查经验是否存在 */
  exists(id: string): Promise<boolean>
}

/**
 * 经验条目(XML 文本 + 元数据)
 */
export interface ExperienceEntry {
  id: string
  xml: string
  metadata: ExperienceMetadata
}

// ============== 文件系统常量 ==============

const XML_FILENAME = 'experience.xml'
const METADATA_FILENAME = 'metadata.json'

// ============== 文件系统实现 ==============

/**
 * 文件系统经验库存储
 *
 * 每条经验存储在 `<rootDir>/<id>/` 目录下,含:
 *   - experience.xml:XML 中间定义
 *   - metadata.json:元数据
 */
export class FileSystemExperienceStore implements ExperienceStore {
  constructor(private readonly rootDir: string) {}

  // ============== 路径辅助 ==============

  private expDir(id: string): string {
    return join(this.rootDir, id)
  }

  private xmlPath(id: string): string {
    return join(this.expDir(id), XML_FILENAME)
  }

  private metadataPath(id: string): string {
    return join(this.expDir(id), METADATA_FILENAME)
  }

  // ============== ExperienceStore 实现 ==============

  async list(): Promise<ExperienceEntry[]> {
    try {
      const entries = await fs.readdir(this.rootDir, { withFileTypes: true })
      const dirs = entries.filter(e => e.isDirectory())

      const results: ExperienceEntry[] = []
      for (const dir of dirs) {
        const id = dir.name
        const entry = await this.get(id)
        if (entry) results.push(entry)
      }
      return results
    } catch (e) {
      // 目录不存在 → 空列表
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
  }

  async get(id: string): Promise<ExperienceEntry | null> {
    try {
      const xmlText = await fs.readFile(this.xmlPath(id), 'utf-8')
      const metaText = await fs.readFile(this.metadataPath(id), 'utf-8')

      const metaResult = validateMetadata(JSON.parse(metaText))
      if (!metaResult.success || !metaResult.data) {
        return null
      }

      return {
        id,
        xml: xmlText,
        metadata: metaResult.data
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  async save(entry: ExperienceEntry): Promise<void> {
    const dir = this.expDir(entry.id)
    await fs.mkdir(dir, { recursive: true })

    // 写入 XML
    await fs.writeFile(this.xmlPath(entry.id), entry.xml, 'utf-8')

    // 写入元数据
    await fs.writeFile(
      this.metadataPath(entry.id),
      JSON.stringify(entry.metadata, null, 2),
      'utf-8'
    )
  }

  async delete(id: string): Promise<void> {
    const dir = this.expDir(id)
    try {
      await fs.rm(dir, { recursive: true, force: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      await fs.access(this.xmlPath(id))
      return true
    } catch {
      return false
    }
  }
}

// ============== 辅助:XmlExperience ↔ ExperienceEntry ==============

/**
 * 从 XmlExperience 构造 ExperienceEntry(用于保存)
 */
export function createEntryFromXml(
  xmlExp: XmlExperience,
  existing?: ExperienceMetadata
): ExperienceEntry {
  const now = Date.now()
  const metadata: ExperienceMetadata = {
    id: xmlExp.id,
    description: xmlExp.description,
    tags: xmlExp.metadata.tags,
    category: xmlExp.metadata.category,
    sideEffects: xmlExp.metadata.sideEffects,
    version: xmlExp.metadata.version,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status: existing?.status ?? 'active'
  }

  return {
    id: xmlExp.id,
    xml: serializeXml(xmlExp),
    metadata
  }
}

/**
 * 从 ExperienceEntry 解析 XmlExperience(用于加载)
 */
export function parseEntryXml(entry: ExperienceEntry): XmlExperience | null {
  const result = parseXml(entry.xml)
  return result.success ? result.data ?? null : null
}
