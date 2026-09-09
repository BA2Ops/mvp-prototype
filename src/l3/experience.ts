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

// 便利 re-export：消费者可从 experience.ts 一并导入 Expr
export type { Expr } from '../l2/builtins/evaluate-expr.js'

// ============== ParamRef（参数引用）==========================

/**
 * 参数引用：如何获取参数值
 *
 * 四种来源：
 * - literal: 字面量
 * - input: 来自 intent.params（L3 compile-time 绑定到 $r_input_<key> 业务变量）
 * - register: 引用经验级业务变量名（如 '$r_content'）
 *   ——$r_<name> 是业务变量名（经验级命名连线），不是物理寄存器名。
 *   物理寄存器由 op 的 formalSpec.slotIndex 决定（$S<scope>.in/out<k>），
 *   对其他 op 不可见。编译器自动生成 move 指令在业务变量区和 op 物理寄存器之间搬运：
 *   - op output: move(物理输出槽, 业务变量名)
 *   - op input:  move(业务变量名, 物理输入槽)
 *   详见 doc 19 C6「三层数据存储模型与 op 寄存器隔离」。
 *   D-C1-1: 删除原 `kind:'preprocessing'`，因为前置输出的本质就是「写入了一个业务变量」，
 *   用 register 引用即可。
 * - registerOutput (P3/T-3.1): 结构化引用某个具体经验的 output。
 *   等价于 `register: name=<expId>.<outKey> 解析到的具体 $S_parent.out<k> 寄存器`。
 *   expId 可选:不提供时 从当前 frame 的最近一个写入 outKey 的经验中查找 (parent frame retention)。
 *   使用 outputs_bindings 反查 register 名 (T-2.1 已就绪),所以 bindInputs 必须
 *   生成 deferred binding move(parent 帧执行后 → child 输入寄存器)。
 */
export type ParamRef =
  | { kind: 'literal'; value: Value }
  | { kind: 'input'; name: string }
  | { kind: 'register'; name: string }
  | { kind: 'registerOutput'; expId?: string; outKey: string }

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

  /**
   * 结果消息模板（D-E2-1，2026-08-20）
   *
   * 走此路径后向用户返回的人类可读信息。L4 只做插值渲染，不做业务判断。
   * 模板变量：{param} 输入参数 / {register} 寄存器（去 $r_ 前缀）/ {err.code} {err.message}
   * 例：「文件 {path} 不存在，已使用默认内容」
   */
  response?: string
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

  /**
   * 异常处置标志（D-C4-5，默认 false）
   *
   * true  = 本经验内的异常由后续指令检查 $r_err 处理（L1 不冒泡，截获在此层）
   * false = 默认：异常由 L1 递归向上冒泡
   *
   * 由 LLM 在生成经验时根据业务语义设置（如「读文件失败要给默认值」设 true）。
   * 编译器把它写入嵌套 IntentEntry.handleError；根帧由调用方读取。
   */
  handleError?: boolean

  /**
   * 失败消息映射（D-E2-1）
   *
   * key = $r_err.code（'*' 为兑底），value = 消息模板。
   * 执行后 $r_err 非空时优先生成失败消息——确保错误对用户显性化而非静默 null。
   */
  responses?: {
    failure?: Record<string, string>
  }

  /**
   * CRR P2/C5: outputs_bindings 持久化声明
   *
   * 设计动机（doc 19 §C5 + doc 19b §三 R5.4）:
   * - MVP 默认保持 internalStore / publicStore 双区隔离 (doc 12 K3)
   * - 部分场景需要把内部输出“提升”到 publicStore，供上层 pipeline 或调用方读
   * - 选择性、显式声明，默认不提升（防止 K5 growth channel 污染）
   *
   * Schema:
   *   key = 经验输出 schema 的 key (必须出现在 exp.outputs)
   *   register = 该输出对应的寄存器名 ($r_<X> 或 $S<scope>.out<k>)
   *   type = ValueType,用于 pipeline.collect 类型校验
   *   persist = true 才生成 move 到 publicStore；false 视为未声明
   *
   * P2 验收场景：
   *   - safe_write.bytes_written / read_file_with_default.content 显式 persist:true
   *   - replace_in_file 故意不声明,验证 publicStore.size()===0
   *
   * P4 T-4.3 不在清理范围（本字段不是 deprecated,是 persistent field）。
   */
  outputs_bindings?: Record<string, OutputBinding>

  /** 用户反馈历史（MVP 仅存储，不自动演化）*/
  feedback_history?: FeedbackRecord[]
}

/**
 * CRR P2/C5: 单个 output binding 声明
 *
 * @see Experience.outputs_bindings
 */
export interface OutputBinding {
  /** 对应的 internal register 名（legacy '$r_<X>' 或 new path '$S<scope>.out<k>'）*/
  register: string
  /** 输出类型（与 ParamSpec.type 互参一致,供 pipeline.collect 插值校验）*/
  type: 'string' | 'number' | 'boolean' | 'path' | 'object' | 'any'
  /** 是否持久化到 publicStore（默认 false,opt-in 原则）*/
  persist?: boolean
  /** 选填说明，用于 dev observability */
  description?: string
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

  /**
   * CRR P3/T-3.2: bindInputs 应跳过的 input key (已被父 binding move 填充到 $r_input_<k>)
   */
  prefilledInputKeys?: Set<string>

  /**
   * CRR (Compiler Register-file Redesign, doc 19/19b/19c) feature flag
   *
   * - false (默认, P1 前 + legacy 对照期) : 走原路径
   *   `$r_input_<key>` / `$r_argtmp_<N>` 自增 / register kind 直接 throw
   *   / `$r_err` / `$r_path` 旧名 → 与 CRR 前行为完全等价
   *
   * - true (P1 末 legacy 对照通过后翻 true) : 走新路径
   *   `$S<scope>.in<slotIndex>` / `$S<scope>.out<slotIndex>` fixed-slot
   *   / FrameScopeAllocator / literal pool round-robin size=8
   *   / judge/cond pool size ≤10 / `$err` / `$path` 重命名
   *
   * 详细：见 docs/mvp/19c-implementation-plan.md §一.1。
   * P4 末 feature flag 移除,默认 hardcode 为 true。
   */
  useFixedSlotConvention?: boolean
}