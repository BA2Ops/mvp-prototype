import { useState, useEffect, useCallback } from 'react'
import { api, type ExperienceSummary } from '../api/client'
import ExperienceCard from '../components/ExperienceCard'

export default function ExperienceListPage() {
  const [experiences, setExperiences] = useState<ExperienceSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 加载全部经验
  useEffect(() => {
    api.listExperiences()
      .then(res => {
        setExperiences(res.experiences)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  // 搜索(防抖 300ms)
  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      const res = await api.listExperiences()
      setExperiences(res.experiences)
      return
    }
    const res = await api.search(q)
    // 搜索结果转换为 summary 格式
    const summaries: ExperienceSummary[] = await Promise.all(
      res.results.map(async r => {
        const detail = await api.getExperience(r.id)
        return {
          id: r.id,
          description: r.description,
          tags: detail.metadata.tags,
          category: detail.metadata.category,
          sideEffects: detail.metadata.sideEffects,
          version: detail.metadata.version,
          updatedAt: detail.metadata.updatedAt
        }
      })
    )
    setExperiences(summaries)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      search(query).catch(e => setError(e.message))
    }, 300)
    return () => clearTimeout(timer)
  }, [query, search])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">经验设计工具</h1>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索经验(名称 + 简述)..."
            className="flex-1 max-w-md ml-6 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </header>

      {/* 主内容区 */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {loading && <p className="text-gray-500">加载中...</p>}
        {error && <p className="text-red-500">错误: {error}</p>}
        {!loading && !error && (
          <>
            <div className="mb-4 text-sm text-gray-500">
              共 {experiences.length} 条经验
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {experiences.map(exp => (
                <ExperienceCard key={exp.id} exp={exp} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
