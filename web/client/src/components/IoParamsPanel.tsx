import type { XmlExperience } from '../../../shared/xml-schema'

interface Props {
  xmlExp: XmlExperience
}

export default function IoParamsPanel({ xmlExp }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* 输入参数 */}
      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">IN</span>
          输入参数
          <span className="text-sm text-gray-400">({xmlExp.inputs.length})</span>
        </h3>
        {xmlExp.inputs.length === 0 ? (
          <p className="text-sm text-gray-400">无输入参数</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="text-left py-1 pr-2">名称</th>
                <th className="text-left py-1 pr-2">类型</th>
                <th className="text-left py-1 pr-2">必填</th>
                <th className="text-left py-1">默认值</th>
              </tr>
            </thead>
            <tbody>
              {xmlExp.inputs.map((p, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-1 pr-2 font-mono text-green-700">{p.name}</td>
                  <td className="py-1 pr-2 text-gray-600">{p.type}</td>
                  <td className="py-1 pr-2">
                    {p.required
                      ? <span className="text-red-500">是</span>
                      : <span className="text-gray-400">否</span>}
                  </td>
                  <td className="py-1 text-gray-600 font-mono text-xs">
                    {p.default !== undefined ? String(p.default) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 输出参数 */}
      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">OUT</span>
          输出参数
          <span className="text-sm text-gray-400">({xmlExp.outputs.length})</span>
        </h3>
        {xmlExp.outputs.length === 0 ? (
          <p className="text-sm text-gray-400">无输出参数</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="text-left py-1 pr-2">名称</th>
                <th className="text-left py-1 pr-2">类型</th>
                <th className="text-left py-1 pr-2">必填</th>
                <th className="text-left py-1">描述</th>
              </tr>
            </thead>
            <tbody>
              {xmlExp.outputs.map((p, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-1 pr-2 font-mono text-blue-700">{p.name}</td>
                  <td className="py-1 pr-2 text-gray-600">{p.type}</td>
                  <td className="py-1 pr-2">
                    {p.required
                      ? <span className="text-red-500">是</span>
                      : <span className="text-gray-400">否</span>}
                  </td>
                  <td className="py-1 text-gray-600 text-xs">{p.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  )
}
