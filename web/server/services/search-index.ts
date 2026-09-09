/**
 * 模糊搜索索引(F2.5)
 *
 * 基于名称(id)+ 简述(description)构建模糊搜索索引。
 * MVP 不含向量搜索,仅关键词分词 + 加权评分。
 *
 * 搜索策略:
 * 1. 关键词分词:query 按空格/标点分词
 * 2. 匹配字段:id(精确 + 前缀)、description(包含匹配)、tags(精确)
 * 3. 加权评分:id 精确 > id 前缀 > tags 精确 > description 包含
 * 4. 返回 top-k(默认 20)
 *
 * @see tasks/phase-f2/README.md F2.5
 */

import type { ExperienceEntry } from './experience-store.js'

// ============== 搜索结果 ==============

export interface SearchResult {
  id: string
  description: string
  score: number
  matchedFields: string[]
}

export interface SearchIndex {
  /** 搜索,返回 top-k 结果 */
  search(query: string, k?: number): SearchResult[]
  /** 重建索引(经验变更后调用) */
  rebuild(): void
}

// ============== 搜索索引实现 ==============

/**
 * 模糊搜索索引
 *
 * 索引在构建时建立,经验变更时需调用 rebuild() 刷新。
 * 预留向量搜索接口(未来实现 VectorSearchIndex)。
 */
export class FuzzySearchIndex implements SearchIndex {
  private entries: ExperienceEntry[] = []
  private indexData: IndexEntry[] = []

  constructor(entries: ExperienceEntry[] = []) {
    this.entries = entries
    this.rebuild()
  }

  /** 更新经验列表并重建索引 */
  update(entries: ExperienceEntry[]): void {
    this.entries = entries
    this.rebuild()
  }

  rebuild(): void {
    this.indexData = this.entries.map(e => ({
      id: e.id,
      description: e.metadata.description,
      tags: e.metadata.tags,
      // 预处理:id 转小写、description 分词
      idLower: e.id.toLowerCase(),
      descTokens: tokenize(e.metadata.description)
    }))
  }

  search(query: string, k: number = 20): SearchResult[] {
    const queryTrimmed = query.trim()
    if (!queryTrimmed) {
      // 空查询返回全部(按 id 排序)
      return this.indexData
        .map(e => ({
          id: e.id,
          description: e.description,
          score: 0,
          matchedFields: []
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, k)
    }

    const queryTokens = tokenize(queryTrimmed)
    const queryLower = queryTrimmed.toLowerCase()

    const results: SearchResult[] = []

    for (const entry of this.indexData) {
      const matchedFields: string[] = []
      let score = 0

      // id 精确匹配(最高分)
      if (entry.idLower === queryLower) {
        score += 100
        matchedFields.push('id')
      }
      // id 前缀匹配
      else if (entry.idLower.startsWith(queryLower)) {
        score += 60
        matchedFields.push('id')
      }
      // id 包含匹配
      else if (entry.idLower.includes(queryLower)) {
        score += 30
        matchedFields.push('id')
      }

      // tags 精确匹配
      for (const tag of entry.tags) {
        if (tag.toLowerCase() === queryLower) {
          score += 50
          matchedFields.push('tags')
          break
        } else if (tag.toLowerCase().includes(queryLower)) {
          score += 20
          matchedFields.push('tags')
          break
        }
      }

      // description 包含匹配(分词级别)
      for (const token of queryTokens) {
        if (entry.descTokens.includes(token)) {
          score += 10
          if (!matchedFields.includes('description')) {
            matchedFields.push('description')
          }
        }
      }

      // description 整体包含
      if (entry.description.toLowerCase().includes(queryLower)) {
        score += 15
        if (!matchedFields.includes('description')) {
          matchedFields.push('description')
        }
      }

      if (score > 0 || matchedFields.length > 0) {
        results.push({
          id: entry.id,
          description: entry.description,
          score,
          matchedFields
        })
      }
    }

    // 按分数降序,分数相同按 id 升序
    results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    return results.slice(0, k)
  }
}

// ============== 辅助:分词 ==============

interface IndexEntry {
  id: string
  description: string
  tags: string[]
  idLower: string
  descTokens: string[]
}

/**
 * 简单分词:按空格/标点分词,转小写
 *
 * 中文不分词(整体作为一个 token),
 * 英文按空格/标点分词。
 */
function tokenize(text: string): string[] {
  if (!text) return []

  // 按非字母数字字符分割(保留中文字符)
  const tokens = text
    .toLowerCase()
    .split(/[\s,;:!?(){}\[\]"'`/\\|<>@#$%^&*+=~]+/)
    .filter(t => t.length > 0)

  return tokens
}
