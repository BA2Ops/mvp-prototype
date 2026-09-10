import { useState, useEffect, useCallback } from 'react'
import { api, type ExperienceSummary, type OpSummary } from '../api/client'
import ExperienceCard from '../components/ExperienceCard'

type Tab = 'experiences' | 'ops'

export default function ExperienceListPage() {
  const [tab, setTab] = useState<Tab>('experiences')

  // 经验列表状态
  const [experiences, setExperiences] = useState<ExperienceSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // L2 操作列表状态
  const [ops, setOps] = useState<OpSummary[]>([])
  const [opsLoading, setOpsLoading] = useState(false)
  const [opsError, setOpsError] = useState<string | null>(null)

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

  // 加载 L2 操作(首次切换到 ops 选项卡时)
  useEffect(() => {
    if (tab !== 'ops' || ops.length > 0) return
    setOpsLoading(true)
    api.listOps()
      .then(res => { setOps(res.ops); setOpsLoading(false) })
      .catch(e => { setOpsError(e.message); setOpsLoading(false) })
  }, [tab, ops.length])

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
        <div className="px-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">经验设计工具</h1>
          {tab === 'experiences' && (
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索经验(名称 + 简述)..."
              className="flex-1 max-w-md ml-6 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>
      </header>

      {/* 选项卡 */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-6">
          <nav className="flex gap-4">
            {([
              ['experiences', '经验'],
              ['ops', 'L2 操作']
            ] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* 主内容区 */}
      <main className="px-6 py-8">
        {tab === 'experiences' && (
          <>
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
          </>
        )}

        {tab === 'ops' && (
          <>
            {opsLoading && <p className="text-gray-500">加载中...</p>}
            {opsError && <p className="text-red-500">错误: {opsError}</p>}
            {!opsLoading && !opsError && (
              <>
                <div className="mb-4 text-sm text-gray-500">
                  共 {ops.length} 个 L2 操作
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {ops.map(op => (
                    <a
                      key={op.name}
                      href={`/ops/${op.name}`}
                      className="block p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="text-lg font-semibold text-gray-900 font-mono">{op.name}</h3>
                        <span className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded">L2</span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2 line-clamp-2">{op.description}</p>
                      <div className="text-xs text-gray-400">
                        {op.inputs.length} 输入 · {op.outputs.length} 输出
                      </div>
                    </a>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
