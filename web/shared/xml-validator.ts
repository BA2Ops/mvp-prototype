/**
 * 受限子集校验器(F1.3)
 *
 * 对解析后的 XmlExperience 跑 R1-R6 图结构校验。
 *
 * 规则(doc 18 §当前阶段策略):
 *   R1: 条件节点仅允许尾部分支:分支后不得有汇合节点
 *   R2: 树形结构:每节点至多一个前驱(起点除外)
 *   R3: 多条件仅限 else-if 链
 *   R4: 回环仅允许指向经验入口的受控回环
 *   R5: 数据流单来源 + 类型兼容
 *   R6: 条件节点必须恰好关联一个局部变量
 *
 * @see tasks/phase-f1/README.md F1.3
 * @see docs/mvp/18-xml-to-l3-compiler.md §当前阶段策略
 */

import type { XmlExperience, XmlNode } from './xml-schema.js'

// ============== 校验结果 ==============

export interface ValidationError {
  rule: string
  message: string
  nodeIds?: string[]
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

// ============== 辅助:构建节点图 ==============

/**
 * 节点图:节点 ID → 节点对象
 */
interface NodeGraph {
  /** 所有节点 ID → 节点 */
  nodes: Map<string, XmlNode>
  /** 后继关系:节点 ID → 后继节点 ID 列表(按顺序界定和路径推导) */
  successors: Map<string, Set<string>>
  /** 前驱关系:节点 ID → 前驱节点 ID 集合 */
  predecessors: Map<string, Set<string>>
  /** 条件节点 ID → then/else 路径 ID */
  conditions: Map<string, { thenPath: string; elsePath: string }>
  /** 路径 ID → 包含的节点 ID 列表 */
  pathNodes: Map<string, string[]>
}

/**
 * 从 XmlExperience 构建节点图
 */
function buildGraph(exp: XmlExperience): NodeGraph {
  const nodes = new Map<string, XmlNode>()
  const successors = new Map<string, Set<string>>()
  const predecessors = new Map<string, Set<string>>()
  const conditions = new Map<string, { thenPath: string; elsePath: string }>()
  const pathNodes = new Map<string, string[]>()

  // 注册所有节点
  for (const node of exp.nodes) {
    nodes.set(node.id, node)
    successors.set(node.id, new Set())
    predecessors.set(node.id, new Set())
  }

  // 从顺序界定构建后继/前驱关系
  for (const entry of exp.order) {
    if (!nodes.has(entry.node) || !nodes.has(entry.after)) continue
    successors.get(entry.after)!.add(entry.node)
    predecessors.get(entry.node)!.add(entry.after)
  }

  // 从路径步骤推导顺序关系(路径内步骤按顺序执行)
  for (const path of exp.paths) {
    const nodeIds = path.steps.map(s => s.node)
    pathNodes.set(path.id, nodeIds)

    // 路径内连续步骤构成顺序关系
    for (let i = 1; i < nodeIds.length; i++) {
      if (!nodes.has(nodeIds[i]) || !nodes.has(nodeIds[i - 1])) continue
      successors.get(nodeIds[i - 1])!.add(nodeIds[i])
      predecessors.get(nodeIds[i])!.add(nodeIds[i - 1])
    }
  }

  // 从参数连接推导数据依赖关系
  for (const node of exp.nodes) {
    if (node.kind === 'condition') continue
    for (const input of node.inputs) {
      if (input.source.kind === 'fromNode') {
        const srcId = input.source.nodeId
        if (!nodes.has(srcId) || !nodes.has(node.id)) continue
        successors.get(srcId)!.add(node.id)
        predecessors.get(node.id)!.add(srcId)
      }
    }
  }

  // 条件节点
  for (const node of exp.nodes) {
    if (node.kind === 'condition') {
      conditions.set(node.id, { thenPath: node.thenPath, elsePath: node.elsePath })
    }
  }

  return { nodes, successors, predecessors, conditions, pathNodes }
}

// ============== R1: 尾部分支校验 ==============

/**
 * R1: 条件节点仅允许尾部分支
 * 分支后不得有汇合节点(then/else 两条路径不得交汇)
 */
function checkR1(graph: NodeGraph, exp: XmlExperience): ValidationError[] {
  const errors: ValidationError[] = []

  for (const [condId, { thenPath, elsePath }] of graph.conditions) {
    const thenNodes = graph.pathNodes.get(thenPath) ?? []
    const elseNodes = graph.pathNodes.get(elsePath) ?? []

    // 找出 then 和 else 路径的终点节点
    const thenTerminals = findTerminalNodes(thenNodes, graph)
    const elseTerminals = findTerminalNodes(elseNodes, graph)

    // 检查 then 和 else 的终点是否有交集(汇合节点)
    const intersection = [...thenTerminals].filter(n => elseTerminals.has(n))
    if (intersection.length > 0) {
      errors.push({
        rule: 'R1',
        message: `条件节点 "${condId}" 的 then/else 分支在节点 "${intersection.join(', ')}" 汇合,违反尾部分支约束`,
        nodeIds: [condId, ...intersection]
      })
    }
  }

  return errors
}

/**
 * 找出路径中的终止节点(无后继或后继不在路径内)
 */
function findTerminalNodes(pathNodeIds: string[], graph: NodeGraph): Set<string> {
  const pathSet = new Set(pathNodeIds)
  const terminals = new Set<string>()

  for (const nodeId of pathNodeIds) {
    const succs = graph.successors.get(nodeId) ?? new Set()
    const hasSuccessorInPath = [...succs].some(s => pathSet.has(s))
    if (!hasSuccessorInPath) {
      terminals.add(nodeId)
    }
  }

  return terminals
}

// ============== R2: 树形结构校验 ==============

/**
 * R2: 树形结构,每节点至多一个前驱(起点除外)
 */
function checkR2(graph: NodeGraph, exp: XmlExperience): ValidationError[] {
  const errors: ValidationError[] = []

  for (const [nodeId, preds] of graph.predecessors) {
    if (preds.size > 1) {
      errors.push({
        rule: 'R2',
        message: `节点 "${nodeId}" 有 ${preds.size} 个前驱(${[...preds].join(', ')}),违反树形结构约束(每节点至多一个前驱)`,
        nodeIds: [nodeId, ...preds]
      })
    }
  }

  return errors
}

// ============== R3: else-if 链校验 ==============

/**
 * R3: 多条件仅限 else-if 链
 * 条件节点的 then/else 路径中,else 路径可以包含另一个条件节点(形成 else-if 链),
 * 但 then 路径不得再分叉条件。
 */
function checkR3(graph: NodeGraph, exp: XmlExperience): ValidationError[] {
  const errors: ValidationError[] = []

  for (const [condId, { thenPath, elsePath }] of graph.conditions) {
    const thenNodes = graph.pathNodes.get(thenPath) ?? []

    // then 路径中不得包含条件节点
    for (const nodeId of thenNodes) {
      const node = graph.nodes.get(nodeId)
      if (node && node.kind === 'condition') {
        errors.push({
          rule: 'R3',
          message: `条件节点 "${condId}" 的 then 路径 "${thenPath}" 包含另一个条件节点 "${nodeId}",违反 else-if 链约束(then 路径不得再分叉条件)`,
          nodeIds: [condId, nodeId]
        })
      }
    }
  }

  return errors
}

// ============== R4: 受控回环校验 ==============

/**
 * R4: 回环仅允许指向经验入口的受控回环
 * 检查是否有回边,且回边目标必须是入口节点(无前驱的节点)
 */
function checkR4(graph: NodeGraph, exp: XmlExperience): ValidationError[] {
  const errors: ValidationError[] = []

  // 找出入口节点(无前驱)
  const entryNodes = new Set<string>()
  for (const [nodeId, preds] of graph.predecessors) {
    if (preds.size === 0) {
      entryNodes.add(nodeId)
    }
  }

  // 检测环(DFS)
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const cycleNodes = new Set<string>()

  function dfs(nodeId: string): boolean {
    visited.add(nodeId)
    inStack.add(nodeId)

    const succs = graph.successors.get(nodeId) ?? new Set()
    for (const succ of succs) {
      if (inStack.has(succ)) {
        // 发现环
        cycleNodes.add(succ)
        cycleNodes.add(nodeId)
        return true
      }
      if (!visited.has(succ)) {
        if (dfs(succ)) {
          cycleNodes.add(nodeId)
          return true
        }
      }
    }

    inStack.delete(nodeId)
    return false
  }

  for (const nodeId of graph.nodes.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId)
    }
  }

  // 如果有环,检查环是否是受控回环(回边指向入口节点)
  if (cycleNodes.size > 0) {
    // 找出回边(从某节点指向已在栈中的节点)
    for (const nodeId of cycleNodes) {
      const succs = graph.successors.get(nodeId) ?? new Set()
      for (const succ of succs) {
        if (cycleNodes.has(succ) && !entryNodes.has(succ)) {
          errors.push({
            rule: 'R4',
            message: `检测到回环,但回边 "${nodeId}" → "${succ}" 的目标不是入口节点,违反受控回环约束`,
            nodeIds: [nodeId, succ]
          })
        }
      }
    }
  }

  return errors
}

