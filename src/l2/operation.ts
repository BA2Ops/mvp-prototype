/**
 * L2 Operation 接口（含形参元数据）
 *
 * @see ../../docs/mvp/06-execution-layer.md §3
 * @see ../../docs/mvp/09-l1-implementation.md §6
 * @see ../../docs/mvp/10-reactive-execution-model.md §二
 *
 * 完整设计：
 * - Operation 必须声明 formalSpec（形参元数据）
 * - 每个 input/output 是独立的寄存器（不共享）
 * - 错误输出使用 $r_err 寄存器
 */

import type { Value } from '../l1/types.js'
import type { OperationError } from './errors.js'

// ============== 形参元数据（业务名 ↔ 寄存器）==============
/**
 * 形参定义（FormalParam）
 *
 * 桥接业务层语义名和 L1 寄存器地址：
 * - businessName：业务层使用的语义名（如 'file_path'）
 * - register：L1 寄存器地址（如 '$r0'，必选）
 */
export interface FormalParam {
  /** 业务语义名（L3/L4 层使用）*/
  businessName: string

  /** L1 寄存器地址（必选，必填）*/
  /**
   * - 正常寄存器：'$r0', '$r1', '$r2',...
   * - 错误寄存器：'$r_err'
   */
  register: string

  /** 参数类型 */
  type: 'string' | 'number' | 'boolean' | 'path' | 'object' | 'any'

  /** 是否必填 */
  required: boolean

  /** 描述（可选）*/
  description?: string
}

/**
 * Operation 的完整形参定义
 *
 * 每个 op 必须声明其 inputs 和 outputs 的形参。
 */
export interface OperationFormalSpec {
  /** 输入形参：业务名 → FormalParam */
  inputs: Record<string, FormalParam>

  /** 输出形参：业务名 → FormalParam */
  outputs: Record<string, FormalParam>
}

// ============== FieldSchema（兼容旧接口）==============
/**
 * 字段 schema 描述（保留用于向后兼容）
 *
 * MVP 阶段主要依赖 formalSpec。FieldSchema 保留作为可选的 schema 描述。
 */
export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'path' | 'object' | 'any'
  required: boolean
  description?: string
}

// ============== Operation 接口 ==============
/**
 * L2 原子操作接口
 *
 * 设计原则：
 * - 简单对象形式（无需类继承）
 * - 必须声明 formalSpec（形参元数据）
 * - execute 接受解析后的输入，返回 outputs（包含可能的 error）
 */
export interface Operation {
  /** operation 唯一名称（如 'file_read'）*/
  name: string

  /** 简短描述 */
  description: string

  /** 形参定义（业务名 ↔ 寄存器映射）*/
  formalSpec: OperationFormalSpec

  /**
   * 执行函数
   * @param inputs 已解析的输入值（来自 internalStore 读取）
   * @returns 输出值（写入 internalStore）
   *
   * 错误处理契约：
   * - 已知错误（可恢复）：返回 { ..., error: OperationError | null }
   *   - error: null 表示成功
   *   - error: OperationError 表示已知错误（已分类）
   * - 硬错误（不可恢复）：throw Error
   *   - 例如：磁盘故障、权限拒绝（未分类）、网络超时等
   */
  execute(inputs: Record<string, Value>): Promise<Record<string, Value>>
}

/**
 * 从 OperationFormalSpec 中查找特定形参
 *
 * @param spec OperationFormalSpec
 * @param direction 'inputs' | 'outputs'
 * @param businessName 业务语义名
 * @returns FormalParam 或 undefined
 */
export function getFormalParam(
  spec: OperationFormalSpec,
  direction: 'inputs' | 'outputs',
  businessName: string
): FormalParam | undefined {
  return spec[direction][businessName]
}

/**
 * 获取 Operation 的所有输入寄存器名
 */
export function getInputRegisters(spec: OperationFormalSpec): string[] {
  return Object.values(spec.inputs).map(p => p.register)
}

/**
 * 获取 Operation 的所有输出寄存器名
 */
export function getOutputRegisters(spec: OperationFormalSpec): string[] {
  return Object.values(spec.outputs).map(p => p.register)
}

/**
 * 获取 Operation 的错误输出形参（如果存在）
 *
 * 错误输出特征：register === '$r_err'
 */
export function getErrorFormalParam(
  spec: OperationFormalSpec
): FormalParam | undefined {
  return Object.values(spec.outputs).find(p => p.register === '$r_err')
}

// ============== 类型导出 ==============
export type { Value, OperationError }