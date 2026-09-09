/**
 * XML 解析器(F1.2)
 *
 * 使用 fast-xml-parser 解析 XML 文本,通过中间转换层映射到 Zod schema,输出结构化对象。
 * 支持反向序列化(结构化对象 → XML 文本),用于保存。
 *
 * @see tasks/phase-f1/README.md F1.2
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import {
  XmlExperienceSchema,
  validateXmlExperience,
  type XmlExperience,
  type XmlParseResult
} from './xml-schema.js'

// ============== XML 解析器配置 ==============

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '_text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name: string): boolean => {
    // 只有叶子标签(可重复的子元素)标记为数组
    // 容器标签(inputs/outputs/nodes/paths/steps/outputBindings/failureMessages/order/tags)
    // 不标记为数组,因为它们只包含一个子元素数组
    const arrayTags = new Set([
      'param', 'opNode', 'experienceNode', 'conditionNode',
      'input', 'output', 'path', 'step', 'entry',
      'binding', 'message', 'tag'
    ])
    return arrayTags.has(name)
  }
}

const builderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '_text',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true
}

const parser = new XMLParser(parserOptions)
const builder = new XMLBuilder(builderOptions)

// ============== 解析函数 ==============

/**
 * 解析 XML 文本为 XmlExperience 对象
 *
 * @param xmlText XML 文本
 * @returns 解析结果(含校验错误)
 */
export function parseXml(xmlText: string): XmlParseResult {
  try {
    const raw = parser.parse(xmlText)
    // 顶层是 <experience> 标签
    const expRoot = raw.experience ?? raw
    // 转换 fast-xml-parser 输出为 Zod schema 期望的格式
    const transformed = transformParsedXml(expRoot)
    return validateXmlExperience(transformed)
  } catch (e) {
    return {
      success: false,
      errors: [{
        path: '',
        message: `XML 解析失败: ${e instanceof Error ? e.message : String(e)}`
      }]
    }
  }
}

/**
 * 将 XmlExperience 对象序列化为 XML 文本
 *
 * @param exp XmlExperience 对象
 * @returns XML 文本
 */
export function serializeXml(exp: XmlExperience): string {
  const xmlObj = experienceToXmlObject(exp)
  return builder.build(xmlObj)
}

// ============== 中间转换:fast-xml-parser 输出 → Zod schema ==============

/**
 * 布尔属性:空字符串 "" 表示 true(fast-xml-parser 对 boolean 属性的处理)
 */
function xmlBool(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (v === '') return true
  if (v === 'true') return true
  if (v === 'false') return false
  return Boolean(v)
}

/**
 * 确保值是数组(fast-xml-parser 的 isArray 可能未覆盖所有情况)
 */
function asArray(v: unknown): Record<string, unknown>[] {
  if (v === undefined || v === null) return []
  if (Array.isArray(v)) return v as Record<string, unknown>[]
  return [v as Record<string, unknown>]
}

/**
 * 转换节点输入参数来源
 */
function transformInputSource(input: Record<string, unknown>): {
  name: string
  source: { kind: 'fromInput'; inputName: string } | { kind: 'fromNode'; nodeId: string; outputName: string } | { kind: 'literal'; value: unknown }
} {
  const name = String(input.name ?? '')
  const source: { kind: string; inputName?: string; nodeId?: string; outputName?: string; value?: unknown } = { kind: '' }

  if (input.fromInput !== undefined) {
    source.kind = 'fromInput'
    source.inputName = String(input.fromInput)
  } else if (input.fromNode !== undefined) {
    source.kind = 'fromNode'
    const fromNode = String(input.fromNode)
    const dot = fromNode.indexOf('.')
    if (dot >= 0) {
      source.nodeId = fromNode.substring(0, dot)
      source.outputName = fromNode.substring(dot + 1)
    } else {
      source.nodeId = fromNode
      source.outputName = ''
    }
  } else if (input.literal !== undefined) {
    source.kind = 'literal'
    // 尝试解析字面量值
    const lit = input.literal
    if (lit === '' || lit === undefined) {
      source.value = ''
    } else if (typeof lit === 'string') {
      // 尝试 JSON 解析(支持对象/数组/数字/布尔)
      try {
        source.value = JSON.parse(lit)
      } catch {
        source.value = lit
      }
    } else {
      source.value = lit
    }
  } else {
    // 默认:fromInput(兼容无 source 声明的情况)
    source.kind = 'fromInput'
    source.inputName = name
  }

  return { name, source: source as { kind: 'fromInput'; inputName: string } | { kind: 'fromNode'; nodeId: string; outputName: string } | { kind: 'literal'; value: unknown } }
}

