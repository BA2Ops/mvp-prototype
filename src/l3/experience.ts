/**
 * L3 Experience 数据结构定义
 *
 * @see ../../docs/mvp/12-experience-model.md
 * @see ../../docs/mvp/07-intent-library.md §3
 *
 * 2026-08-20 重写：原 StandardIntent + DAG 节点 → Experience 三段式
 *
 * 设计哲学：
 * - 每个 Experience = pre-processing + conditional-judgment + target-op
 * - 三段式职责清晰：收集数据 → 决定路径 → 执行目标
 * - skip-cost 参数（0-100 浮点）控制跳过必要性
 * - 经验之间通过调用关系形成 DAG（而非内部嵌套）
 */

import type { Value } from '../l1/types.js'

// ============== ParamRef（参数引用）==========================

/**
 * 参数引用：如何获取参数值
 *
 * 三种来源：
 * - literal: 字面量
 * - input: 来自 experience.inputs
 * - preprocessing / register: 来自前置处理输出或寄存器
 */
export type ParamRef =
  | { kind: 'literal'; value: Value }
  | { kind: 'input'; name: string }
  | { kind: 'register'; name: string }
  | { kind: 'preprocessing'; preproc_id: string; output: string }

// ============== Pre-Processing（前置处理）===================

/**
 * 前置处理：收集数据，不做判断
 *
 * 收集结果写入 internal 寄存器，供后续 conditional_judgment 使用。
 */
export interface PreProcessing {
  /** 处理 ID（在经验内唯一）*/
  id: string

  /** L2 op 名称 */
  operation: string

  /** 输入参数（来自 experience.inputs 或字面量）*/
  inputs: Record<string, ParamRef>

  /** 输出参数（写入 internal 寄存器）*/
  outputs: Record<string, ParamRef>

  /**
   * 跳过阈值（0-100 浮点）
   *
   * 当外部传入的 skip_cost >= skip_threshold 时，此前置被跳过。
   * skip_threshold = 0 意味着"必须执行"
   * skip_threshold = 100 意味着"永远可跳过"
   */
  skip_threshold: number
}

// ============== Conditional-Judgment（条件判断）=============

/**
 * 条件判断：基于前置处理的数据，决定 target_op 走哪条路径
 */
export interface ConditionalJudgment {
  /** 判断 ID（在经验内唯一）*/
  id: string

  /** 触发条件 */
  trigger: JudgmentTrigger

  /** 条件为真时走的目标路径 ID */
  then_path: string

  /** 条件为假时走的目标路径 ID（可选，默认 normal）*/
  else_path?: string
}

export interface JudgmentTrigger {
  /** 数据源：前置处理的输出 / 用户输入 / 其他 */
  source: 'preprocessing' | 'input' | 'register'

  /** 源 ID（如 'preprocessing[0].outputs.r_count'）*/
  source_id: string

  /** 条件 op（如 string_equals, is_truthy, greater_than）*/
  condition_op: string

  /** 比较值 */
  compare_value: Value
}

// ============== Target-Op（目标操作）======================

/**
 * 目标操作：核心 + 多路径
 *
 * 一个 target_op 对应一个目标基础 op，但可有多个路径（正常 + 异常）。
 * 最小化原则：一个函数一个目标。
 */
export interface TargetOp {
  /** 核心基础 op（L2 op 名称）*/
  base_op: string

  /** 路径列表（必有，至少一个 'normal' 路径）*/
  paths: TargetOpPath[]

  /** 默认路径 ID（默认 'normal'）*/
  default_path: string
}

export interface TargetOpPath {
  /** 路径 ID（唯一）*/
  id: string

  /** 此路径的描述 */
  description: string

  /** 执行步骤 */
  steps: OpStep[]
}

export interface OpStep {
  /** L2 op 名称或 Experience ID（嵌套调用）*/
  operation: string

  /** 输入参数 */
  inputs: Record<string, ParamRef>

  /** 输出参数（写入 internal 寄存器）*/
  outputs: Record<string, ParamRef>
}

// ============== FeedbackRecord（反馈记录）==================

/**
 * 用户反馈记录（MVP 仅存储，不自动演化）
 */
export interface FeedbackRecord {
  timestamp: number
  feedback_type: 'precheck_added' | 'conditional_added' | 'path_added' | 'other'
  target: string
  suggestion: string
  detail?: unknown
}

// ============== Experience（经验）==========================

/**
 * L3 经验：有业务意义的可执行单元
 *
 * 业务意义由 L3 之上的层识别（通常是 L4 LLM），L3 接收标准化的 type 查找经验。
 */
export interface Experience {
  /** 业务意义 ID（与 L4 LLM 识别的 type 对应）*/
  id: string

  /** 业务描述（自然语言，用于匹配和文档）*/
  description: string

  /** 输入参数 schema（key 是参数名）*/
  inputs: Record<string, ParamSpec>

  /** 输出参数 schema */
  outputs: Record<string, ParamSpec>

  /** 前置处理（可选）—— 收集数据为条件判断做准备 */
  pre_processing?: PreProcessing[]

  /** 条件判断（可选）—— 决定 target-op 路径 */
  conditional_judgment?: ConditionalJudgment[]

  /** 目标操作（必有）—— 至少一个 base_op */
  target_op: TargetOp

  /** 用户反馈历史（MVP 仅存储，不自动演化）*/
  feedback_history?: FeedbackRecord[]
}

/**
 * 参数 schema（简化版）
 */
export interface ParamSpec {
  type: 'string' | 'number' | 'boolean' | 'path' | 'object' | 'any'
  required: boolean
  description?: string
  default?: Value
}

// ============== CompileOptions（编译选项）===================

/**
 * Experience 编译选项
 */
export interface CompileOptions {
  /**
   * skip-cost 参数（0-100 浮点）
   *
   * 由 L3 之上的层决定（L4 LLM / 用户显式参数 / 配置）
   *
   * 当前 MVP：单个值。未来可扩展为多维（执行/时间/资源成本）。
   */
  skip_cost?: number
}