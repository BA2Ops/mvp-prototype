import Editor from '@monaco-editor/react'

interface Props {
  data: unknown
  language?: 'json' | 'typescript'
  title?: string
  height?: string
}

export default function JsonViewer({ data, language = 'json', title, height = '400px' }: Props) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {title && (
        <div className="bg-gray-100 px-3 py-2 text-sm font-medium text-gray-600 border-b border-gray-200">
          {title}
        </div>
      )}
      <Editor
        height={height}
        language={language}
        value={text}
        theme="vs"
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          wordWrap: 'on'
        }}
      />
    </div>
  )
}