/**
 * 转换节点
 */
function transformNode(raw: Record<string, unknown>): Record<string, unknown> | null {
  // raw 可能是 { opNode: [{ ... }] } 形式
  if (raw.opNode !== undefined) {
    const opNodes = asArray(raw.opNode as Record<string, unknown>[])
    const node = opNodes[0]
    if (!node) return null
    return {
      kind: 'op',
      id: String(node.id ?? ''),
      opName: String(node.opName ?? ''),
      inputs: asArray((node.inputs as Record<string, unknown> | undefined)?.input as Record<string, unknown>[]).map(transformInputSource),
      outputs: asArray((node.outputs as Record<string, unknown> | undefined)?.output as Record<string, unknown>[]).map((o: Record<string, unknown>) => ({
        name: String(o.name ?? ''),
        as: String(o.as ?? '')
      }))
    }
  }
  if (raw.experienceNode !== undefined) {
    const expNodes = asArray(raw.experienceNode as Record<string, unknown>[])
    const node = expNodes[0]
    if (!node) return null
    return {
      kind: 'experience',
      id: String(node.id ?? ''),
      experienceId: String(node.experienceId ?? ''),
      inputs: asArray((node.inputs as Record<string, unknown> | undefined)?.input as Record<string, unknown>[]).map(transformInputSource),
      outputs: asArray((node.outputs as Record<string, unknown> | undefined)?.output as Record<string, unknown>[]).map((o: Record<string, unknown>) => ({
        name: String(o.name ?? ''),
        as: String(o.as ?? '')
      }))
    }
  }
  if (raw.conditionNode !== undefined) {
    const condNodes = asArray(raw.conditionNode as Record<string, unknown>[])
    const node = condNodes[0]
    if (!node) return null
    return {
      kind: 'condition',
      id: String(node.id ?? ''),
      varName: String(node.varName ?? ''),
      condition: String(node.condition ?? 'truthy'),
      thenPath: String(node.thenPath ?? ''),
      elsePath: String(node.elsePath ?? '')
    }
  }
  return null
}

/**
 * 转换 fast-xml-parser 输出为 Zod schema 期望的格式
 */
