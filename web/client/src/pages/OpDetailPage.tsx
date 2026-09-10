import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, type OpDetail, type OpFormalParam } from '../api/client'

export default function OpDetailPage() {
  const { name } = useParams<{ name: string }>()
  const [op, setOp] = useState<OpDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!name) return
    setLoading(true)
    setError(null)
    api.getOp(name)
      .then(d => { setOp(d); setLoading(false) })
      .catch(e => { setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
  }, [name])

  if (loading) return <div className="p-8 text-gray-500">加载中...</div>
  if (error) return (
    <div className="p-8">
      <p className="text-red-500 mb-4">错误: {error}</p>
      <Link to="/" className="text-blue-500 hover:underline">返回列表</Link>
    </div>
  )
  if (!op) return <div className="p-8 text-gray-500">操作不存在</div>

  const renderParamRow = (key: string, p: OpFormalParam) => (
    <tr key={key} className="border-b border-gray-100">
      <td className="px-4 py-2 font-mono text-sm text-gray-900">{p.businessName}</td>
      <td className="px-4 py-2 text-sm text-gray-600">{p.type}</td>
      <td className="px-4 py-2 text-sm">
        {p.required
          ? <span className="text-red-500">必填</span>
          : <span className="text-gray-400">可选</span>}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-gray-500">{p.register}</td>
      <td className="px-4 py-2 text-xs text-gray-500">{p.slotIndex}</td>
      <td className="px-4 py-2 text-sm text-gray-600">{p.description ?? '—'}</td>
    </tr>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <Link to="/" className="text-gray-500 hover:text-gray-700">← 返回</Link>
          <h1 className="text-xl font-bold text-gray-900">{op.name}</h1>
          <span className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded">L2 Operation</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* 描述 */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-2">描述</h2>
          <p className="text-gray-900">{op.description}</p>
        </section>

        {/* 输入形参 */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-4">输入形参 (Inputs)</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="px-4 py-2">业务名</th>
                <th className="px-4 py-2">类型</th>
                <th className="px-4 py-2">必填</th>
                <th className="px-4 py-2">寄存器</th>
                <th className="px-4 py-2">Slot</th>
                <th className="px-4 py-2">描述</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(op.inputs).map(([key, p]) => renderParamRow(key, p))}
            </tbody>
          </table>
        </section>

        {/* 输出形参 */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-4">输出形参 (Outputs)</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="px-4 py-2">业务名</th>
                <th className="px-4 py-2">类型</th>
                <th className="px-4 py-2">必填</th>
                <th className="px-4 py-2">寄存器</th>
                <th className="px-4 py-2">Slot</th>
                <th className="px-4 py-2">描述</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(op.outputs).map(([key, p]) => renderParamRow(key, p))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  )
}
