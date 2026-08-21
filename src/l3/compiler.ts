/**
 * L3 Compiler — 把 Experience 编译为 StackEntry[]
 *
 * @see ../../docs/mvp/12-experience-model.md §6.3（三段式编译流程）
 * @see ../../docs/mvp/10-reactive-execution-model.md §四
 *
 * 职责边界：
 * - L3 compile = 静态展开 + 参数绑定。不执行任何 op，只产出指令栈条目序列。
 * - 产出的 entries 会被 execute_intent primitive 逆序压入指令栈：
 *   children[0] 最先执行，children[N-1] 紧贴帧之上最后执行。
 *
 * 编译五步（D-C4 系列）：
 *
 * Step 0 输入绑定（D-C4-1）:
 *   intent.params[k] / schema default → move(literal, $r_input_<k>)
 *
 * Step 1 前置处理（D-C4-2）:
 *   options.skip_cost >= pp.skip_threshold 且 threshold > 0 → 整体跳过（不生成 entry）
 *   threshold=0 = 必须执行；threshold=100 = 可任意跳过
 *
 * Step 2 条件判断（D-C4-3）:
 *   judgment.trigger.condition_expr 是 Expr AST。**运行时分叉**（非静态求值），
 *   用 evaluate_expr + conditional_skip 实现 if/else。
 *
 *   L1 primitive 语义回顾：
 *     - conditional_skip(addr, n): addr truthy → 弹 self+n；falsy → 仅弹 self
 *     - skip_n(n): 无条件弹 self+n
 *
 *   "if c then T else E" 的规范构造（在源头取反）：
 *     [0] move(literal not(c) AST, $r_cond_<j>)
 *     [1] execute_op(evaluate_expr, expr=$r_cond_<j>, result=$r_judge_<j>, error=$r_err)
 *     [2] conditional_skip($r_judge_<j>, n = len(T)+1)
 *     [3..] T（len(T) 条）
 *     [.]  skip_n(len(E))          ← T 尾部的"跳过 E"指令
 *     [..] E（len(E) 条）
 *
 *   执行轨迹验证：
 *     c=true  → ¬c=false → cskip 仅弹自己 → T 执行 → 尾部 skip_n 弹掉整个 E ✓
 *     c=false → ¬c=true  → cskip 弹 self+len(T)+1（T+尾部skip_n）→ 落到 E 执行 ✓
 *
 *   多 judgment 链：j1 false → 继续评估 j2 → ... → 全 false 走 default_path
 *   （递归构造：else 分支 = 后续 judgments 的链式编译结果）
 *
 * Step 3 target-op 步骤:
 *   step.operation 是 L2 op → sidecar moves + OpEntry
 *   step.operation 是 Experience ID → 嵌套 IntentEntry（params 仅支持 literal/input 引用）
 *
 * Step 4 handleError（D-C4-5）:
 *   Experience.handleError?: boolean（默认 false）。嵌套 experience 时写入
 *   IntentEntry.handleError；根帧由调用方（service/E2E）从 experience 读取。
 */

import type { RecognizedIntent, StackEntry, Address, Value } from '../l1/types.js'
import type { ExecutionState } from '../l1/execution-state.js'
import type { Experience, ParamRef, CompileOptions, PreProcessing, ConditionalJudgment, OpStep } from './experience.js'
import type { Expr } from '../l2/builtins/evaluate-expr.js'
import { generateId, now } from '../l1/id.js'
import { ERROR_REGISTER } from '../l2/errors.js'

// ============== Registry 接口（避免循环依赖）==============

export interface L2RegistryLike {
  has(name: string): boolean
}

// ============== 寄存器命名约定 ===============

/** intent.params 绑定寄存器前缀 */
const INPUT_PREFIX = '$r_input_'
/** literal ParamRef 临时寄存器前缀 */
const ARG_TMP_PREFIX = '$r_argtmp_'
/** 条件 AST 寄存器 */
const condReg = (jid: string) => `$r_cond_${jid}`
/** 条件求值结果寄存器 */
const judgeReg = (jid: string) => `$r_judge_${jid}`
/** 实际走过的路径 ID 标记（D-E2-1，resolveResponse 用）*/
const PATH_MARK_REG = '$r_path'

// ============== 公共入口 ===============

/**
 * 编译意图为 children entries。
 *
 * @param intent 已识别意图（type + params）
 * @param _state 执行状态（MVP 编译是纯静态展开，不读 state；保留参数以符合 L3Service 签名）
 * @param experiences 可用经验库
 * @param registry L2 op 注册表
 * @param options 编译选项（skip_cost）
 * @throws 经验不存在 / 缺 required 输入 / 未知 operation
 */
