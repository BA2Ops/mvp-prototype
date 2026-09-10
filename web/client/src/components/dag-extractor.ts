import type { XmlExperience } from '../../../shared/xml-schema'

export interface DagNodeInput {
  name: string
  source: string  // 简短描述:fromInput:xxx / fromNode:id.output / literal:value / expr:is_null(probe.error)
}

export interface DagNodeOutput {
  name: string
  as: string      // 业务变量名(L3 编译时映射到寄存器)
}

export interface DagExpInput {
  name: string
  type: string
  required: boolean
}

export interface DagBinding {
  name: string
  fromNode: string
  type: string
}

export interface DagNode {
  id: string
  kind: 'op' | 'experience' | 'condition' | 'terminal' | 'start' | 'end'
  opName?: string
  expName?: string
  fromNode?: string
  condition?: string
  thenPath?: string
  elsePath?: string
  inputs?: DagNodeInput[]
  outputs?: DagNodeOutput[]
  expInputs?: DagExpInput[]
  bindings?: DagBinding[]
  pathLabel?: string
}

interface DagEdge {
  from: string
  to: string
  label: string
  kind: 'sequence' | 'data' | 'condition'
}

function describeSource(src: { kind: string; inputName?: string; nodeId?: string; outputName?: string; value?: unknown }, varToNodeOutput: Map<string, string>): string {
  if (src.kind === 'fromInput') return `input:${src.inputName}`
  if (src.kind === 'fromNode') return `${src.nodeId}.${src.outputName}`
  if (src.kind === 'literal') {
    const v = src.value
    if (v === null) return 'literal:null'
    if (typeof v === 'string') return `literal:"${v.length > 20 ? v.slice(0, 20) + '…' : v}"`
    // Expr 对象 → 可读表达式
    if (typeof v === 'object' && v !== null && 'type' in v && (v as { type: string }).type === 'op') {
      return `expr:${exprToString(v, varToNodeOutput)}`
    }
    return `literal:${JSON.stringify(v)}`
  }
  return '?'
}

/**
 * 将 Expr 对象转换为可读的表达式字符串
 *
 * - op → name(arg1, arg2, ...)
 * - var → nodeId.outputName(解析业务变量名到节点输出引用)或变量名
 * - literal → JSON 值
 * - pipe → source |> stage1 |> stage2(管道语义,evaluate_collection 专用)
 */
function exprToString(expr: unknown, varToNodeOutput: Map<string, string>): string {
  if (expr === null || typeof expr !== 'object') return String(expr)
  const e = expr as { type: string; name?: string; value?: unknown; args?: unknown[]; source?: unknown; stages?: unknown[] }
  if (e.type === 'literal') {
    const v = e.value
    if (typeof v === 'string') return `"${v}"`
    return JSON.stringify(v)
  }
  if (e.type === 'var') {
    // 解析业务变量名到节点输出引用(如 error → probe.error)
    return varToNodeOutput.get(e.name ?? '') ?? e.name ?? '?'
  }
  if (e.type === 'op') {
    const args = (e.args ?? []).map(a => exprToString(a, varToNodeOutput)).join(', ')
    return `${e.name}(${args})`
  }
  if (e.type === 'pipe') {
    // 管道:source |> stage1 |> stage2
    const source = exprToString(e.source, varToNodeOutput)
    const stages = (e.stages ?? []).map((s: unknown) => {
      const stage = s as { op?: string; args?: unknown[] }
      const args = (stage.args ?? []).map(a => exprToString(a, varToNodeOutput)).join(', ')
      return `${stage.op}(${args})`
    })
    return [source, ...stages].join(' |> ')
  }
  return JSON.stringify(expr)
}

/**
 * 构建业务变量名 → 节点输出引用(nodeId.outputName)映射
 *
 * 多个节点写同一业务变量名时,取第一个声明的节点。
 * 这使得表达式中的 var 引用能展示为具体的节点输出,而非抽象的业务变量名或寄存器名。
 */
function buildVarToNodeOutput(xmlExp: XmlExperience): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of xmlExp.nodes) {
    if (node.kind === 'condition') continue
    for (const output of node.outputs) {
      if (!map.has(output.as)) {
        map.set(output.as, `${node.id}.${output.name}`)
      }
    }
  }
  return map
}

