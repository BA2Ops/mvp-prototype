/** API 客户端(F3.2) */

const BASE = '/api'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ============== 类型 ==============

export interface ExperienceSummary {
  id: string
  description: string
  tags: string[]
  category: string
  sideEffects: 'read-only' | 'fs-write' | 'exec'
  version: string
  updatedAt: number
}

export interface ExperienceDetail {
  id: string
  xml: string
  metadata: {
    id: string
    description: string
    tags: string[]
    category: string
    sideEffects: 'read-only' | 'fs-write' | 'exec'
    version: string
    createdAt: number
    updatedAt: number
    status: 'draft' | 'active'
  }
  parsed: unknown
}

export interface SearchResult {
  id: string
  description: string
  score: number
  matchedFields: string[]
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
}

export interface OpParamSummary {
  businessName: string
  type: string
  required: boolean
  description?: string
}

export interface OpSummary {
  name: string
  description: string
  inputs: OpParamSummary[]
  outputs: OpParamSummary[]
}

export interface OpFormalParam {
  businessName: string
  register: string
  slotIndex: number
  type: string
  required: boolean
  description?: string
}

export interface OpDetail {
  name: string
  description: string
  inputs: Record<string, OpFormalParam>
  outputs: Record<string, OpFormalParam>
}

// ============== API ==============

export const api = {
  listExperiences: () =>
    fetchJson<{ experiences: ExperienceSummary[]; total: number }>('/experiences'),

  getExperience: (id: string) =>
    fetchJson<ExperienceDetail>(`/experiences/${id}`),

  getXml: (id: string) =>
    fetch(`${BASE}/experiences/${id}/xml`).then(r => r.text()),

  getL3: (id: string) =>
    fetchJson<{ experience: unknown }>(`/experiences/${id}/l3`),

  getStack: (id: string) =>
    fetchJson<{ stack: unknown[] }>(`/experiences/${id}/stack`),

  search: (q: string, k: number = 20) =>
    fetchJson<SearchResponse>(`/search?q=${encodeURIComponent(q)}&k=${k}`),

  listOps: () =>
    fetchJson<{ ops: OpSummary[]; total: number }>('/ops'),

  getOp: (name: string) =>
    fetchJson<OpDetail>(`/ops/${name}`),

  updateMetadata: (id: string, metadata: Partial<ExperienceSummary> & { status?: 'draft' | 'active' }) =>
    putJson<{ metadata: unknown }>(`/experiences/${id}/metadata`, metadata)
}
