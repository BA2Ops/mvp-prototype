/**
 * XML→L3 编译器(F1.4)
 *
 * 将受限子集 XML 编译为 L3 Experience 对象。
 *
 * 编译映射规则(doc 18 §二):
 *   节点 = 对现有经验的引用 + 参数来源 → 经验内 steps 的实例化 + sidecar 装载
 *   顺序界定 → pre_processing 归属 / target steps 依赖序
 *   参数连接(A.x → B.y) → 寄存器分配、inputs/outputs 地址绑定
 *   字面量参数值 → sidecar move 装载
 *   分支条件 = 上游输出参数 → 条件表达式构造 + 分支骨架(cskip/skip)
 *   汇聚参数意图 → 各分支落点与收尾绑定
 *   受控回环 → 递归自嵌套结构 + 终止 judgment
 *
 * @see tasks/phase-f1/README.md F1.4
 * @see docs/mvp/18-xml-to-l3-compiler.md §二
 */

import type { Value } from '../../src/l1/types.js'
import type { Expr } from '../../src/l2/builtins/evaluate-expr.js'
import { ERROR_REGISTER } from '../../src/l2/errors.js'
import type {
  Experience,
  ParamRef,
  ParamSpec,
  PreProcessing,
  ConditionalJudgment,
  TargetOp,
  TargetOpPath,
  OpStep,
  OutputBinding
} from '../../src/l3/experience.js'
import type {
  XmlExperience,
  XmlNode,
  ParamSource,
  XmlOutputBinding
} from './xml-schema.js'
import type { ValidationResult } from './xml-validator.js'
import { validateXmlExperience } from './xml-validator.js'

// ============== 编译结果 ==============

export interface CompileResult {
  success: boolean
  experience?: Experience
  errors: CompileError[]
}

export interface CompileError {
  message: string
  nodeIds?: string[]
}

// ============== 辅助:Expr 构造 ==============

/** 字面量 Expr 节点 */
const lit = (value: Value): Expr => ({ type: 'literal', value: value as never })

/** 寄存器引用 Expr 节点 */
const reg = (name: string): Expr => ({ type: 'var', name })

/** op 节点 */
const op = (name: string, ...args: Expr[]): Expr =>
  ({ type: 'op', name: name as never, args })

/** error_code($r_err) == code */
const errCodeIs = (code: string): Expr =>
  op('==', op('error_code', reg(ERROR_REGISTER)), lit(code))

/** is_null($r_err) — 上一步无错误 */
const noError = (): Expr => op('is_null', reg(ERROR_REGISTER))

/** 通用错误输出声明 */
const errOut = { error: { kind: 'register' as const, name: ERROR_REGISTER } }

// ============== 辅助:ParamSource → ParamRef ==============

/**
 * 将 XML 参数来源转换为 L3 ParamRef
 */
function sourceToParamRef(source: ParamSource): ParamRef {
  if (source.kind === 'fromInput') {
    return { kind: 'input', name: source.inputName }
  }
  if (source.kind === 'fromNode') {
    // 从上游节点输出 → 业务变量引用
    // 需要查找上游节点的 outputs 中 outputName 对应的 as 值
    // 这里先返回 register 引用,具体名称在编译时通过 nodeMap 解析
    return { kind: 'register', name: `__PENDING__${source.nodeId}.${source.outputName}` }
  }
  // literal
  return { kind: 'literal', value: source.value as Value }
}

// ============== 辅助:节点输出映射 ==============

/**
 * 构建节点输出映射:nodeId.outputName → 业务变量名($r_<as>)
 */
function buildOutputMap(exp: XmlExperience): Map<string, string> {
  const map = new Map<string, string>()

  for (const node of exp.nodes) {
    if (node.kind === 'condition') continue

    for (const output of node.outputs) {
      // 输出绑定:output.name → output.as(业务变量名)
      const key = `${node.id}.${output.name}`
      map.set(key, output.as)
    }

    // 错误输出:nodeId.error → $r_err
    map.set(`${node.id}.error`, ERROR_REGISTER)
  }

  return map
}

/**
 * 解析 ParamRef 中的 __PENDING__ 占位符,替换为实际业务变量名
 */
function resolveParamRef(ref: ParamRef, outputMap: Map<string, string>): ParamRef {
  if (ref.kind === 'register' && ref.name.startsWith('__PENDING__')) {
    const key = ref.name.slice('__PENDING__'.length)
    const resolved = outputMap.get(key)
    if (resolved) {
      return { kind: 'register', name: resolved }
    }
    // 未找到映射,保持原样(后续校验会捕获)
    return { kind: 'register', name: ref.name }
  }
  return ref
}

/**
 * 解析 OpStep 中的所有 ParamRef
 */