export function compileExperience(
  intent: RecognizedIntent,
  _state: ExecutionState,
  experiences: Map<string, Experience>,
  registry: L2RegistryLike,
  options?: CompileOptions
): StackEntry[] {
  const exp = experiences.get(intent.type)
  if (!exp) {
    throw new Error(`L3 compile: no experience registered for type '${intent.type}'`)
  }
  const ctx: CompileCtx = {
    intent,
    experiences,
    registry,
    skipCost: options?.skip_cost ?? 0,
    tmpCounter: 0
  }

  const entries: StackEntry[] = []

  // Step 0: 输入绑定
  entries.push(...bindInputs(exp, ctx))

  // Step 1: 前置处理（按 skip_cost 过滤）
  for (const pp of exp.pre_processing ?? []) {
    if (ctx.skipCost >= pp.skip_threshold && pp.skip_threshold > 0) {
      continue // D-C4-2: threshold=0 必跑；skip_cost 达到阈值才跳
    }
    entries.push(...compileOp(pp.operation, pp.inputs, pp.outputs, `pp_${pp.id}`, ctx))
  }

  // Step 2+3: 条件判断链 + target-op 路径
  entries.push(...compilePathSelection(exp, exp.conditional_judgment ?? [], ctx))

  return entries
}

// ============== 编译上下文 ===============

interface CompileCtx {
  intent: RecognizedIntent
  experiences: Map<string, Experience>
  registry: L2RegistryLike
  skipCost: number
  tmpCounter: number
}

// ============== Step 0: 输入绑定 ===============

function bindInputs(exp: Experience, ctx: CompileCtx): StackEntry[] {
  const out: StackEntry[] = []
  for (const [key, spec] of Object.entries(exp.inputs ?? {})) {
    let value = ctx.intent.params[key] as Value | undefined
    if (value === undefined && spec.required === false && 'default' in spec) {
      value = spec.default
    }
    if (spec.required !== false && value === undefined) {
      throw new Error(`L3 compile: missing required input '${key}' for experience '${exp.id}'`)
    }
    out.push(makeMove(
      { kind: 'literal', value: value ?? null },
      { kind: 'internal', name: INPUT_PREFIX + key }
    ))
  }
  // 宽容：schema 未声明但 params 里有的参数也绑定（便于调试/透传）
  for (const [k, v] of Object.entries(ctx.intent.params ?? {})) {
    if (!(k in (exp.inputs ?? {}))) {
      out.push(makeMove(
        { kind: 'literal', value: v as Value },
        { kind: 'internal', name: INPUT_PREFIX + k }
      ))
    }
  }
  return out
}

// ============== Step 2+3: 路径选择（judgment 链）==============

function compilePathSelection(exp: Experience, judgments: ConditionalJudgment[], ctx: CompileCtx): StackEntry[] {
  // 无 judgment → 直接编译 default path
  if (judgments.length === 0) {
    return compilePathSteps(exp, exp.target_op.default_path, ctx)
  }

  const j = judgments[0]
  const thenEntries = compilePathSteps(exp, j.then_path, ctx)

  // else 分支：显式 else_path 优先；否则继续评估后续 judgments（链式 if-else-if）
  const elseEntries = j.else_path
    ? compilePathSteps(exp, j.else_path, ctx)
    : compilePathSelection(exp, judgments.slice(1), ctx)

  return compileBranch(j, thenEntries, elseEntries, ctx)
}

function compilePathSteps(exp: Experience, pathId: string, ctx: CompileCtx): StackEntry[] {
  const path = exp.target_op.paths.find(p => p.id === pathId)
  if (!path) {
    throw new Error(`L3 compile: experience '${exp.id}' has no target path '${pathId}'`)
  }
  return compileSteps(path.steps, ctx)
}

/**
 * 构造运行时 if/else 分支（见文件头 D-C4-3 规范构造与轨迹验证）。
 */
function compileBranch(
  j: ConditionalJudgment,
  thenEntries: StackEntry[],
  elseEntries: StackEntry[],
  _ctx: CompileCtx
): StackEntry[] {
  // 源头取反：not(condition_expr)
  const negated: Expr = {
    type: 'op',
    name: 'not' as never,
    args: [j.trigger.condition_expr]
  }

  // D-E2-1：路径标记——THEN/ELSE 块首各插入一条 move，记录实际走过的路径 ID，
  // 供 L3 resolveResponse 查找对应 path.response 消息模板。
  // 标记算在各块内部（先构造含标记的块，再算 cskip/skip 长度），长度自然正确。
  const thenMarked = [
    makeMove({ kind: 'literal', value: j.then_path }, { kind: 'internal', name: PATH_MARK_REG }),
    ...thenEntries
  ]
  const elseMarked = j.else_path
    ? [makeMove({ kind: 'literal', value: j.else_path }, { kind: 'internal', name: PATH_MARK_REG }), ...elseEntries]
    : elseEntries // 链式递归（无显式 else_path）时由内层分支自行标记

  return [
    // [0] AST literal → 寄存器
    makeMove(
      { kind: 'literal', value: negated as unknown as Value },
      { kind: 'internal', name: condReg(j.id) }
    ),
    // [1] evaluate_expr 求值
    {
      id: generateId('op'),
      parentIntentId: null,
      createdAt: now(),
      kind: 'execute_op',
      operation: 'evaluate_expr',
      inputs: { expr: { kind: 'internal', name: condReg(j.id) } },
      outputs: {
        result: { kind: 'internal', name: judgeReg(j.id) },
        error: { kind: 'internal', name: ERROR_REGISTER }
      },
      status: 'pending'
    },
    // [2] ¬c truthy（即 c falsy）→ 跳过 THEN + 尾部 skip_n，落到 ELSE
    {
      id: generateId('cskip'),
      parentIntentId: null,
      createdAt: now(),
      kind: 'conditional_skip',
      conditionAddr: { kind: 'internal', name: judgeReg(j.id) },
      n: thenMarked.length + 1
    },
    // [3..] THEN（含路径标记）
    ...thenMarked,
    // [.] THEN 尾部：跳过 ELSE
    {
      id: generateId('skip'),
      parentIntentId: null,
      createdAt: now(),
      kind: 'skip_n',
      n: elseMarked.length
    },
    // [..] ELSE（含路径标记）
    ...elseMarked
  ]
}

