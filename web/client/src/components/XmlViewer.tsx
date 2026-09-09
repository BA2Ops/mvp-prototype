import Editor from '@monaco-editor/react'

export default function XmlViewer({ xml }: { xml: string }) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-100 px-3 py-2 text-sm font-medium text-gray-600 border-b border-gray-200">
        XML 源码(只读)
      </div>
      <Editor
        height="400px"
        language="xml"
        value={xml}
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