function resolveStepInputs(
  inputs: Record<string, ParamRef>,
  outputMap: Map<string, string>
): Record<string, ParamRef> {
  const resolved: Record<string, ParamRef> = {}
  for (const [key, ref] of Object.entries(inputs)) {
    resolved[key] = resolveParamRef(ref, outputMap)
  }
  return resolved
}

// ============== 辅助:节点分类 ==============

/**
 * 节点分类:
 * - 出现在某条 path 的 steps 中 → target 节点(在该 path 内执行)
 * - 未出现在任何 path 的 steps 中 → pre_processing 节点(前置数据收集)
 * - condition 节点 → 条件判断节点
 */
function classifyNodes(exp: XmlExperience): {
  preNodes: XmlNode[]
  targetNodes: XmlNode[]
  conditionNodes: XmlNode[]
} {
  const preNodes: XmlNode[] = []
  const targetNodes: XmlNode[] = []
  const conditionNodes: XmlNode[] = []

  // 收集所有 path 中引用的节点 ID
  const pathNodeIds = new Set<string>()
  for (const path of exp.paths) {
    for (const step of path.steps) {
      pathNodeIds.add(step.node)
    }
  }

  for (const node of exp.nodes) {
    if (node.kind === 'condition') {
      conditionNodes.push(node)
      continue
    }

    // 出现在 path steps 中的节点 → target 节点
    // 未出现在任何 path 中的节点 → pre_processing 节点
    if (pathNodeIds.has(node.id)) {
      targetNodes.push(node)
    } else {
      preNodes.push(node)
    }
  }

  return { preNodes, targetNodes, conditionNodes }
}

// ============== 编译:pre_processing ==============

/**
 * 将前置节点编译为 PreProcessing[]
 */
function compilePreProcessing(nodes: XmlNode[], outputMap: Map<string, string>): PreProcessing[] {
  const result: PreProcessing[] = []

  for (const node of nodes) {
    if (node.kind === 'condition') continue

    const inputs: Record<string, ParamRef> = {}
    for (const input of node.inputs) {
      inputs[input.name] = resolveParamRef(sourceToParamRef(input.source), outputMap)
    }

    const outputs: Record<string, ParamRef> = {}
    for (const output of node.outputs) {
      outputs[output.name] = { kind: 'register', name: output.as }
    }
    // 错误输出
    outputs.error = { kind: 'register', name: ERROR_REGISTER }

    result.push({
      id: node.id,
      operation: node.kind === 'op' ? node.opName : node.experienceId,
      inputs,
      outputs,
      skip_threshold: 0
    })
  }

  return result
}

// ============== 编译:conditional_judgment ==============

/**
 * 将条件节点编译为 ConditionalJudgment[]
 */
function compileJudgments(
  conditions: XmlNode[],
  exp: XmlExperience
): ConditionalJudgment[] {
  const result: ConditionalJudgment[] = []

  for (const node of conditions) {
    if (node.kind !== 'condition') continue

    // 构造条件表达式
    let conditionExpr: Expr
    if (node.condition === 'truthy') {
      // varName 为真时走 thenPath
      conditionExpr = op('is_truthy', reg(node.varName))
    } else {
      // varName 为假时走 thenPath(即 is_truthy 为真时走 elsePath)
      // 取反:then/else 交换
      conditionExpr = op('not', op('is_truthy', reg(node.varName)))
    }

    result.push({
      id: node.id,
      trigger: { condition_expr: conditionExpr },
      then_path: node.thenPath,
      else_path: node.elsePath
    })
  }

  return result
}

// ============== 编译:target_op ==============

/**
 * 将路径定义编译为 TargetOp
 */
function compileTargetOp(
  exp: XmlExperience,
  targetNodes: XmlNode[],
  outputMap: Map<string, string>
): TargetOp {
  const paths: TargetOpPath[] = []

  for (const path of exp.paths) {
    const steps: OpStep[] = []

    for (const pathStep of path.steps) {
      const node = exp.nodes.find(n => n.id === pathStep.node)
      if (!node) continue
      if (node.kind === 'condition') continue

      const inputs: Record<string, ParamRef> = {}
      for (const input of node.inputs) {
        inputs[input.name] = resolveParamRef(sourceToParamRef(input.source), outputMap)
      }

      const outputs: Record<string, ParamRef> = {}
      for (const output of node.outputs) {
        outputs[output.name] = { kind: 'register', name: output.as }
      }
      outputs.error = { kind: 'register', name: ERROR_REGISTER }

      steps.push({
        operation: node.kind === 'op' ? node.opName : node.experienceId,
        inputs,
        outputs
      })
    }

    paths.push({
      id: path.id,
      description: path.description,
      response: path.response,
      steps
    })
  }

  // 确定 base_op:第一个路径的第一个 step 的 operation
  const firstPath = paths[0]
  const firstStep = firstPath?.steps[0]
  const baseOp = firstStep?.operation ?? 'evaluate_expr'

  // default_path:第一个路径 ID(若无条件节点)或条件节点的 elsePath
  const conditionNode = exp.nodes.find(n => n.kind === 'condition')
  const defaultPath = conditionNode
    ? (conditionNode as { elsePath: string }).elsePath
    : (paths[0]?.id ?? 'normal')

  return {
    base_op: baseOp,
    paths,
    default_path: defaultPath
  }
}