function transformParsedXml(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: String(raw.id ?? ''),
    description: String(raw.description ?? '')
  }

  // 输入参数
  const rawInputs = raw.inputs as Record<string, unknown> | undefined
  if (rawInputs?.param) {
    result.inputs = asArray(rawInputs.param as Record<string, unknown>).map((p: Record<string, unknown>) => ({
      name: String(p.name ?? ''),
      type: String(p.type ?? 'string'),
      required: xmlBool(p.required),
      ...(p.description ? { description: String(p.description) } : {}),
      ...(p.default !== undefined ? { default: p.default } : {})
    }))
  }

  // 输出参数
  const rawOutputs = raw.outputs as Record<string, unknown> | undefined
  if (rawOutputs?.param) {
    result.outputs = asArray(rawOutputs.param as Record<string, unknown>).map((p: Record<string, unknown>) => ({
      name: String(p.name ?? ''),
      type: String(p.type ?? 'string'),
      required: xmlBool(p.required),
      ...(p.description ? { description: String(p.description) } : {})
    }))
  }

  // 节点
  const rawNodes = raw.nodes as Record<string, unknown> | undefined
  if (rawNodes) {
    const nodes: Record<string, unknown>[] = []
    // rawNodes 可能包含 opNode/experienceNode/conditionNode 数组
    for (const [key, value] of Object.entries(rawNodes)) {
      if (key === 'opNode' || key === 'experienceNode' || key === 'conditionNode') {
        const arr = asArray(value)
        for (const nodeRaw of arr) {
          const transformed = transformNode({ [key]: nodeRaw })
          if (transformed) nodes.push(transformed)
        }
      }
    }
    result.nodes = nodes
  }

  // 顺序界定
  const rawOrder = raw.order as Record<string, unknown> | undefined
  if (rawOrder?.entry) {
    result.order = asArray(rawOrder.entry as Record<string, unknown>).map((e: Record<string, unknown>) => ({
      node: String(e.node ?? ''),
      after: String(e.after ?? '')
    }))
  }

  // 路径
  const rawPaths = raw.paths as Record<string, unknown> | undefined
  if (rawPaths?.path) {
    result.paths = asArray(rawPaths.path as Record<string, unknown>).map((p: Record<string, unknown>) => {
      const path: Record<string, unknown> = {
        id: String(p.id ?? ''),
        description: String(p.description ?? ''),
        response: String(p.response ?? '')
      }
      const rawSteps = p.steps as Record<string, unknown> | undefined
      if (rawSteps?.step) {
        path.steps = asArray(rawSteps.step as Record<string, unknown>).map((s: Record<string, unknown>) => ({
          node: String(s.node ?? '')
        }))
      } else {
        path.steps = []
      }
      return path
    })
  }

  // 输出绑定
  const rawBindings = raw.outputBindings as Record<string, unknown> | undefined
  if (rawBindings?.binding) {
    result.outputBindings = asArray(rawBindings.binding as Record<string, unknown>).map((b: Record<string, unknown>) => ({
      name: String(b.name ?? ''),
      fromNode: String(b.fromNode ?? ''),
      type: String(b.type ?? 'string'),
      persist: xmlBool(b.persist)
    }))
  }

  // 失败消息
  const rawFailures = raw.failureMessages as Record<string, unknown> | undefined
  if (rawFailures?.message) {
    result.failureMessages = asArray(rawFailures.message as Record<string, unknown>).map((m: Record<string, unknown>) => ({
      code: String(m.code ?? ''),
      message: String(m.message ?? '')
    }))
  }

  // 异常处置
  if (raw.handleError !== undefined) {
    result.handleError = xmlBool(raw.handleError)
  }

  // 元数据
  const rawMeta = raw.metadata as Record<string, unknown> | undefined
  if (rawMeta) {
    result.metadata = {
      tags: asArray((rawMeta.tags as Record<string, unknown> | undefined)?.tag as string | string[]).map(String),
      category: String(rawMeta.category ?? ''),
      sideEffects: String(rawMeta.sideEffects ?? 'read-only'),
      version: String(rawMeta.version ?? '1.0.0')
    }
  }

  return result
}

// ============== 内部转换:XmlExperience → XML 对象 ==============

/**
 * 将 XmlExperience 转换为 fast-xml-builder 可用的对象结构
 */
