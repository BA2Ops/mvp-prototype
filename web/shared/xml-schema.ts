/**
 * XML 中间定义 Schema(F1.1)
 *
 * 用 Zod 定义经验 XML 中间定义的完整 schema。
 * 用户/LLM 编辑 XML(业务语义),不接触 L3 JSON(执行细节)。
 *
 * @see docs/mvp/15-experience-visualization.md §3
 * @see docs/mvp/18-xml-to-l3-compiler.md
 * @see tasks/phase-f1/README.md F1.1
 */

import { z } from 'zod'

// ============== 基础类型 ==============

/** 参数类型(与 ParamSpec.type 对齐) */
export const ValueTypeSchema = z.enum([
  'string', 'number', 'boolean', 'path', 'object', 'any'
])
export type ValueType = z.infer<typeof ValueTypeSchema>

/** 副作用声明 */
export const SideEffectSchema = z.enum([
  'read-only', 'fs-write', 'exec'
])
export type SideEffect = z.infer<typeof SideEffectSchema>

// ============== 参数来源 ==============

/**
 * 参数来源:三种取值方式
 *
 * - fromInput:  来自经验输入参数
 * - fromNode:    来自上游节点输出
 * - literal:     字面量常量
 */
export const ParamSourceSchema = z.union([
  z.object({
    kind: z.literal('fromInput'),
    inputName: z.string().min(1)
  }),
  z.object({
    kind: z.literal('fromNode'),
    nodeId: z.string().min(1),
    outputName: z.string().min(1)
  }),
  z.object({
    kind: z.literal('literal'),
    value: z.unknown()
  })
])
export type ParamSource = z.infer<typeof ParamSourceSchema>

// ============== 节点 ==============

/** 节点输入参数 */
export const NodeInputSchema = z.object({
  name: z.string().min(1),
  source: ParamSourceSchema
})
export type NodeInput = z.infer<typeof NodeInputSchema>

/** 节点输出参数 */
export const NodeOutputSchema = z.object({
  /** 输出端口名(op formalSpec 的 output businessName) */
  name: z.string().min(1),
  /** 输出绑定到的业务变量名($r_<name>) */
  as: z.string().min(1)
})
export type NodeOutput = z.infer<typeof NodeOutputSchema>

/** op 节点:引用 L2 op */
export const OpNodeSchema = z.object({
  kind: z.literal('op'),
  id: z.string().min(1),
  opName: z.string().min(1),
  inputs: z.array(NodeInputSchema).default([]),
  outputs: z.array(NodeOutputSchema).default([])
})
export type OpNode = z.infer<typeof OpNodeSchema>

/** 经验节点:引用现有 L3 经验(子经验调用) */
export const ExperienceNodeSchema = z.object({
  kind: z.literal('experience'),
  id: z.string().min(1),
  experienceId: z.string().min(1),
  inputs: z.array(NodeInputSchema).default([]),
  outputs: z.array(NodeOutputSchema).default([])
})
export type ExperienceNode = z.infer<typeof ExperienceNodeSchema>

/** 条件节点:业务问题分支(单变量判断) */
export const ConditionNodeSchema = z.object({
  kind: z.literal('condition'),
  id: z.string().min(1),
  /** 关联的局部变量名(来自上游节点输出) */
  varName: z.string().min(1),
  /** 判断条件:真值判断 */
  condition: z.enum(['truthy', 'falsy']).default('truthy'),
  /** 条件为真时走的路径 ID */
  thenPath: z.string().min(1),
  /** 条件为假时走的路径 ID */
  elsePath: z.string().min(1)
})
export type ConditionNode = z.infer<typeof ConditionNodeSchema>

/** 三类节点联合 */
export const XmlNodeSchema = z.discriminatedUnion('kind', [
  OpNodeSchema,
  ExperienceNodeSchema,
  ConditionNodeSchema
])
export type XmlNode = z.infer<typeof XmlNodeSchema>

// ============== 顺序界定 ==============

/** 顺序界定:节点 A 在节点 B 之后 */
export const OrderEntrySchema = z.object({
  node: z.string().min(1),
  after: z.string().min(1)
})
export type OrderEntry = z.infer<typeof OrderEntrySchema>