// ============== 编译:outputs_bindings ==============

/**
 * 将 XML 输出绑定编译为 L3 OutputBinding
 */
function compileOutputBindings(
  bindings: XmlOutputBinding[]
): Record<string, OutputBinding> | undefined {
  if (bindings.length === 0) return undefined

  const result: Record<string, OutputBinding> = {}
  for (const b of bindings) {
    result[b.name] = {
      register: b.register,
      type: b.type,
      persist: b.persist,
      description: undefined
    }
  }
  return result
}

// ============== 编译:failure messages ==============

/**
 * 将失败消息编译为 responses.failure
 */
function compileFailureMessages(
  exp: XmlExperience
): { failure?: Record<string, string> } | undefined {
  if (exp.failureMessages.length === 0) return undefined

  const failure: Record<string, string> = {}
  for (const msg of exp.failureMessages) {
    failure[msg.code] = msg.message
  }
  return { failure }
}

// ============== 主编译函数 ==============

/**
 * 将 XmlExperience 编译为 L3 Experience
 *
 * 假设输入已通过 R1-R6 校验。
 */
export function compileXmlToL3(xmlExp: XmlExperience): Experience {
  const outputMap = buildOutputMap(xmlExp)
  const { preNodes, targetNodes, conditionNodes } = classifyNodes(xmlExp)

  // 编译各部分
  const preProcessing = preNodes.length > 0
    ? compilePreProcessing(preNodes, outputMap)
    : undefined

  const conditionalJudgment = conditionNodes.length > 0
    ? compileJudgments(conditionNodes, xmlExp)
    : undefined

  const targetOp = compileTargetOp(xmlExp, targetNodes, outputMap)

  const outputsBindings = compileOutputBindings(xmlExp.outputBindings)
  const responses = compileFailureMessages(xmlExp)

  // 输入参数 schema
  const inputs: Record<string, ParamSpec> = {}
  for (const input of xmlExp.inputs) {
    inputs[input.name] = {
      type: input.type,
      required: input.required,
      description: input.description,
      default: input.default as Value | undefined
    }
  }

  // 输出参数 schema
  const outputs: Record<string, ParamSpec> = {}
  for (const output of xmlExp.outputs) {
    outputs[output.name] = {
      type: output.type,
      required: output.required,
      description: output.description
    }
  }

  const experience: Experience = {
    id: xmlExp.id,
    description: xmlExp.description,
    inputs,
    outputs,
    target_op: targetOp
  }

  if (preProcessing) experience.pre_processing = preProcessing
  if (conditionalJudgment) experience.conditional_judgment = conditionalJudgment
  if (xmlExp.handleError) experience.handleError = true
  if (responses) experience.responses = responses
  if (outputsBindings) experience.outputs_bindings = outputsBindings

  return experience
}

/**
 * 从 XML 文本编译为 L3 Experience(含校验)
 *
 * 流程:
 * 1. 解析 XML 文本
 * 2. Zod schema 校验
 * 3. R1-R6 受限子集校验
 * 4. XML→L3 编译
 */
export function compileXmlTextToL3(xmlText: string): CompileResult {
  // 延迟导入避免循环依赖
  const { parseXml } = require('./xml-parser.js') as typeof import('./xml-parser.js')

  const parseResult = parseXml(xmlText)
  if (!parseResult.success || !parseResult.data) {
    return {
      success: false,
      errors: parseResult.errors.map(e => ({
        message: `XML 解析错误(${e.path}): ${e.message}`
      }))
    }
  }

  const xmlExp = parseResult.data

  // R1-R6 校验
  const validationResult: ValidationResult = validateXmlExperience(xmlExp)
  if (!validationResult.valid) {
    return {
      success: false,
      errors: validationResult.errors.map(e => ({
        message: `${e.rule}: ${e.message}`,
        nodeIds: e.nodeIds
      }))
    }
  }

  // 编译
  try {
    const experience = compileXmlToL3(xmlExp)
    return { success: true, experience, errors: [] }
  } catch (e) {
    return {
      success: false,
      errors: [{
        message: `编译失败: ${e instanceof Error ? e.message : String(e)}`
      }]
    }
  }
}
