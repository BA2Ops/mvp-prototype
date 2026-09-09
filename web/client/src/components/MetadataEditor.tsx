import { useState } from 'react'
import type { ExperienceDetail } from '../api/client'
import { api } from '../api/client'

interface Props {
  detail: ExperienceDetail
  onUpdate: () => void
}

export default function MetadataEditor({ detail, onUpdate }: Props) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    description: detail.metadata.description,
    tags: detail.metadata.tags.join(', '),
    category: detail.metadata.category,
    sideEffects: detail.metadata.sideEffects,
    version: detail.metadata.version,
    status: detail.metadata.status
  })

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updateMetadata(detail.id, {
        description: form.description,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        category: form.category,
        sideEffects: form.sideEffects,
        version: form.version,
        status: form.status
      })
      setEditing(false)
      onUpdate()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-gray-900">元数据</h3>
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            编辑
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">描述</dt>
          <dd>{detail.metadata.description}</dd>
          <dt className="text-gray-500">标签</dt>
          <dd>{detail.metadata.tags.join(', ')}</dd>
          <dt className="text-gray-500">分类</dt>
          <dd>{detail.metadata.category}</dd>
          <dt className="text-gray-500">副作用</dt>
          <dd>{detail.metadata.sideEffects}</dd>
          <dt className="text-gray-500">版本</dt>
          <dd>{detail.metadata.version}</dd>
          <dt className="text-gray-500">状态</dt>
          <dd>{detail.metadata.status}</dd>
          <dt className="text-gray-500">创建时间</dt>
          <dd>{new Date(detail.metadata.createdAt).toLocaleString('zh-CN')}</dd>
          <dt className="text-gray-500">更新时间</dt>
          <dd>{new Date(detail.metadata.updatedAt).toLocaleString('zh-CN')}</dd>
        </dl>
      </div>
    )
  }

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-gray-900">编辑元数据</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(false)}
            className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">描述</label>
          <textarea
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            rows={2}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">标签(逗号分隔)</label>
          <input
            type="text"
            value={form.tags}
            onChange={e => setForm({ ...form, tags: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">分类</label>
          <input
            type="text"
            value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">副作用</label>
          <select
            value={form.sideEffects}
            onChange={e => setForm({ ...form, sideEffects: e.target.value as 'read-only' | 'fs-write' | 'exec' })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          >
            <option value="read-only">read-only</option>
            <option value="fs-write">fs-write</option>
            <option value="exec">exec</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">版本</label>
          <input
            type="text"
            value={form.version}
            onChange={e => setForm({ ...form, version: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">状态</label>
          <select
            value={form.status}
            onChange={e => setForm({ ...form, status: e.target.value as 'draft' | 'active' })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          >
            <option value="draft">draft</option>
            <option value="active">active</option>
          </select>
        </div>
      </div>
    </div>
  )
}