/**
 * 从 XmlExperience 提取 DAG 节点和边
 *
 * 节点类型:
 * - start: 虚拟起点,显示经验输入参数
 * - op/experience/condition: 业务节点
 * - end: 路径终点,显示该路径的输出绑定
 * - terminal: 最终虚拟终点(多分支汇聚),无绑定信息
 *
 * 边类型:
 * - sequence: path steps 顺序边(A → B)、START → 入口、路径尾 → END、END → 最终END
 * - data: 节点输入 fromNode 数据依赖边 + 条件变量依赖边
 * - condition: 条件分支边(condition → path 首节点 / 路径END)
 */
export function extractDag(xmlExp: XmlExperience): { nodes: DagNode[]; edges: DagEdge[] } {
  const varToNodeOutput = buildVarToNodeOutput(xmlExp)
  const nodes: DagNode[] = xmlExp.nodes.map(n => {
    if (n.kind === 'op') {
      return {
        id: n.id, kind: 'op', opName: n.opName,
        inputs: n.inputs.map(i => ({ name: i.name, source: describeSource(i.source as { kind: string; inputName?: string; nodeId?: string; outputName?: string; value?: unknown }, varToNodeOutput) })),
        outputs: n.outputs.map(o => ({ name: o.name, as: o.as }))
      }
    }
    if (n.kind === 'experience') {
      return {
        id: n.id, kind: 'experience', expName: n.experienceId,
        inputs: n.inputs.map(i => ({ name: i.name, source: describeSource(i.source as { kind: string; inputName?: string; nodeId?: string; outputName?: string; value?: unknown }, varToNodeOutput) })),
        outputs: n.outputs.map(o => ({ name: o.name, as: o.as }))
      }
    }
    return {
      id: n.id,
      kind: 'condition',
      fromNode: n.fromNode,
      condition: n.condition,
      thenPath: n.thenPath,
      elsePath: n.elsePath
    }
  })

  const edges: DagEdge[] = []
  const extraNodes: DagNode[] = []

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

  // ============== 4. 条件节点边(仅非空路径分支) ==============
  for (const node of xmlExp.nodes) {
    if (node.kind !== 'condition') continue

    // 4a. 条件变量依赖边:解析 fromNode "nodeId.outputName" → 数据依赖边
    if (node.fromNode) {
      const dot = node.fromNode.indexOf('.')
      const condSrcNodeId = dot >= 0 ? node.fromNode.substring(0, dot) : node.fromNode
      const condSrcOutputName = dot >= 0 ? node.fromNode.substring(dot + 1) : ''
      if (condSrcNodeId) {
        edges.push({
          from: condSrcNodeId,
          to: node.id,
          label: `${condSrcOutputName}?`,
          kind: 'data'
        })
      }
    }

    // 4b. then 分支边(仅非空路径;空路径在 section 7 处理)
    const thenPath = xmlExp.paths.find(p => p.id === node.thenPath)
    if (thenPath && thenPath.steps.length > 0) {
      edges.push({
        from: node.id,
        to: thenPath.steps[0].node,
        label: 'then',
        kind: 'condition'
      })
    }

    // 4c. else 分支边(仅非空路径;空路径在 section 7 处理)
    const elsePath = xmlExp.paths.find(p => p.id === node.elsePath)
    if (elsePath && elsePath.steps.length > 0) {
      edges.push({
        from: node.id,
        to: elsePath.steps[0].node,
        label: 'else',
        kind: 'condition'
      })
    }
  }

  // ============== 5. START 节点 ==============
  extraNodes.push({
    id: '__start',
    kind: 'start',
    expInputs: xmlExp.inputs.map(i => ({ name: i.name, type: i.type, required: i.required }))
  })

  // START → 所有无前驱的节点
  const hasPred = new Set<string>()
  for (const e of edges) hasPred.add(e.to)
  for (const n of xmlExp.nodes) {
    if (!hasPred.has(n.id)) {
      edges.push({ from: '__start', to: n.id, label: '', kind: 'sequence' })
    }
  }

  // ============== 6. 路径 END 节点(显示输出绑定) ==============
  const hasConditions = xmlExp.nodes.some(n => n.kind === 'condition')
  const pathEndIds: string[] = []

  // 辅助:nodeId → 该节点所在 pathId
  const nodeToPath = new Map<string, string>()
  for (const path of xmlExp.paths) {
    for (const step of path.steps) {
      nodeToPath.set(step.node, path.id)
    }
  }

  // 辅助:获取 binding.fromNode 对应的寄存器名
  function getBindingRegister(fromNode: string): string | undefined {
    const dot = fromNode.indexOf('.')
    const nodeId = dot >= 0 ? fromNode.substring(0, dot) : fromNode
    const outputName = dot >= 0 ? fromNode.substring(dot + 1) : ''
    const node = xmlExp.nodes.find(n => n.id === nodeId)
    if (node && (node.kind === 'op' || node.kind === 'experience')) {
      return node.outputs.find(o => o.name === outputName)?.as
    }
    return undefined
  }

  for (const path of xmlExp.paths) {
    const endId = `__end_${path.id}`
    pathEndIds.push(endId)

    // 确定此路径的输出绑定
    const thisPathNodeIds = new Set(path.steps.map(s => s.node))
    const bindings: DagBinding[] = []

    for (const b of xmlExp.outputBindings) {
      const dot = b.fromNode.indexOf('.')
      const fromNodeId = dot >= 0 ? b.fromNode.substring(0, dot) : b.fromNode

      if (thisPathNodeIds.has(fromNodeId)) {
        // fromNode 在此路径中 → 直接显示
        bindings.push({ name: b.name, fromNode: b.fromNode, type: b.type })
      } else {
        // fromNode 在其他路径或是预处理节点 → 查找此路径中写同一寄存器的节点
        const bindingReg = getBindingRegister(b.fromNode)
        if (bindingReg) {
          let foundLocal = false
          for (const pathNodeId of thisPathNodeIds) {
            const pathNode = xmlExp.nodes.find(n => n.id === pathNodeId)
            if (pathNode && (pathNode.kind === 'op' || pathNode.kind === 'experience')) {
              const matchingOutput = pathNode.outputs.find(o => o.as === bindingReg)
              if (matchingOutput) {
                bindings.push({ name: b.name, fromNode: `${pathNodeId}.${matchingOutput.name}`, type: b.type })
                foundLocal = true
                break
              }
            }
          }
          if (!foundLocal) {
            // 此路径无等价来源,显示原始 fromNode(预处理来源)
            bindings.push({ name: b.name, fromNode: b.fromNode, type: b.type })
          }
        } else {
          bindings.push({ name: b.name, fromNode: b.fromNode, type: b.type })
        }
      }
    }

    extraNodes.push({
      id: endId,
      kind: 'end',
      pathLabel: path.id,
      bindings
    })

    // 路径末步 → 路径END
    if (path.steps.length > 0) {
      const lastStep = path.steps[path.steps.length - 1].node
      edges.push({ from: lastStep, to: endId, label: '', kind: 'sequence' })
    }
  }

  // ============== 7. 条件空路径分支 → 路径END ==============
  for (const node of xmlExp.nodes) {
    if (node.kind !== 'condition') continue

    const thenPath = xmlExp.paths.find(p => p.id === node.thenPath)
    if (thenPath && thenPath.steps.length === 0) {
      edges.push({ from: node.id, to: `__end_${thenPath.id}`, label: 'then', kind: 'condition' })
    }

    const elsePath = xmlExp.paths.find(p => p.id === node.elsePath)
    if (elsePath && elsePath.steps.length === 0) {
      edges.push({ from: node.id, to: `__end_${elsePath.id}`, label: 'else', kind: 'condition' })
    }
  }

  // ============== 8. 最终虚拟END(仅多分支) ==============
  if (hasConditions && pathEndIds.length > 1) {
    const finalEndId = '__end_final'
    extraNodes.push({ id: finalEndId, kind: 'terminal' })
    for (const endId of pathEndIds) {
      edges.push({ from: endId, to: finalEndId, label: '', kind: 'sequence' })
    }
  }

  return { nodes: [...nodes, ...extraNodes], edges }
}
