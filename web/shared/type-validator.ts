/**
 * ParamSpec.type 编译期强校验(F2.4)
 *
 * 字面量参数与声明类型矛盾时编译失败。
 *
 * 校验规则:
 * - ParamRef.kind === 'literal' 时,检查 value 类型与 ParamSpec.type 兼容
 * - 类型兼容矩阵:string ← string, number ← number, path ← string, any ← 任意
 * - 不兼容时抛 ParamTypeError
 *
 * @see tasks/phase-f2/README.md F2.4
 */

import type { Value } from '../../src/l1/types.js'
import type { XmlExperience, ParamSource } from './xml-schema.js'

// ============== 类型兼容矩阵 ==============

/**
 * 类型兼容检查:src 类型是否可赋值给 dst 类型
 *
 * 规则:
 * - any 接受任意类型
 * - path 是 string 的子类型(path ← string 兼容)
 * - 其余要求精确匹配
 */
export function isTypeCompatible(dstType: string, srcType: string): boolean {
  if (dstType === 'any') return true
  if (dstType === 'string' && srcType === 'path') return true
  if (dstType === 'string' && srcType === 'string') return true
  if (dstType === 'path' && srcType === 'string') return true  // path 声明接受 string 字面量
  return dstType === srcType
}

/**
 * 推断 JS 值的 ValueType
 */
export function inferValueType(value: unknown): string {
  if (value === null) return 'any'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'object'
  if (typeof value === 'object') return 'object'
  return 'any'
}

// ============== 校验错误 ==============

export interface ParamTypeError {
  nodeId: string
  paramName: string
  expectedType: string
  actualType: string
  message: string
}

export interface TypeValidationResult {
  valid: boolean
  errors: ParamTypeError[]
}

// ============== 校验函数 ==============

/**
 * 校验 XmlExperience 中所有字面量参数的类型兼容性
 *
 * 检查每个 op/experience 节点的 literal 类型输入参数:
 * 1. 如果参数名匹配经验的某个 input,检查 input 的 ParamSpec.type
 * 2. 否则查找该 op 的 formalSpec(如果提供 registry)
 *
 * @param exp XmlExperience
 * @param inputSpecs 经验输入参数的 type 声明(name → type)
 */
export function validateLiteralTypes(
  exp: XmlExperience,
  inputSpecs: Record<string, string> = {}
): TypeValidationResult {
  const errors: ParamTypeError[] = []

  // 构建输入参数类型映射
  const inputTypes = new Map<string, string>()
  for (const input of exp.inputs) {
    inputTypes.set(input.name, input.type)
  }
  // 合并外部传入的 inputSpecs(优先级低)
  for (const [name, type] of Object.entries(inputSpecs)) {
    if (!inputTypes.has(name)) {
      inputTypes.set(name, type)
    }
  }

  for (const node of exp.nodes) {
    if (node.kind === 'condition') continue

    for (const input of node.inputs) {
      const src = input.source
      if (src.kind !== 'literal') continue

      // 字面量值的推断类型
      const actualType = inferValueType(src.value)

      // 查找目标参数的声明类型:
      // 1. 如果参数名是经验输入,用输入的 type
      // 2. 否则跳过(无法校验,因为没有 op formalSpec)
      //    (op formalSpec 校验在 L3 编译时由 compileExperience 完成)
      const declaredType = inputTypes.get(input.name)
      if (!declaredType) continue

      if (!isTypeCompatible(declaredType, actualType)) {
        errors.push({
          nodeId: node.id,
          paramName: input.name,
          expectedType: declaredType,
          actualType,
          message: `节点 "${node.id}" 的参数 "${input.name}" 声明类型为 ${declaredType},但字面量值类型为 ${actualType}`
        })
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
