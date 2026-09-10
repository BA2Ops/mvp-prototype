import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, type ExperienceDetail } from '../api/client'
import DagView from '../components/DagView'
import XmlViewer from '../components/XmlViewer'
import JsonViewer from '../components/JsonViewer'
import MetadataEditor from '../components/MetadataEditor'
import IoParamsPanel from '../components/IoParamsPanel'
import type { XmlExperience } from '../../../shared/xml-schema'

type Tab = 'metadata' | 'dag' | 'xml' | 'l3' | 'stack'

export default function ExperienceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [detail, setDetail] = useState<ExperienceDetail | null>(null)
  const [l3, setL3] = useState<unknown>(null)
  const [stack, setStack] = useState<unknown[]>([])
  const [tab, setTab] = useState<Tab>('metadata')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const d = await api.getExperience(id)
      setDetail(d)
      setLoading(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  const loadL3 = async () => {
    if (!id) return
    try {
      const res = await api.getL3(id)
      setL3(res.experience)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const loadStack = async () => {
    if (!id) return
    try {
      const res = await api.getStack(id)
      setStack(res.stack)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    if (tab === 'l3' && !l3) loadL3()
    if (tab === 'stack' && stack.length === 0) loadStack()
  }, [tab])

  if (loading) return <div className="p-8 text-gray-500">加载中...</div>
  if (error) return (
    <div className="p-8">
      <p className="text-red-500 mb-4">错误: {error}</p>
      <Link to="/" className="text-blue-500 hover:underline">返回列表</Link>
    </div>
  )
  if (!detail) return <div className="p-8 text-gray-500">经验不存在</div>

  const xmlExp = detail.parsed as XmlExperience

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <Link to="/" className="text-gray-500 hover:text-gray-700">← 返回</Link>
          <h1 className="text-xl font-bold text-gray-900">{detail.id}</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Tab 切换 */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-4">
            {([
              ['metadata', '元数据'],
              ['dag', 'DAG 可视化'],
              ['xml', 'XML 源码'],
              ['l3', 'L3 编译结果'],
              ['stack', 'Stack 序列']
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

        {/* Tab 内容 */}
        {tab === 'metadata' && (
          <div className="space-y-6">
            <MetadataEditor detail={detail} onUpdate={load} />
            {xmlExp && <IoParamsPanel xmlExp={xmlExp} />}
          </div>
        )}
        {tab === 'dag' && xmlExp && <DagView xmlExp={xmlExp} />}
        {tab === 'xml' && <XmlViewer xml={detail.xml} />}
        {tab === 'l3' && (
          l3
            ? <JsonViewer data={l3} title="L3 Experience(JSON)" height="500px" />
            : <p className="text-gray-500">加载中...</p>
        )}
        {tab === 'stack' && (
          stack.length > 0
            ? <JsonViewer data={stack} title="StackEntry 序列(JSON)" height="500px" />
            : <p className="text-gray-500">加载中...</p>
        )}
      </main>
    </div>
  )
}