// ============== R5: 数据流单来源 + 类型兼容 ==============

/**
 * R5: 数据流单来源 + 类型兼容
 * 每个输入参数至多连接一个输出端口(无多路复用歧义)
 */
function checkR5(graph: NodeGraph, exp: XmlExperience): ValidationError[] {
  const errors: ValidationError[] = []

  // 检查每个节点的每个输入参数是否只有一个来源
  for (const node of exp.nodes) {
    if (node.kind === 'condition') continue

    // 收集每个输入参数的来源
    const inputSources = new Map<string, string[]>()

    for (const input of node.inputs) {
      if (input.source.kind === 'fromNode') {
        const sourceKey = `${input.source.nodeId}.${input.source.outputName}`
        const existing = inputSources.get(input.name) ?? []
        existing.push(sourceKey)
        inputSources.set(input.name, existing)
      }
    }

    // 检查是否有多个来源连接到同一输入参数
    for (const [paramName, sources] of inputSources) {
      if (sources.length > 1) {
        errors.push({
          rule: 'R5',
          message: `节点 "${node.id}" 的输入参数 "${paramName}" 有 ${sources.length} 个来源(${sources.join(', ')}),违反单来源约束`,
          nodeIds: [node.id]
        })
      }
    }
  }

  // 检查引用的节点和输出端口是否存在
  for (const node of exp.nodes) {
    if (node.kind === 'condition') continue

    for (const input of node.inputs) {
      const src = input.source
      if (src.kind !== 'fromNode') continue
      const srcNode = graph.nodes.get(src.nodeId)
      if (!srcNode) {
        errors.push({
          rule: 'R5',
          message: `节点 "${node.id}" 的输入参数 "${input.name}" 引用了不存在的节点 "${src.nodeId}"`,
          nodeIds: [node.id]
        })
        continue
      }

      // 检查输出端口是否存在
      if (srcNode.kind === 'op' || srcNode.kind === 'experience') {
        const hasOutput = srcNode.outputs.some(o => o.name === src.outputName)
        if (!hasOutput && src.outputName !== 'error') {
          errors.push({
            rule: 'R5',
            message: `节点 "${node.id}" 的输入参数 "${input.name}" 引用了节点 "${src.nodeId}" 的不存在的输出端口 "${src.outputName}"`,
            nodeIds: [node.id, src.nodeId]
          })
        }
      }
    }
  }

  return errors
}