function experienceToXmlObject(exp: XmlExperience): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    experience: {
      id: exp.id,
      description: exp.description
    }
  }

  const expObj = obj.experience as Record<string, unknown>

  // 输入参数
  if (exp.inputs.length > 0) {
    expObj.inputs = {
      param: exp.inputs.map(p => ({
        name: p.name,
        type: p.type,
        required: p.required ? '' : undefined,
        ...(p.description ? { description: p.description } : {}),
        ...(p.default !== undefined ? { default: String(p.default) } : {})
      }))
    }
  }

  // 输出参数
  if (exp.outputs.length > 0) {
    expObj.outputs = {
      param: exp.outputs.map(p => ({
        name: p.name,
        type: p.type,
        required: p.required ? '' : undefined,
        ...(p.description ? { description: p.description } : {})
      }))
    }
  }

  // 节点(按类型分组,放在一个 <nodes> 标签中)
  if (exp.nodes.length > 0) {
    const nodesObj: Record<string, unknown> = {}
    const opNodes: Record<string, unknown>[] = []
    const expNodes: Record<string, unknown>[] = []
    const condNodes: Record<string, unknown>[] = []
    for (const node of exp.nodes) {
      const xmlNode = nodeToXmlObject(node)
      if (node.kind === 'op') opNodes.push(xmlNode.opNode as Record<string, unknown>)
      else if (node.kind === 'experience') expNodes.push(xmlNode.experienceNode as Record<string, unknown>)
      else condNodes.push(xmlNode.conditionNode as Record<string, unknown>)
    }
    if (opNodes.length > 0) nodesObj.opNode = opNodes
    if (expNodes.length > 0) nodesObj.experienceNode = expNodes
    if (condNodes.length > 0) nodesObj.conditionNode = condNodes
    expObj.nodes = nodesObj
  }

  // 顺序界定
  if (exp.order.length > 0) {
    expObj.order = {
      entry: exp.order.map(o => ({ node: o.node, after: o.after }))
    }
  }

  // 路径
  if (exp.paths.length > 0) {
    expObj.paths = {
      path: exp.paths.map(p => ({
        id: p.id,
        description: p.description,
        response: p.response,
        steps: p.steps.length > 0 ? { step: p.steps.map(s => ({ node: s.node })) } : undefined
      }))
    }
  }

  // 输出绑定
  if (exp.outputBindings.length > 0) {
    expObj.outputBindings = {
      binding: exp.outputBindings.map(b => ({
        name: b.name,
        fromNode: b.fromNode,
        type: b.type,
        persist: b.persist ? '' : undefined
      }))
    }
  }

  // 失败消息
  if (exp.failureMessages.length > 0) {
    expObj.failureMessages = {
      message: exp.failureMessages.map(m => ({
        code: m.code,
        message: m.message
      }))
    }
  }

  // 异常处置
  if (exp.handleError) {
    expObj.handleError = 'true'
  }

  // 元数据
  if (exp.metadata) {
    expObj.metadata = {
      tags: exp.metadata.tags.length > 0 ? { tag: exp.metadata.tags } : undefined,
      category: exp.metadata.category || undefined,
      sideEffects: exp.metadata.sideEffects,
      version: exp.metadata.version
    }
  }

  return obj
}

/**
 * 将节点对象转换为 XML 对象
 */
function nodeToXmlObject(node: XmlExperience['nodes'][number]): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: node.id
  }

  if (node.kind === 'op') {
    base.opName = node.opName
    if (node.inputs.length > 0) {
      base.inputs = { input: node.inputs.map(inputToXmlObject) }
    }
    if (node.outputs.length > 0) {
      base.outputs = { output: node.outputs.map(outputToXmlObject) }
    }
    return { opNode: base }
  }

  if (node.kind === 'experience') {
    base.experienceId = node.experienceId
    if (node.inputs.length > 0) {
      base.inputs = { input: node.inputs.map(inputToXmlObject) }
    }
    if (node.outputs.length > 0) {
      base.outputs = { output: node.outputs.map(outputToXmlObject) }
    }
    return { experienceNode: base }
  }

  // condition
  base.varName = node.varName
  base.condition = node.condition
  base.thenPath = node.thenPath
  base.elsePath = node.elsePath
  return { conditionNode: base }
}

function inputToXmlObject(input: { name: string; source: unknown }): Record<string, unknown> {
  const obj: Record<string, unknown> = { name: input.name }
  const src = input.source as { kind: string; inputName?: string; nodeId?: string; outputName?: string; value?: unknown }

  if (src.kind === 'fromInput') {
    obj.fromInput = src.inputName
  } else if (src.kind === 'fromNode') {
    obj.fromNode = `${src.nodeId}.${src.outputName}`
  } else if (src.kind === 'literal') {
    obj.literal = src.value === undefined ? '' : String(src.value)
  }

  return obj
}

function outputToXmlObject(output: { name: string; as: string }): Record<string, unknown> {
  return { name: output.name, as: output.as }
}

// ============== 类型导出 ==============

export type { XmlExperience, XmlParseResult } from './xml-schema.js'
