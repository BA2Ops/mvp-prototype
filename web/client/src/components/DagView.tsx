import { useMemo, useEffect, useCallback } from 'react'
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  ReactFlowProvider
} from 'reactflow'
import dagre from 'dagre'
import 'reactflow/dist/style.css'
import type { XmlExperience } from '../../../shared/xml-schema'
import { extractDag } from './dag-extractor'

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

const nodeWidth = 180
const nodeHeight = 80

function layoutWithDagre(
  nodes: { id: string; kind: string }[],
  edges: { from: string; to: string; kind: string }[]
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'LR',
    nodesep: 60,
    ranksep: 100,
    marginx: 40,
    marginy: 40
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) {
    g.setNode(n.id, { width: nodeWidth, height: nodeHeight })
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
        x: pos.x - nodeWidth / 2,
        y: pos.y - nodeHeight / 2
      })
    }
  }
  return positions
}

function DagViewInner({ xmlExp }: { xmlExp: XmlExperience }) {
  const { nodes, edges } = useMemo(() => extractDag(xmlExp), [xmlExp])

  // 初始节点/边(仅在 xmlExp 变化时重建)
  const initialNodes = useMemo<Node[]>(() => {
    const positions = layoutWithDagre(nodes, edges)
    return nodes.map(n => {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 }
      const label = n.kind === 'op'
        ? `${n.opName ?? '?'}`
        : n.kind === 'experience'
        ? `${n.expName ?? '?'}`
        : n.kind === 'terminal'
        ? ''
        : `cond: ${n.varName}`

      return {
        id: n.id,
        type: 'default',
        position: pos,
        data: {
          label: (
            <div className="text-center">
              <div className="text-xs text-gray-500">{nodeLabel[n.kind]}</div>
              <div className="font-mono text-sm">{n.id}</div>
              {label && <div className="text-xs">{label}</div>}
            </div>
          )
        },
        style: {
          border: `2px solid ${nodeColor[n.kind]}`,
          borderRadius: '8px',
          background: '#fff',
          width: `${nodeWidth}px`,
          opacity: n.kind === 'terminal' ? 0.6 : 1
        },
        targetPosition: Position.Left,
        sourcePosition: Position.Right
      }
    })
  }, [nodes, edges])

  const initialEdges = useMemo<Edge[]>(() => {
    return edges.map((e, i) => {
      const style = edgeStyle[e.kind] ?? edgeStyle.sequence
      return {
        id: `e${i}-${e.from}-${e.to}`,
        source: e.from,
        target: e.to,
        label: e.label,
        type: 'smoothstep',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: style.stroke
        },
        style: {
          stroke: style.stroke,
          strokeDasharray: style.dashed ? '5 5' : undefined
        },
        labelStyle: { fill: style.labelColor, fontWeight: 600 }
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

  return (
    <div style={{ width: '100%', height: '500px' }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
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
