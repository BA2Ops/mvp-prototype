import { useMemo, useEffect } from 'react'
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  MarkerType,
  useNodesState,
  useEdgesState,
  ReactFlowProvider
} from 'reactflow'
import dagre from 'dagre'
import 'reactflow/dist/style.css'
import type { XmlExperience } from '../../../shared/xml-schema'
import { extractDag, type DagNode } from './dag-extractor'
import FloatingEdge, { type FloatingEdgeData } from './FloatingEdge'

const nodeColor: Record<string, string> = {
  op: '#3b82f6',
  experience: '#10b981',
  condition: '#f59e0b',
  terminal: '#94a3b8'
}

const nodeLabel: Record<string, string> = {
  op: 'OP',
  experience: 'EXP',
  condition: 'COND',
  terminal: 'END'
}

const edgeStyle: Record<string, { stroke: string; labelColor: string; dashed?: boolean }> = {
  sequence: { stroke: '#6366f1', labelColor: '#6366f1' },
  data: { stroke: '#10b981', labelColor: '#10b981', dashed: true },
  condition: { stroke: '#f59e0b', labelColor: '#f59e0b' }
}

// 节点尺寸根据内容动态计算(dagre 布局用估算值,实际渲染用 minHeight 自适应)
function nodeHeightFor(n: DagNode): number {
  if (n.kind === 'terminal') return 40
  if (n.kind === 'condition') return 80
  const inputCount = n.inputs?.length ?? 0
  const outputCount = n.outputs?.length ?? 0
  // 标题区 ~58 + 输入区(标题18 + 每行22) + 输出区(标题18 + 每行22) + padding 12
  const contentH = 58 + (inputCount > 0 ? 18 + inputCount * 22 : 0) + (outputCount > 0 ? 18 + outputCount * 22 : 0) + 12
  return Math.max(90, contentH)
}

function nodeWidthFor(n: DagNode): number {
  if (n.kind === 'terminal') return 100
  return 260
}

function layoutWithDagre(
  nodes: DagNode[],
  edges: { from: string; to: string; kind: string }[]
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'LR',
    nodesep: 60,
    ranksep: 120,
    marginx: 40,
    marginy: 40
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) {
    g.setNode(n.id, { width: nodeWidthFor(n), height: nodeHeightFor(n) })
  }
  for (const e of edges) {
    g.setEdge(e.from, e.to)
  }

  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const pos = g.node(n.id)
    if (pos) {
      positions.set(n.id, {
        x: pos.x - pos.width / 2,
        y: pos.y - pos.height / 2
      })
    }
  }
  return positions
}

// 节点内容渲染
function NodeLabel({ n }: { n: DagNode }) {
  if (n.kind === 'terminal') {
    return <div className="text-center text-xs text-gray-500">END</div>
  }

  const subTitle = n.kind === 'op'
    ? n.opName
    : n.kind === 'experience'
    ? n.expName
    : `cond: ${n.varName} (${n.condition})`

  return (
    <div className="px-2 py-1 overflow-hidden">
      {/* 标题区 */}
      <div className="text-center border-b border-gray-200 pb-1 mb-1">
        <div className="text-xs text-gray-500">{nodeLabel[n.kind]}</div>
        <div className="font-mono text-sm font-semibold truncate">{n.id}</div>
        <div className="text-xs text-gray-600 truncate">{subTitle}</div>
      </div>

      {/* 输入区 */}
      {n.inputs && n.inputs.length > 0 && (
        <div className="mb-1">
          <div className="text-xs font-semibold text-green-700 mb-0.5">IN</div>
          {n.inputs.map((inp, i) => (
            <div key={i} className="text-xs text-gray-700 font-mono leading-snug break-words">
              <span className="text-green-600">▸</span> {inp.name} <span className="text-gray-400">←</span> {inp.source}
            </div>
          ))}
        </div>
      )}

      {/* 输出区 */}
      {n.outputs && n.outputs.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-blue-700 mb-0.5">OUT</div>
          {n.outputs.map((out, i) => (
            <div key={i} className="text-xs text-gray-700 font-mono leading-snug break-words">
              <span className="text-blue-600">◂</span> {out.name} <span className="text-gray-400">→</span> {out.as}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DagViewInner({ xmlExp }: { xmlExp: XmlExperience }) {
  const { nodes, edges } = useMemo(() => extractDag(xmlExp), [xmlExp])

  // 初始节点/边(仅在 xmlExp 变化时重建)
  const initialNodes = useMemo<Node[]>(() => {
    const positions = layoutWithDagre(nodes, edges)
    return nodes.map(n => {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 }
      const w = nodeWidthFor(n)
      const h = nodeHeightFor(n)

      return {
        id: n.id,
        type: 'default',
        position: pos,
        data: { label: <NodeLabel n={n} /> },
        style: {
          border: `2px solid ${nodeColor[n.kind]}`,
          borderRadius: '8px',
          background: '#fff',
          width: `${w}px`,
          minHeight: `${h}px`,
          opacity: n.kind === 'terminal' ? 0.6 : 1
        }
      }
    })
  }, [nodes, edges])

  const initialEdges = useMemo<Edge[]>(() => {
    return edges.map((e, i) => {
      const style = edgeStyle[e.kind] ?? edgeStyle.sequence
      const edgeData: FloatingEdgeData = {
        stroke: style.stroke,
        dashed: style.dashed,
        labelColor: style.labelColor
      }
      return {
        id: `e${i}-${e.from}-${e.to}`,
        source: e.from,
        target: e.to,
        label: e.label,
        type: 'floating',
        data: edgeData,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: style.stroke
        }
      }
    })
  }, [edges])

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initialNodes)
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(initialEdges)

  // xmlExp 变化时重置节点和边(重新布局)
  useEffect(() => {
    setRfNodes(initialNodes)
    setRfEdges(initialEdges)
  }, [initialNodes, initialEdges, setRfNodes, setRfEdges])

  const edgeTypes = useMemo(() => ({ floating: FloatingEdge }), [])

  return (
    <div style={{ width: '100%', height: '500px' }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        edgeTypes={edgeTypes}
        fitView
        nodesConnectable={false}
        elementsSelectable
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

export default function DagView({ xmlExp }: { xmlExp: XmlExperience }) {
  return (
    <ReactFlowProvider>
      <DagViewInner xmlExp={xmlExp} />
    </ReactFlowProvider>
  )
}
