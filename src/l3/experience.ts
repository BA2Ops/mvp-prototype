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
import type { Expr } from '../l2/builtins/evaluate-expr.js'

// ============== ParamRef（参数引用）==========================

/**
 * 参数引用：如何获取参数值
 *
 * 四种来源：
 * - literal: 字面量
 * - input: 来自 intent.params（L3 compile-time 绑定到 $r_input_* 寄存器）
 * - register: 引用 internalStore 中的已有寄存器名（如 '$r_file_content'）
 *   ——包括前置处理的输出。D-C1-1: 删除原 `kind:'preprocessing'`，因为
 *   前置输出的本质就是「写入了某个 named register」，用 register 引用即可。
 *   好处：简化编译逻辑；让经验定义中可自由引用任意中间结果（不必显式声明依赖链）。
 */
export type ParamRef =
  | { kind: 'literal'; value: Value }
  | { kind: 'input'; name: string }
  | { kind: 'register'; name: string }

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

/**
 * JudgmentTrigger：用 evaluate_expr 的 Expr AST 表达任意条件
 *
 * @see ../../docs/mvp/12-experience-model.md §3.4（2026-08-20 重构）
 * @see src/l2/builtins/evaluate-expr.ts Expr type
 *
 * 设计变更历史：
 * - v1 (2026-07)：source + condition_op + compare_value → L3 编译器要拼多步 DAG
 *   （move compare_value 到寄存器 + execute_op equals/gt/is_truthy ...）
 * - v2 (2026-08-20)：**Expr JSON 树**——单一表达式节点，L3 编译为单个
 *   `execute_op(evaluate_expr)` + conditional_skip。DAG 长度从 5-6 → 1。
 *
 * 表达能力不变（equals / gte / and / or / not / in 等全部保留），但：
 * - L3 经验定义直接是 "AST"（JSON），更接近人类思维
 * - 短路语义天然支持（and/or）
 * - 无需为新条件类型加 op（组合即可）
 */
export interface JudgmentTrigger {
  /**
   * 触发条件的完整表达式 AST（见 evaluate-expr.Expr）
   *
   * 可包含:
   * - { type: 'literal', value: ... }
   * - { type: 'var', name: '$r_xxx' }    ← 引用 internal 寄存器或 env 映射变量
   * - { type: 'op', name: '==|!=|>...|gte|lte|and|or|not|error_code|is_empty|...', args: [...] }
   * - { type: 'if', cond, then, else }
   *
   * 编译器会把 expr.var.name = '$r_err' 类引用自动解析到 ExecutionState.internalStore，
   * 其他 var.name 通过 compile-time 生成的 `env` 参数映射。
   */
  condition_expr: Expr
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