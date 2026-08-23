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
import type { ExecutionState } from '../l1/execution-state.js'
import type { OperationError } from './errors.js'

// ============== 形参元数据（业务名 ↔ 寄存器）==============
/**
 * 形参定义（FormalParam）
 *
 * 桥接业务层语义名和 L1 寄存器地址：
 * - businessName：业务层使用的语义名（如 'file_path'）
 * - slotIndex：CRR P1+ 必填。op formalSpec 内部的位置索引 (0..M_max-1 for inputs,
 *              0..P_max-1 for outputs)。错误 alias 用 ERROR_SLOT_INDEX sentinel (=99)。
 *              compiler new path 通过 slotIndex + currentScope() 构造 $S<scope>.in<k>/.out<k>。
 * - register：legacy 字段名（必填，synced with slotIndex）。
 *              - 正常寄存器：'$r0', '$r1', '$r2',...
 *              - 错误寄存器：'$r_err'
 *              - 新路径编译产物该字段为 $S<scopeId>.in<k> / .out<k> / $err
 *
 * @deprecated register 字段 P4 末删除；新代码请用 slotIndex
 */
export interface FormalParam {
  /** 业务语义名（L3/L4 层使用）*/
  businessName: string

  /** L1 寄存器地址（legacy,与 slotIndex 同步；P4 末删除）*/
  register: string

  /**
   * CRR P1+: formalSpec 内部位置索引 (new path 用,scope 在编译时注入)
   * - 输入索引: 0..M_max-1
   * - 输出索引: 0..P_max-1
   * - 错误 alias: ERROR_SLOT_INDEX (= 99)
   *
   * @see docs/mvp/19-register-file-core.md §三.M_max/P_max
   */
  slotIndex: number

  /** 参数类型 */
  type: 'string' | 'number' | 'boolean' | 'path' | 'object' | 'any'

  /** 是否必填 */
  required: boolean

  /** 描述（可选）*/
  description?: string
}

/**
 * CRR slotIndex sentinel for error alias (output slot 复用全局 \$err)
 */
export const ERROR_SLOT_INDEX = 99

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
   * @param state 可选的 ExecutionState（仅特殊 op 如 evaluate_expr 需要动态读 internal 寄存器）
   * @returns 输出值（写入 internalStore）
   *
   * 错误处理契约：
   * - 已知错误（可恢复）：返回 { ..., error: OperationError | null }
   *   - error: null 表示成功
   *   - error: OperationError 表示已知错误（已分类）
   * - 硬错误（不可恢复）：throw Error
   *   - 例如：磁盘故障、权限拒绝（未分类）、网络超时等
   *
   * state 参数（2026-08-20 evaluate_expr 重构新增）：
   * - 普通 op 不需要，传或不传都行
   * - evaluate_expr 需要通过 state.internalStore.get 动态读寄存器（expr.var.name）
   */
  execute(inputs: Record<string, Value>, state?: ExecutionState): Promise<Record<string, Value>>
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
 * 错误输出特征：register === '$r_err' 或 slotIndex === ERROR_SLOT_INDEX
 */
export function getErrorFormalParam(
  spec: OperationFormalSpec
): FormalParam | undefined {
  return Object.values(spec.outputs).find(
    p => p.register === '$r_err' || p.slotIndex === ERROR_SLOT_INDEX
  )
}

/**
 * 从 register 字符串解析 slotIndex
 *
 * 合法输入:
 * - '$r0'..'$r<N>' → 0..N
 * - '$r_err' → ERROR_SLOT_INDEX (=99)
 * - '$err' → ERROR_SLOT_INDEX (=99)  (CRR 主推名)
 * - '$S<scope>.in<k>' / '.out<k>' → k (compile-time scope-prefixed slot)
 * - '$S<scope>.argtmp<N>' / '.cond<N>' / '.judge<N>' → 对应 pool index
 *
 * 不可识别 → 抛错 (catch malformed formalSpec 在加载期)
 */
export function parseSlotIndexFromRegister(register: string): number {
  if (register === '$r_err' || register === '$err') return ERROR_SLOT_INDEX
  const m = register.match(/^\$r(\d+)$/)
  if (m) return Number(m[1])
  const sm = register.match(/^\$S[\w]+\.(in|out|argtmp|cond|judge)(\d+)$/)
  if (sm) return Number(sm[2])
  throw new Error(`parseSlotIndexFromRegister: cannot parse '${register}'`)
}

/**
 * 根据 slotIndex + scopeId 构造完整的 register name (new path)
 *
 * - ERROR_SLOT_INDEX → \$err (GLOBAL_ERR)
 * - 其他 → \$S<scopeId>.in<k> / .out<k> (按 direction)
 *
 * 命名契约:见 docs/mvp/19b-register-design.md §四 R5.3
 */
export function buildRegisterName(
  slotIndex: number,
  direction: 'in' | 'out',
  scopeId: string
): string {
  if (slotIndex === ERROR_SLOT_INDEX) {
    // 引入循环依赖风险:此处用字符串字面量 \$err 避免顶层 import GLOBAL_ERR
    return '$err'
  }
  return `$S${scopeId}.${direction}${slotIndex}`
}

// ============== 类型导出 ==============
export type { Value, OperationError }