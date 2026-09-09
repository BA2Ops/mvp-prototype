import type { XmlExperience } from '../../../shared/xml-schema'

export interface DagNodeInput {
  name: string
  source: string  // 简短描述:fromInput:xxx / fromNode:id.output / literal:value
}

export interface DagNodeOutput {
  name: string
  as: string      // 目标寄存器名
}

export interface DagNode {
  id: string
  kind: 'op' | 'experience' | 'condition' | 'terminal'
  opName?: string
  expName?: string
  varName?: string
  condition?: string
  thenPath?: string
  elsePath?: string
  inputs?: DagNodeInput[]
  outputs?: DagNodeOutput[]
}

interface DagEdge {
  from: string
  to: string
  label: string
  kind: 'sequence' | 'data' | 'condition'
}

function describeSource(src: { kind: string; inputName?: string; nodeId?: string; outputName?: string; value?: unknown }): string {
  if (src.kind === 'fromInput') return `input:${src.inputName}`
  if (src.kind === 'fromNode') return `${src.nodeId}.${src.outputName}`
  if (src.kind === 'literal') {
    const v = src.value
    if (v === null) return 'literal:null'
    if (typeof v === 'string') return `literal:"${v.length > 20 ? v.slice(0, 20) + '…' : v}"`
    return `literal:${JSON.stringify(v)}`
  }
  return '?'
}

/**
 * 从 XmlExperience 提取 DAG 节点和边
 *
 * 边类型:
 * - sequence: path steps 顺序边(A → B)
 * - data: 节点输入 fromNode 数据依赖边 + 条件变量依赖边
 * - condition: 条件分支边(condition → path 首节点 / 终止节点)
 */
export function extractDag(xmlExp: XmlExperience): { nodes: DagNode[]; edges: DagEdge[] } {
  const nodes: DagNode[] = xmlExp.nodes.map(n => {
    if (n.kind === 'op') {
      return {
        id: n.id, kind: 'op', opName: n.opName,
        inputs: n.inputs.map(i => ({ name: i.name, source: describeSource(i.source as { kind: string; inputName?: string; nodeId?: string; outputName?: string; value?: unknown }) })),
        outputs: n.outputs.map(o => ({ name: o.name, as: o.as }))
      }
    }
    if (n.kind === 'experience') {
      return {
        id: n.id, kind: 'experience', expName: n.experienceId,
        inputs: n.inputs.map(i => ({ name: i.name, source: describeSource(i.source as { kind: string; inputName?: string; nodeId?: string; outputName?: string; value?: unknown }) })),
        outputs: n.outputs.map(o => ({ name: o.name, as: o.as }))
      }
    }
    return {
      id: n.id,
      kind: 'condition',
      varName: n.varName,
      condition: n.condition,
      thenPath: n.thenPath,
      elsePath: n.elsePath
    }
  })

  const edges: DagEdge[] = []
  const extraNodes: DagNode[] = []

  // ============== 1. 构建"变量 → [产出节点]"映射(多生产者) ==============
  const varProducers = new Map<string, string[]>()
  for (const node of xmlExp.nodes) {
    if (node.kind === 'condition') continue
    for (const output of node.outputs) {
      if (output.as) {
        const existing = varProducers.get(output.as) ?? []
        existing.push(node.id)
        varProducers.set(output.as, existing)
      }
    }
  }

  // ============== 2. path steps 顺序边 + 预处理节点链 ==============

  // 2a. 找出所有在 path steps 中出现过的节点
  const pathNodeIds = new Set<string>()
  for (const path of xmlExp.paths) {
    for (const step of path.steps) {
      pathNodeIds.add(step.node)
    }
  }

  // 2b. 预处理节点:不在任何 path 中、非 condition 的节点,按声明顺序排列
  const preprocessNodes = xmlExp.nodes
    .filter(n => n.kind !== 'condition' && !pathNodeIds.has(n.id))
    .map(n => n.id)

  // 2c. 预处理节点之间的顺序边
  for (let i = 0; i < preprocessNodes.length - 1; i++) {
    edges.push({
      from: preprocessNodes[i],
      to: preprocessNodes[i + 1],
      label: 'preprocess',
      kind: 'sequence'
    })
  }

  // 2d. 预处理链尾 → 每个 path 首节点(若尚无直接边)
  if (preprocessNodes.length > 0) {
    const lastPre = preprocessNodes[preprocessNodes.length - 1]
    for (const path of xmlExp.paths) {
      if (path.steps.length > 0) {
        const firstStep = path.steps[0].node
        // 避免与已有的 data 边重复(同 from→to 同向)
        const exists = edges.some(e => e.from === lastPre && e.to === firstStep)
        if (!exists) {
          edges.push({
            from: lastPre,
            to: firstStep,
            label: path.id,
            kind: 'sequence'
          })
        }
      }
    }
  }

  // 2e. path steps 内部顺序边
  for (const path of xmlExp.paths) {
    for (let i = 0; i < path.steps.length - 1; i++) {
      edges.push({
        from: path.steps[i].node,
        to: path.steps[i + 1].node,
        label: path.id,
        kind: 'sequence'
      })
    }
  }

  // ============== 3. 节点输入 fromNode 数据边 ==============
  for (const node of xmlExp.nodes) {
    if (node.kind === 'condition') continue
    for (const input of node.inputs) {
      if (input.source.kind === 'fromNode') {
        edges.push({
          from: input.source.nodeId,
          to: node.id,
          label: `${input.source.outputName}→${input.name}`,
          kind: 'data'
        })
      }
    }
  }

  // ============== 4. 条件节点边 ==============
  for (const node of xmlExp.nodes) {
    if (node.kind !== 'condition') continue

    // 4a. 条件变量依赖边:所有产出该变量的 op → 条件节点
    const producers = varProducers.get(node.varName) ?? []
    for (const producer of producers) {
      edges.push({
        from: producer,
        to: node.id,
        label: `${node.varName}?`,
        kind: 'data'
      })
    }

    // 4b. then 分支边
    const thenPath = xmlExp.paths.find(p => p.id === node.thenPath)
    if (thenPath && thenPath.steps.length > 0) {
      edges.push({
        from: node.id,
        to: thenPath.steps[0].node,
        label: 'then',
        kind: 'condition'
      })
    } else if (thenPath) {
      const terminalId = `__end_${thenPath.id}`
      extraNodes.push({ id: terminalId, kind: 'terminal' })
      edges.push({
        from: node.id,
        to: terminalId,
        label: `then (${thenPath.id})`,
        kind: 'condition'
      })
    }

    // 4c. else 分支边
    const elsePath = xmlExp.paths.find(p => p.id === node.elsePath)
    if (elsePath && elsePath.steps.length > 0) {
      edges.push({
        from: node.id,
        to: elsePath.steps[0].node,
        label: 'else',
        kind: 'condition'
      })
    } else if (elsePath) {
      const terminalId = `__end_${elsePath.id}`
      extraNodes.push({ id: terminalId, kind: 'terminal' })
      edges.push({
        from: node.id,
        to: terminalId,
        label: `else (${elsePath.id})`,
        kind: 'condition'
      })
    }
  }

  return { nodes: [...nodes, ...extraNodes], edges }
}