// ============== 路径 ==============

/** 路径步骤:引用一个节点 */
export const PathStepSchema = z.object({
  node: z.string().min(1)
})
export type PathStep = z.infer<typeof PathStepSchema>

/** 路径定义 */
export const PathSchema = z.object({
  id: z.string().min(1),
  description: z.string().default(''),
  response: z.string().default(''),
  steps: z.array(PathStepSchema).default([])
})
export type XmlPath = z.infer<typeof PathSchema>

// ============== 输入/输出参数声明 ==============

/** 经验输入参数声明 */
export const InputParamSchema = z.object({
  name: z.string().min(1),
  type: ValueTypeSchema,
  required: z.boolean().default(true),
  description: z.string().optional(),
  default: z.unknown().optional()
})
export type InputParam = z.infer<typeof InputParamSchema>

/** 经验输出参数声明 */
export const OutputParamSchema = z.object({
  name: z.string().min(1),
  type: ValueTypeSchema,
  required: z.boolean().default(true),
  description: z.string().optional()
})
export type OutputParam = z.infer<typeof OutputParamSchema>

// ============== 输出绑定 ==============

/** 输出绑定:声明哪个输出持久化到 publicStore */
export const OutputBindingSchema = z.object({
  /** 输出参数名 */
  name: z.string().min(1),
  /** 对应的业务变量名($r_<name>) */
  register: z.string().min(1),
  /** 输出类型 */
  type: ValueTypeSchema,
  /** 是否持久化(默认 false) */
  persist: z.boolean().default(false)
})
export type XmlOutputBinding = z.infer<typeof OutputBindingSchema>

// ============== 失败消息 ==============

/** 失败消息映射:key = 错误码,'*' 为兜底 */
export const FailureMessageSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
})
export type FailureMessage = z.infer<typeof FailureMessageSchema>

// ============== 元数据 ==============

/** 经验元数据 */
export const ExperienceMetadataSchema = z.object({
  tags: z.array(z.string()).default([]),
  category: z.string().default(''),
  sideEffects: SideEffectSchema.default('read-only'),
  version: z.string().default('1.0.0')
})
export type XmlExperienceMetadata = z.infer<typeof ExperienceMetadataSchema>

// ============== 经验顶层 ==============

/** XML 中间定义:完整经验 */
export const XmlExperienceSchema = z.object({
  /** 经验 ID */
  id: z.string().min(1),

  /** 业务描述 */
  description: z.string().min(1),

  /** 输入参数声明 */
  inputs: z.array(InputParamSchema).default([]),

  /** 输出参数声明 */
  outputs: z.array(OutputParamSchema).default([]),

  /** 节点列表(三类节点) */
  nodes: z.array(XmlNodeSchema).default([]),

  /** 顺序界定(可选,默认按节点出现顺序) */
  order: z.array(OrderEntrySchema).default([]),

  /** 路径定义 */
  paths: z.array(PathSchema).default([]),

  /** 输出绑定(可选) */
  outputBindings: z.array(OutputBindingSchema).default([]),

  /** 失败消息映射(可选) */
  failureMessages: z.array(FailureMessageSchema).default([]),

  /** 异常处置标志(默认 false) */
  handleError: z.boolean().default(false),

  /** 元数据 */
  metadata: ExperienceMetadataSchema.optional().transform(v => v ?? {
    tags: [], category: '', sideEffects: 'read-only' as const, version: '1.0.0'
  })
})
export type XmlExperience = z.infer<typeof XmlExperienceSchema>

// ============== 校验辅助 ==============

/**
 * 校验 XML 文本解析结果,返回结构化错误
 */
export interface XmlParseResult {
  success: boolean
  data?: XmlExperience
  errors: XmlParseError[]
}

export interface XmlParseError {
  path: string
  message: string
}

/**
 * 校验 XmlExperience 对象
 */
export function validateXmlExperience(data: unknown): XmlParseResult {
  const result = XmlExperienceSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data, errors: [] }
  }
  const errors = result.error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message
  }))
  return { success: false, errors }
}
