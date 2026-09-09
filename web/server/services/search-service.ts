/**
 * 搜索 API(F2.6)
 *
 * 提供经验搜索的 API 层,封装 ExperienceStore + SearchIndex。
 * 供 Fastify 路由层调用(路由层在 F3.1 实现)。
 *
 * @see tasks/phase-f2/README.md F2.6
 */

import type { ExperienceStore, ExperienceEntry } from './experience-store.js'
import { FuzzySearchIndex, type SearchResult } from './search-index.js'

// ============== API 响应 ==============

export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
}

// ============== 搜索服务 ==============

/**
 * 经验搜索服务
 *
 * 封装 ExperienceStore + SearchIndex,提供搜索 API。
 * 启动时加载全部经验到搜索索引,经验变更时刷新。
 */
export class SearchService {
  private store: ExperienceStore
  private index: FuzzySearchIndex
  private cache: ExperienceEntry[] | null = null

  constructor(store: ExperienceStore) {
    this.store = store
    this.index = new FuzzySearchIndex([])
  }

  /** 初始化:加载全部经验到索引 */
  async init(): Promise<void> {
    this.cache = await this.store.list()
    this.index.update(this.cache)
  }

  /** 搜索 */
  async search(query: string, k: number = 20): Promise<SearchResponse> {
    if (this.cache === null) {
      await this.init()
    }
    const results = this.index.search(query, k)
    return {
      results,
      total: results.length,
      query
    }
  }

  /** 列出全部经验(空查询等价) */
  async list(): Promise<ExperienceEntry[]> {
    if (this.cache === null) {
      await this.init()
    }
    return this.cache!
  }

  /** 刷新索引(经验变更后调用) */
  async refresh(): Promise<void> {
    this.cache = null
    await this.init()
  }
}