// ============== R6: 条件节点单变量判断 ==============

/**
 * R6: 条件节点必须引用一个有效的节点输出(fromNode)
 */
function checkR6(graph: NodeGraph, exp: XmlExperience): ValidationError[] {
  const errors: ValidationError[] = []

  for (const node of exp.nodes) {
    if (node.kind !== 'condition') continue

    // 检查 fromNode 是否存在
    if (!node.fromNode || node.fromNode.trim() === '') {
      errors.push({
        rule: 'R6',
        message: `条件节点 "${node.id}" 未引用任何节点输出(fromNode)`,
        nodeIds: [node.id]
      })
      continue
    }

    // 解析 fromNode: "nodeId.outputName"
    const dot = node.fromNode.indexOf('.')
    const nodeId = dot >= 0 ? node.fromNode.substring(0, dot) : node.fromNode
    const outputName = dot >= 0 ? node.fromNode.substring(dot + 1) : ''

    // 检查引用的节点是否存在
    const srcNode = graph.nodes.get(nodeId)
    if (!srcNode) {
      errors.push({
        rule: 'R6',
        message: `条件节点 "${node.id}" 引用了不存在的节点 "${nodeId}"`,
        nodeIds: [node.id]
      })
      continue
    }

    // 检查输出端口是否存在
    if (srcNode.kind === 'op' || srcNode.kind === 'experience') {
      const hasOutput = srcNode.outputs.some(o => o.name === outputName)
      if (!hasOutput && outputName !== 'error') {
        errors.push({
          rule: 'R6',
          message: `条件节点 "${node.id}" 引用了节点 "${nodeId}" 的不存在的输出端口 "${outputName}"`,
          nodeIds: [node.id, nodeId]
        })
      }
    }
  }

  return errors
}

// ============== 主校验函数 ==============

/**
 * 校验 XmlExperience 是否符合受限子集规则 R1-R6
 */
export function validateXmlExperience(exp: XmlExperience): ValidationResult {
  const graph = buildGraph(exp)

  const errors: ValidationError[] = [
    ...checkR1(graph, exp),
    ...checkR2(graph, exp),
    ...checkR3(graph, exp),
    ...checkR4(graph, exp),
    ...checkR5(graph, exp),
    ...checkR6(graph, exp)
  ]

  return {
    valid: errors.length === 0,
    errors
  }
}