// ============== Step 3: 步骤编译 ===============

function compileSteps(steps: OpStep[], ctx: CompileCtx): StackEntry[] {
  const out: StackEntry[] = []
  for (const step of steps) {
    if (ctx.experiences.has(step.operation)) {
      out.push(makeNestedIntent(step, ctx))
    } else if (!ctx.registry.has(step.operation)) {
      throw new Error(`L3 compile: unknown operation or experience '${step.operation}'`)
    } else {
      out.push(...compileOp(step.operation, step.inputs, step.outputs, `op_${step.operation}`, ctx))
    }
  }
  return out
}

/**
 * 把一组 ParamRef 展开为 Address map + literal sidecar moves。
 *
 * - literal → 先 move 到临时寄存器 $r_argtmp_*，再引用该寄存器
 *   （L1 约束：execute_op.inputs 只能是 internal）
 * - input → $r_input_<name>（Step 0 已绑定）
 * - register → 原名直接引用
 */
function expandRefs(
  refs: Record<string, ParamRef>,
  direction: 'in' | 'out',
  ctx: CompileCtx
): { moves: StackEntry[]; addrs: Record<string, Address> } {
  const moves: StackEntry[] = []
  const addrs: Record<string, Address> = {}
  for (const [name, ref] of Object.entries(refs)) {
    if (ref.kind === 'literal') {
      if (direction === 'out') {
        throw new Error(`L3 compile: output param '${name}' cannot be a literal`)
      }
      const regName = `${ARG_TMP_PREFIX}${ctx.tmpCounter++}`
      moves.push(makeMove({ kind: 'literal', value: ref.value }, { kind: 'internal', name: regName }))
      addrs[name] = { kind: 'internal', name: regName }
    } else if (ref.kind === 'input') {
      addrs[name] = { kind: 'internal', name: INPUT_PREFIX + ref.name }
    } else {
      addrs[name] = { kind: 'internal', name: ref.name }
    }
  }
  return { moves, addrs }
}

/**
 * 编译单个 L2 op 调用：sidecar moves + OpEntry。
 */
export function compileOp(
  opName: string,
  inputRefs: Record<string, ParamRef>,
  outputRefs: Record<string, ParamRef>,
  idPrefix: string,
  ctx: CompileCtx
): StackEntry[] {
  const ins = expandRefs(inputRefs, 'in', ctx)
  const outs = expandRefs(outputRefs, 'out', ctx)
  return [
    ...ins.moves,
    ...outs.moves, // outputs 一般无 literal，但保持对称（会 throw）
    {
      id: generateId(idPrefix.slice(0, 4)),
      parentIntentId: null,
      createdAt: now(),
      kind: 'execute_op',
      operation: opName,
      inputs: ins.addrs,
      outputs: outs.addrs,
      status: 'pending'
    }
  ]
}

/**
 * 嵌套 experience 调用 → IntentEntry。
 *
 * MVP 限制：params 仅支持 literal / input 引用（register 引用需运行时求值，
 * 而 intent.params 是静态值——Phase C 后续版本可扩展）。
 */
function makeNestedIntent(step: OpStep, ctx: CompileCtx): StackEntry & { kind: 'execute_intent' } {
  const nestedExp = ctx.experiences.get(step.operation)!
  const params: Record<string, unknown> = {}
  for (const [k, ref] of Object.entries(step.inputs)) {
    if (ref.kind === 'literal') {
      params[k] = ref.value
    } else if (ref.kind === 'input') {
      params[k] = ctx.intent.params[ref.name]
    } else {
      throw new Error(
        `L3 compile: nested experience '${step.operation}' param '${k}' uses register ref — ` +
        'not supported in Phase C MVP (literal/input only)'
      )
    }
  }
  return {
    id: generateId('intent'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'execute_intent',
    intent: { type: step.operation, params },
    phase: 'pending',
    children: [],
    handleError: nestedExp.handleError ?? false
  }
}

// ============== 工具 ===============

function makeMove(from: Address, to: Address): StackEntry & { kind: 'move' } {
  return {
    id: generateId('move'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'move',
    from,
    to
  }
}

// re-export 类型便于测试引用
export type { PreProcessing, ConditionalJudgment, Expr }
