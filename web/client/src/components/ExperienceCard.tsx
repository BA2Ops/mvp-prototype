import type { ExperienceSummary } from '../api/client'

const sideEffectIcon: Record<string, string> = {
  'read-only': '📄',
  'fs-write': '✏️',
  'exec': '⚡'
}

export default function ExperienceCard({ exp }: { exp: ExperienceSummary }) {
  return (
    <a
      href={`/experiences/${exp.id}`}
      className="block p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-900">{exp.id}</h3>
        <span className="text-xl" title={exp.sideEffects}>
          {sideEffectIcon[exp.sideEffects] ?? '❓'}
        </span>
      </div>
      <p className="text-sm text-gray-600 mb-2 line-clamp-2">{exp.description}</p>
      <div className="flex flex-wrap gap-1 mb-2">
        {exp.tags.map(tag => (
          <span key={tag} className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
            #{tag}
          </span>
        ))}
      </div>
      <div className="text-xs text-gray-400">
        {exp.category} · {exp.sideEffects} · v{exp.version}
      </div>
    </a>
  )
}
