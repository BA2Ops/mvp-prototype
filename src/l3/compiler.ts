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
import type { OperationFormalSpec } from '../l2/operation.js'
import { generateId, now } from '../l1/id.js'
import { ERROR_REGISTER, GLOBAL_ERR } from '../l2/errors.js'
import {
  GLOBAL_PATH,
  LEGACY_PATH_REGISTER
} from './crr-config.js'
import { buildEnvMap, indexOutputsByName } from './expr-env-builder.js'

// ============== Registry 接口（避免循环依赖）==============

export interface L2RegistryLike {
  has(name: string): boolean
  getSpec(name: string): OperationFormalSpec | undefined
}

// ============== 寄存器命名约定 ===============

/** intent.params 绑定寄存器前缀 (legacy + CRR 通用,Step 0 输入绑定语义不变) */
const INPUT_PREFIX = '$r_input_'
/** literal ParamRef 临时寄存器前缀 (legacy path 使用,自增计数器) */
const ARG_TMP_PREFIX = '$r_argtmp_'
/** 条件 AST 寄存器 (legacy path 使用,按 judgment.id 命名) */
const condReg = (jid: string) => `$r_cond_${jid}`
/** 条件求值结果寄存器 (legacy path 使用,按 judgment.id 命名) */
const judgeReg = (jid: string) => `$r_judge_${jid}`
/** 实际走过的路径 ID 标记 (legacy path 使用,resolveResponse 双名读取) */
const PATH_MARK_REG = LEGACY_PATH_REGISTER // '$r_path' (global functional 写过 $path,legacy 过渡仍产 $r_path)
/**
 * CRR 新路径专用:
 * - 使用 FrameScopeAllocator 分配 scope-prefixed 名 ($S<scopeId>.out<k>, $S<scopeId>.argtmp<N>, ...)
 * - PATH_MARK → $path (GLOBAL_PATH)
 * - error alias → $err (GLOBAL_ERR)
 * - 源/保留名字在 compiled entries 上一一对应,不遗漏不重复
 */

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
  state: ExecutionState,
  experiences: Map<string, Experience>,
  registry: L2RegistryLike,
  options?: CompileOptions
): StackEntry[] {
  const exp = experiences.get(intent.type)
  if (!exp) {
    throw new Error(`L3 compile: no experience registered for type '${intent.type}'`)
  }
  const newPath = options?.useFixedSlotConvention === true && !!state.frameScopeAllocator
  // CRR T-1.3: 使用当前活跃 scope(由 main-loop T-1.5 在 executeIntent 之前 enter)
  // 本函数不重复 enterScope,避免与帧生命周期不一致 (R-1🔴高)
  const activeScopeId = newPath ? state.frameScopeAllocator!.currentScope() : null
  const ctx: CompileCtx = {
    intent,
    experiences,
    registry,
    skipCost: options?.skip_cost ?? 0,
    tmpCounter: 0,
    newPath,
    allocator: newPath ? state.frameScopeAllocator! : null,
    scopeId: activeScopeId
  }

  // CRR P3/T-3.2: registerOutput binding — bindInputs skip these keys
ctx.prefilledInputKeys = options?.prefilledInputKeys

  const entries: StackEntry[] = []

  // CRR T-1.6: 聚合经验可见的 outputsByName (从每个 step 的 outputs[*].name 反查 op formalSpec)
  // 注意: 这是经验级聚合,即"本经验内可见的输出 slot 名集合"
  // 主要用于 evaluate_expr env 填充;CRR P3/T-D1-fix:同时供 expandRefs input-side register ref 跨 op 引用复用同一张表
  const outputsByName = aggregateOutputsByName(exp, ctx)
  ctx.outputsByAlias = outputsByName
  const inputNames = new Set(Object.keys(exp.inputs ?? {}))

  // Step 0: 输入绑定 (legacy + new 路径语义相同 —— $r_input_<key>)
  entries.push(...bindInputs(exp, ctx))

  // Step 1: 前置处理（按 skip_cost 过滤）
  for (const pp of exp.pre_processing ?? []) {
    if (ctx.skipCost >= pp.skip_threshold && pp.skip_threshold > 0) {
      continue // D-C4-2: threshold=0 必跑；skip_cost 达到阈值才跳
    }
    entries.push(...compileOp(pp.operation, pp.inputs, pp.outputs, `pp_${pp.id}`, ctx))
  }

  // Step 2+3: 条件判断链 + target-op 路径
  entries.push(...compilePathSelection(exp, exp.conditional_judgment ?? [], ctx, outputsByName, inputNames))

  // Step 5 (CRR P2/T-2.2): post-bindings move generation pass
  // 遍历 exp.outputs_bindings, 对 persist:true 的 entry 生成 publicStore move。
  // - 未声明 / persist:false 不生成 (T-B2 反向断言保护)
  // - move 的 from 是 binding.register ($r_<X> legacy 或 $S<scope>.out<k> new path)
  // - move 的 to 是 { kind: 'public', name: `${exp.id}.${key}` }
  entries.push(...compilePostBindings(exp, ctx))

  return entries
}

/**
 * CRR P2/T-2.2: post-bindings Step5 move generation
 *
 * @see docs/mvp/19c-implementation-plan.md §三 T-2.2
 * @see docs/mvp/19-register-file-core.md §C5
 *
 * 动机:
 * - MVP 默认保持 internalStore / publicStore 双区隔离 (D-T1)
 * - 经验选择性声明某些 output 提升到 publicStore,供 pipeline / 调用方读取
 * - opt-in 原则: 默认不提升,防止 K5 growth channel 污染
 *
 * 行为:
 * - 遍历 exp.outputs_bindings
 * - 跳过 persist !== true 的 binding
 * - 对每个 persist:true binding 生成一条 move:
 *     from = { kind: 'internal', name: binding.register }
 *     to   = { kind: 'public',   name: `${exp.id}.${key}` }
 * - 嵌套 scope 下的 new path:binding.register = $S<scope>.out<k>,address-resolver
 *   直接读 internalStore.get(<name>) → 与 round-robin pool 无关
 *
 * 静态检查 (R-4🟢低):
 * - binding.register 未在 pre_processing / target_op.paths[*].steps 的 outputs 中出现 → warn
 *   (不拒绝,仅 console.warn —— 避免过度限制嵌套 experience 场景)
 * - exp.outputs_bindings[key] 的 key 不在 exp.outputs 中 → throw (schema 一致性)
 *
 * @returns 生成的 move entries (空数组 if 无 binding 或全 persist:false)
 */
function compilePostBindings(
  exp: Experience,
  ctx: CompileCtx
): StackEntry[] {
  const bindings = exp.outputs_bindings
  if (!bindings) return []

  const entries: StackEntry[] = []
  const validRegisterNames = collectRegisterNames(exp, ctx)
  const outputsByName = aggregateOutputsByName(exp, ctx)

  for (const [key, binding] of Object.entries(bindings)) {
    // 静态校验 1: key 必须出现在 exp.outputs
    if (!(key in (exp.outputs ?? {}))) {
      throw new Error(
        `L3 compile: experience '${exp.id}' has outputs_bindings['${key}'] ` +
        `but no matching entry in exp.outputs`
      )
    }
    // 跳过 persist !== true (默认 false / 显式 false)
    if (binding.persist !== true) continue

    // CRR T-2.2 + T-2.3 + P1/T-1.6: 在 new path 下,binding.register (声明的 '$r_<X>')
    // 需要翻译为 scope-prefixed form ('$S<scopeId>.out<k>')。
    // 如果声明已是 $S<scope>.out<k> 形式,跳过翻译(幂等)。
    const resolvedRegister = ctx.newPath
      ? resolveBindingRegisterForNewPath(binding.register, key, ctx, outputsByName)
      : binding.register

    // 静态校验 2: register 应在 known set 中 (warn only) —— 使用翻译后的名称
    if (!validRegisterNames.has(binding.register) && !validRegisterNames.has(resolvedRegister)) {
      console.warn(
        `[CRR T-2.2] experience '${exp.id}' outputs_bindings['${key}'].register='${binding.register}' ` +
        `not found in any step's outputs (will be silently ignored if internalStore doesn't have it)`
      )
    }

    entries.push(makeMove(
      { kind: 'internal', name: resolvedRegister },
      { kind: 'public', name: `${exp.id}.${key}` }
    ))
  }
  return entries
}

/**
 * CRR T-2.2: new path 下 outputs_bindings.register 解析
 *
 * P4/T-4.3: $r_* 名在 new path 下保持全局（与 expandRefs 一致），
 * 不再 scope-prefix。$r_err → $err。
 * 已是 $S<scope>.out<k> 形式: 幂等返回。
 */
function resolveBindingRegisterForNewPath(
  register: string,
  _bindingKey: string,
  ctx: CompileCtx,
  _outputsByName: Map<string, import('../l2/operation.js').FormalParam>
): string {
  if (!ctx.scopeId) return register
  if (register.startsWith('$S') && register.includes('.out')) return register
  if (register === '$err' || register === '$r_err') return GLOBAL_ERR
  // P4/T-4.3: $r_* 名 → 全局寄存器（原名），不 scope-prefix
  return register
}

/**
 * CRR P2/T-2.2: 收集本经验所有 step outputs 写入的 register name 集合
 *
 * 用于 compilePostBindings 的静态校验(register 是否引用合法)
 */
function collectRegisterNames(
  exp: Experience,
  _ctx: CompileCtx
): Set<string> {
  const out = new Set<string>()
  const collect = (step: OpStep): void => {
    for (const ref of Object.values(step.outputs ?? {})) {
      if (ref.kind === 'register') out.add(ref.name)
    }
  }
  for (const pp of exp.pre_processing ?? []) collect(pp as unknown as OpStep)
  for (const path of exp.target_op.paths) for (const step of path.steps) collect(step)
  return out
}

/**
 * CRR T-1.6: 聚合经验内可见的 outputsByName
 *
 * 索引: 经验侧 step.outputs 的 KEY (e.g. 'bytes_written') → FormalParam
 * - 不是用 '$r_<X>' 中的 X 当 key —— X 是 manual legacy 简称 (e.g. '$r_bytes')
 * - 正确做法是:用 experience 侧 key (e.g. 'bytes_written') 反查 spec.outputs[businessName]
 *
 * 用于 evaluate_expr env map 填充 —— var.name === '$r_<X>' 解析:
 *   - 从 var.name 反查 'X' (如 '$r_bytes' → 'bytes')
 *   - 但更准确是: collectVarNames 后,解析器在 outputsByName 里查 'bytes' 这种短名
 *
 * 实际逻辑见 resolveVar() —— 它接受 outputsByName 索引并按 '$r_<X>' 反查 X
 */
function aggregateOutputsByName(
  exp: Experience,
  ctx: CompileCtx
): Map<string, import('../l2/operation.js').FormalParam> {
  const out = new Map<string, import('../l2/operation.js').FormalParam>()
  const collect = (step: OpStep): void => {
    if (ctx.experiences.has(step.operation)) return // 嵌套 experience 不输出到本 env
    const spec = ctx.registry.getSpec(step.operation)
    if (!spec) return
    for (const [expKey, ref] of Object.entries(step.outputs ?? {})) {
      if (ref.kind !== 'register') continue
      // ref.name 可能是 '$r_<X>' / '$r_err' / '$err'
      // experience 侧 expKey 对应 op 侧 spec.outputs[opKey] (通常同名)
      const fp = spec.outputs[expKey]
      if (fp) {
        // 按 var.name 的 $r_<X> 后缀 X 来索引(供 resolveVar 按 '$r_X' 反查)
        const legacyMatch = ref.name.match(/^\$r_(.+)$/)
        if (legacyMatch) {
          const aliasName = legacyMatch[1]
          if (aliasName === 'err') {
            out.set('err', fp)
          } else {
            // 同 fp 可能被多个 aliasName 索引 (罕见,但允许)
            out.set(aliasName, fp)
            // 也按 op businessName 索引
            out.set(fp.businessName, fp)
          }
        } else if (ref.name === '$err') {
          out.set('err', fp)
        } else if (ref.name === '$path' || ref.name === '$r_path') {
          // path-mark,不再输出到 outputs 索引(由 buildEnvMap 的 global 分支处理)
          void 0
        }
      }
    }
  }
  for (const pp of exp.pre_processing ?? []) collect(pp as unknown as OpStep)
  for (const path of exp.target_op.paths) for (const step of path.steps) collect(step)
  return out
}

// ============== 编译上下文 ===============

interface CompileCtx {
  intent: RecognizedIntent
  experiences: Map<string, Experience>
  registry: L2RegistryLike
  skipCost: number
  /** legacy path 用：argtmp counter */
  tmpCounter: number
  /** CRR new path 开关 */
  newPath: boolean
  /** CRR new path 用：非 null 时表选 new path */
  allocator: import('../l1/execution-state.js').FrameScopeAllocator | null
  /** CRR new path 用：enterScope 拿到的 scopeId,供 allocate* 调用 */
  scopeId: string | null
  /** 调试: 当前正在编译的 op 名(供错误信息使用) */
  currentOpName?: string
  /** CRR P3/T-3.2: bindInputs 跳过的 input key (已被父 binding move 填充 $r_input_<k>) */
  prefilledInputKeys?: Set<string>
  /** CRR P3/T-3.2: 嵌套 intent 哪些 param 已由父 binding move 填充, 嵌套 compile 不再生成 input literal move */
  skipParamMoves?: Set<string>
  /**
   * CRR P3/T-D1-fix: experience-scoped 输出别名反查表 (aliasName/businessName → FormalParam)
   *
   * 供 expandRefs(direction='in', ref.kind='register') 跨 op 引用同 frame 内更早 step
   * 写入的 output slot ($S<scope>.out<K>),修复原先误用当前 op 自身 .in<k> slotIndex
   * (与源 out slot 不同址)导致的链式 intermediate 复用失效问题 (T-D1 五步 chain 场景)。
   */
  outputsByAlias?: Map<string, import('../l2/operation.js').FormalParam>
}

// ============== Step 0: 输入绑定 ===============

function bindInputs(exp: Experience, ctx: CompileCtx): StackEntry[] {
  const out: StackEntry[] = []
  for (const [key, spec] of Object.entries(exp.inputs ?? {})) {
    // CRR P3/T-3.2: registerOutput binding — $r_input_<key> 已被父 binding move 填充,
    //   本处跳过 literal sidecar (避免覆盖 / 缺值报错)
    if (ctx.prefilledInputKeys?.has(key)) continue
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

function compilePathSelection(
  exp: Experience,
  judgments: ConditionalJudgment[],
  ctx: CompileCtx,
  outputsByName: Map<string, import('../l2/operation.js').FormalParam>,
  inputNames: Set<string>
): StackEntry[] {
  // 无 judgment → 直接编译 default path
  if (judgments.length === 0) {
    return compilePathSteps(exp, exp.target_op.default_path, ctx)
  }

  const j = judgments[0]
  const thenEntries = compilePathSteps(exp, j.then_path, ctx)

  // else 分支：显式 else_path 优先；否则继续评估后续 judgments（链式 if-else-if）
  const elseEntries = j.else_path
    ? compilePathSteps(exp, j.else_path, ctx)
    : compilePathSelection(exp, judgments.slice(1), ctx, outputsByName, inputNames)

  return compileBranch(j, thenEntries, elseEntries, ctx, outputsByName, inputNames)
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
 *
 * CRR new path (T-1.3): cond/judge 使用 allocator 分配 ($S<scopeId>.cond<j> / .judge<j>);
 *                       path-mark 使用 $path (GLOBAL_PATH);error alias 使用 $err (GLOBAL_ERR)
 * CRR T-1.6: env map 显式填充 (evaluate_expr 的 inputs.env) —— new path 必须传 env,
 *   否则 var.name='$r_<businessName>' 找不到 $S<scope>.out<k> 而 VARIABLE_NOT_FOUND。
 *   legacy path 不传 env,使用 fallback `?? name` 语义(原等价行为)。
 */
function compileBranch(
  j: ConditionalJudgment,
  thenEntries: StackEntry[],
  elseEntries: StackEntry[],
  ctx: CompileCtx,
  outputsByName?: Map<string, import('../l2/operation.js').FormalParam>,
  inputNames?: Set<string>
): StackEntry[] {
  // 源头取反：not(condition_expr)
  const negated: Expr = {
    type: 'op',
    name: 'not' as never,
    args: [j.trigger.condition_expr]
  }

  // 分支的 cond/judge/path-mark 名 —— legacy 使用 j.id 命名,new path 走 allocator pool
  const condName = ctx.newPath
    ? ctx.allocator!.allocateCondScratch(ctx.scopeId!)
    : condReg(j.id)
  const judgeName = ctx.newPath
    ? ctx.allocator!.allocateJudgeScratch(ctx.scopeId!)
    : judgeReg(j.id)
  const pathMarkName = ctx.newPath ? GLOBAL_PATH : PATH_MARK_REG

  // D-E2-1：路径标记——THEN/ELSE 块首各插入一条 move，记录实际走过的路径 ID，
  // 供 L3 resolveResponse 查找对应 path.response 消息模板。
  // 标记算在各块内部（先构造含标记的块，再算 cskip/skip 长度），长度自然正确。
  const thenMarked = [
    makeMove({ kind: 'literal', value: j.then_path }, { kind: 'internal', name: pathMarkName }),
    ...thenEntries
  ]
  const elseMarked = j.else_path
    ? [makeMove({ kind: 'literal', value: j.else_path }, { kind: 'internal', name: pathMarkName }), ...elseEntries]
    : elseEntries // 链式递归（无显式 else_path）时由内层分支自行标记

  // CRR T-1.6: env map 构造 —— 仅 new path 强制填充
  let envInputs: Record<string, Address> | null = null
  let envSidecar: StackEntry[] = []
  if (ctx.newPath && outputsByName && inputNames) {
    const env = buildEnvMap(j.trigger.condition_expr, ctx.scopeId, outputsByName, inputNames)
    // env 放到一个临时寄存器的 literal (object literal 作为 evaluate_expr 的 env 输入)
    const envRegName = ctx.allocator!.allocateArgtmpSlot(ctx.scopeId!)
    envSidecar.push(
      makeMove({ kind: 'literal', value: env as unknown as Value }, { kind: 'internal', name: envRegName })
    )
    envInputs = { env: { kind: 'internal', name: envRegName } }
  }

  return [
    // [0] AST literal → 寄存器
    makeMove(
      { kind: 'literal', value: negated as unknown as Value },
      { kind: 'internal', name: condName }
    ),
    // [1] evaluate_expr 求值 (env inputs as sidecar move before)
    ...envSidecar,
    {
      id: generateId('op'),
      parentIntentId: null,
      createdAt: now(),
      kind: 'execute_op',
      operation: 'evaluate_expr',
      inputs: {
        expr: { kind: 'internal', name: condName },
        ...(envInputs ?? {})
      },
      outputs: {
        result: { kind: 'internal', name: judgeName },
        error: { kind: 'internal', name: ctx.newPath ? GLOBAL_ERR : ERROR_REGISTER }
      },
      status: 'pending'
    },
    // [2] ¬c truthy（即 c falsy）→ 跳过 THEN + 尾部 skip_n，落到 ELSE
    {
      id: generateId('cskip'),
      parentIntentId: null,
      createdAt: now(),
      kind: 'conditional_skip',
      conditionAddr: { kind: 'internal', name: judgeName },
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
      const { intent: nested, bindingMoves } = makeNestedIntent(step, ctx)
      // CRR P3/T-3.2: bindingMoves 先于 nested IntentEntry 执行 (children[0] 先 pop)
      // 与 LIFO 顺序一致: push 后 nested 在栈顶之前 (后续会被压栈)
      out.push(...bindingMoves)
      out.push(nested)
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
 * - literal → 先 move 到临时寄存器 (legacy: $r_argtmp_N counter; new path: $S<scope>.argtmp<k> round-robin pool size=8)
 *   （L1 约束：execute_op.inputs 只能是 internal）
 * - input → $r_input_<name>（Step 0 已绑定,legacy + new 共用）
 * - register → legacy: 原 register 字符串; new path: 查 formalSpec[k].slotIndex → $S<scopeId>.in<k>/.out<k>
 *   - error alias slot (slotIndex === ERROR_SLOT_INDEX) → $err (GLOBAL_ERR)
 *
 * CRR T-1.3/T-1.2: register kind 在 new path 下走 slotIndex,scope 从 currentScope() 拿
 */
function expandRefs(
  refs: Record<string, ParamRef>,
  direction: 'in' | 'out',
  spec: OperationFormalSpec | undefined,
  ctx: CompileCtx
): { moves: StackEntry[]; addrs: Record<string, Address> } {
  const moves: StackEntry[] = []
  const addrs: Record<string, Address> = {}
  for (const [name, ref] of Object.entries(refs)) {
    if (ref.kind === 'literal') {
      if (direction === 'out') {
        throw new Error(`L3 compile: output param '${name}' cannot be a literal`)
      }
      const regName = ctx.newPath
        ? ctx.allocator!.allocateArgtmpSlot(ctx.scopeId!)
        : `${ARG_TMP_PREFIX}${ctx.tmpCounter++}`
      moves.push(makeMove({ kind: 'literal', value: ref.value }, { kind: 'internal', name: regName }))
      addrs[name] = { kind: 'internal', name: regName }
    } else if (ref.kind === 'input') {
      addrs[name] = { kind: 'internal', name: INPUT_PREFIX + ref.name }
    } else if (ref.kind === 'registerOutput') {
      // CRR P3/T-3.2: registerOutput 引用
      // 父 scope (ctx.scopeId) 在 compileExperience 阶段已知, 可生成确定的 source register 名
      // 父 compile 还会在 children 中插入 binding move ($Sparent.outK → $r_input_<k>),
      // 	这里生成的 move 会被 binding move 覆盖, 因此 param.value 不再需要。
      // 但 expandRefs 仍需为 child 的 $r_input_<k> 生成一个 placeholder write ——
      // 	取 parent.sourceRegister 的字符串值作为 (overwriting) literal value,不会改变物理事实
      // 	(both sides point to same register).
      // 见下方:parent compile 在 makeNestedIntent 之前插入 binding move。
      addrs[name] = { kind: 'internal', name: INPUT_PREFIX + ref.outKey }
    } else if (
      ctx.newPath &&
      ref.kind === 'register' &&
      ref.name === '$r_err'
    ) {
      // CRR P4/T-4.3: $r_err → $err (GLOBAL_ERR), 与 error output 一致
      addrs[name] = { kind: 'internal', name: GLOBAL_ERR }
    } else if (
      ctx.newPath &&
      ref.kind === 'register' &&
      ref.name === '$r_path'
    ) {
      // CRR P4/T-4.3: $r_path → $path (GLOBAL_PATH), 与 path mark 一致
      addrs[name] = { kind: 'internal', name: GLOBAL_PATH }
    } else if (
      ctx.newPath &&
      ref.kind === 'register' &&
      ref.name.startsWith('$r_')
    ) {
      // CRR P4/T-4.3: $r_* 寄存器名在 new path 下保持全局（不 scope-prefix）
      // 原因:大量经验依赖 $r_cur/$r_content/$r_bytes 等作为跨帧/跨经验全局寄存器，
      // scope-prefixing 会破坏此机制。
      addrs[name] = { kind: 'internal', name: ref.name }
    } else if (
      ctx.newPath &&
      direction === 'in' &&
      /^\$r_/.test(ref.name) &&
      !(ref.name.startsWith('$S') || ref.name === '$err' || ref.name === '$path' || ref.name === '$r_err' || ref.name === '$r_path')
    ) {
      // CRR P3/T-D1-fix: intra-frame cross-op output 复用 —— input-side `{kind:'register',name:'$r_<X>'}`
      // 应解析到写入该逻辑值的 op 的 OUT slot ($S<scope>.out<K>),而非当前 op 自身 INPUT slot
      const aliasMatch = ref.name.match(/^\$r_(.+)$/)
      let fp2: import('../l2/operation.js').FormalParam | undefined
      if (aliasMatch) fp2 = ctx.outputsByAlias?.get(aliasMatch[1]) ?? ctx.outputsByAlias?.get(name)
      if (!fp2) fp2 = spec!.inputs[name]
      if (!fp2) {
        throw new Error(
          `L3 compile: op '${ctx.currentOpName ?? '?'}' register input '${name}'=${ref.name} — ` +
          `no formalSpec for in.${name}, no matching earlier-step output, and not a global register`
        )
      }
      addrs[name] = { kind: 'internal', name: `$S${ctx.scopeId}.out${fp2.slotIndex}` }
    } else if (ctx.newPath && spec) {
      // register kind（保留原分支：direction='out'，或 direction='in' 且未命中跨 op out-slot 别名）
      const fp = (direction === 'in' ? spec.inputs : spec.outputs)[name]
      if (!fp) {
        throw new Error(
          `L3 compile: op '${ctx.currentOpName ?? '?'}' has no formalSpec for ${direction}.${name} ` +
          `(ParamRef points to non-existent slot)`
        )
      }
      if (fp.slotIndex === 99) {
        // ERROR_SLOT_INDEX → $err
        addrs[name] = { kind: 'internal', name: GLOBAL_ERR }
      } else {
        const slotName = direction === 'in'
          ? `$S${ctx.scopeId}.in${fp.slotIndex}`
          : `$S${ctx.scopeId}.out${fp.slotIndex}`
        addrs[name] = { kind: 'internal', name: slotName }
      }
    } else {
      // legacy path 直接用 ref.name (legacy register 字符串)
      addrs[name] = { kind: 'internal', name: ref.name }
    }
  }
  return { moves, addrs }
}

/**
 * 编译单个 L2 op 调用：sidecar moves + OpEntry。
 *
 * CRR T-1.2: 新路径下,output register ref 通过 formalSpec.outputs[k].slotIndex 解析,
 *   构造 $S<scopeId>.out<k> 名字。legacy 路径仍用 ref.name 字面量。
 */
export function compileOp(
  opName: string,
  inputRefs: Record<string, ParamRef>,
  outputRefs: Record<string, ParamRef>,
  idPrefix: string,
  ctx: CompileCtx
): StackEntry[] {
  const spec = ctx.registry.getSpec(opName)
  ctx.currentOpName = opName
  const ins = expandRefs(inputRefs, 'in', spec, ctx)
  const outs = expandRefs(outputRefs, 'out', spec, ctx)

  // CRR T-1.6/P4: evaluate_expr 在 new path 下需要 env map（与 compileBranch 一致）
  // 否则 var.name='$r_err' 等找不到对应寄存器而 VARIABLE_NOT_FOUND
  let envSidecar: StackEntry[] = []
  let envAddr: Record<string, Address> | undefined
  if (ctx.newPath && opName === 'evaluate_expr' && ctx.scopeId && ctx.outputsByAlias) {
    // 从 inputRefs.expr 提取 Expr AST（literal ParamRef 的 value）
    const exprRef = inputRefs.expr
    if (exprRef && exprRef.kind === 'literal') {
      const expr = exprRef.value as unknown as import('../l2/builtins/evaluate-expr.js').Expr
      const inputNames = new Set(Object.keys(ctx.intent.params ?? {}))
      const env = buildEnvMap(expr, ctx.scopeId, ctx.outputsByAlias, inputNames)
      const envRegName = ctx.allocator!.allocateArgtmpSlot(ctx.scopeId!)
      envSidecar.push(
        makeMove({ kind: 'literal', value: env as unknown as Value }, { kind: 'internal', name: envRegName })
      )
      envAddr = { env: { kind: 'internal', name: envRegName } }
    }
  }

  return [
    ...ins.moves,
    ...envSidecar,
    ...outs.moves, // outputs 一般无 literal，但保持对称（会 throw）
    {
      id: generateId(idPrefix.slice(0, 4)),
      parentIntentId: null,
      createdAt: now(),
      kind: 'execute_op',
      operation: opName,
      inputs: { ...ins.addrs, ...(envAddr ?? {}) },
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
 *
 * CRR T-1.3: 不在此处 enterScope —— compileExperience 顶层已经 enter 了一层,
 *   nested intent 的 scope 需在 executeIntent 执行时 (main-loop T-1.5 hook)
 *   再 enter。scopeId 由 main-loop 分配并写回 IntentEntry.scopeId,
 *   避免与 compileExperience 的 ctx.scopeId 冲突。
 */
function makeNestedIntent(
  step: OpStep,
  ctx: CompileCtx
): { intent: StackEntry & { kind: 'execute_intent' }; bindingMoves: StackEntry[] } {
  const nestedExp = ctx.experiences.get(step.operation)!
  const params: Record<string, unknown> = {}
  // CRR P3/T-3.2: 收集 registerOutput 引用所需的 binding moves
  // 这些 move 在 compileSteps 中插入到 children 中, 使其先于本 IntentEntry 执行 (LIFO 顺序)
  const bindingMoves: StackEntry[] = []
  for (const [k, ref] of Object.entries(step.inputs)) {
    if (ref.kind === 'literal') {
      params[k] = ref.value
    } else if (ref.kind === 'input') {
      params[k] = ctx.intent.params[ref.name]
    } else if (ref.kind === 'registerOutput') {
      // CRR P3/T-3.2: 解析源经验 → formalSpec.outputs[outKey].slotIndex → 父 scope 下寄存器名
      // 注意:仅 newPath 下能保证 $Sparent.outK 与 源经验 formalSpec.outputs[outKey].slotIndex 一致;
      // 	 legacy path 下需要 fallback (ref.outKey 直接作为 register 名)
      const srcExp = ref.expId ? ctx.experiences.get(ref.expId) : undefined
      if (ctx.newPath && srcExp) {
        // 源经验的 op 是什么?  对于 pre_processing/target_op.paths[*].steps 中的 step,
        // source register 一定是某个 step 的 outputs[k]。我们检查 formalSpec:取 formalSpec.outputs[k].slotIndex
        // 但这里 ctx 只暴露 experiences Map, 没有 step 名。简化:在 sourceExp.outputs 上面查 outKey 对应的 type,
        // 找到该 outKey 是哪个 op formalSpec 的输出 → slotIndex
        // 取 sourceExp.outputs (业务字段名) 反查:   sourceExp.target_op.paths[*].steps[].outputs[k] = {kind:'register',name:'$r_<X>'}
        // 然后看那个 step.operation 的 formalSpec.outputs 对应 key。
        const stepRef = findStepProducingOutput(srcExp, ref.outKey)
        if (!stepRef) {
          throw new Error(
            `L3 compile: registerOutput {expId:'${ref.expId}',outKey:'${ref.outKey}'} — ` +
            `source experience '${srcExp.id}' has no step that produces output '${ref.outKey}'`
          )
        }
        const opSpec = ctx.registry.getSpec(stepRef.operation)
const fp = opSpec?.outputs?.[ref.outKey]
        if (!fp) {
          // T-3.3: 悬空 outKey → ParamRefError
          throw new ParamRefError(
            `registerOutput ${JSON.stringify({ expId: ref.expId ?? null, outKey: ref.outKey })} — ` +
            `source experience '${srcExp.id}'.target_op default_path 中找不到产出 outKey='${ref.outKey}' 的 step`
          )
        }
        // T-3.3: type mismatch 检测 (源输出 vs 目标经验 inputs[k].type)
        checkRegisterOutputTypeCompat(nestedExp, k, srcExp, ref.outKey, fp.type)
        if (fp.slotIndex === 99) {
          // ERROR_SLOT_INDEX → 全局 $err, 无需 binding move
          params[k] = undefined  // nested compile 时 $r_input_<k> 不会被读;取 $err (GLOBAL_ERR) 读
        } else if (srcExp.outputs_bindings?.[ref.outKey]?.persist === true && ref.expId) {
          // P3/T-3.2 主路径: source exp 声明了 persist:true binding → 通过 publicStore 间接引用
          // post-bindings Step5 (T-2.2) 已在 source frame exit 前写入 publicStore[srcExp.id].<outKey>
          const pubName = `${ref.expId}.${ref.outKey}`
          params[k] = undefined
          bindingMoves.push(makeMove(
            { kind: 'public', name: pubName },
            { kind: 'internal', name: INPUT_PREFIX + k }
          ))
        } else {
          // Fallback: legacy / no-persist case — 直接用源经验的 internal 寄存器名 ($r_<outKey>)
          console.warn(
            `[CRR P3/T-3.2 warn] exp '${step.operation}' param ${k} references ` +
            `'${ref.expId ?? '?'}'.outputs.${ref.outKey}, but source has no ` +
            `'outputs_bindings[${JSON.stringify(ref.outKey)}].persist:true' — using legacy register; ` +
            `add explicit declaration for reliable cross-scope reference.`
          )
          params[k] = undefined
          bindingMoves.push(makeMove(
            { kind: 'internal', name: `$r_${ref.outKey}` },
            { kind: 'internal', name: INPUT_PREFIX + k }
          ))
        }
      } else {
        // legacy path: 直接用 $r_<outKey> 作为 source register 名 (与体验库现有约定一致)
        const legacyReg = `$r_${ref.outKey}`
        params[k] = undefined
        bindingMoves.push(makeMove(
          { kind: 'internal', name: legacyReg },
          { kind: 'internal', name: INPUT_PREFIX + k }
        ))
      }
    } else {
      throw new Error(
        `L3 compile: nested experience '${step.operation}' param '${k}' uses register ref — ` +
        'not supported in Phase C MVP (literal/input only)'
      )
    }
  }
  // 将 bindingMoves 暂存在 IntentEntry 上 (实际插入由 compileSteps 包装)
  const intent: StackEntry & { kind: 'execute_intent' } = {
    id: generateId('intent'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'execute_intent',
    intent: { type: step.operation, params },
    phase: 'pending',
    children: [],
    handleError: nestedExp.handleError ?? false,
    // CRR T-1.3: 嵌套 intent 的 scopeId 由 main-loop (T-1.5) 在 processIntentEntry
    // 阶段 fresh enterScope 后写入。compileExperience 阶段的 ctx.scopeId 是父 scope,
    // 不可用于嵌套 intent —— 嵌套是子 frame,理应有自己的 scope。
    scopeId: undefined,
    // CRR P3/T-3.2: registerOutput 引用已通过 binding move 填充到 $r_input_<k>
    prefilledInputKeys:
      Array.from(
        Object.keys(step.inputs).filter(k => (step.inputs as any)[k].kind === 'registerOutput')
      ) ? new Set(Object.keys(step.inputs).filter(k => (step.inputs as any)[k].kind === 'registerOutput')) : undefined
  }
  return { intent, bindingMoves }
}

/**
 * CRR P3/T-3.2 helper: 在 source experience 中查找产出 outKey 的 step (取首个)
 *
 * 检查顺序: pre_processing → target_op.paths[*].steps (合并去重)
 * 仅用于 registerOutput 类型检查 (param values 独立走 binding move)。
 */
function findStepProducingOutput(
  srcExp: Experience,
  outKey: string
): { operation: string } | null {
  const check = (steps: OpStep[] | undefined): { operation: string } | null => {
    if (!steps) return null
    for (const s of steps) {
      if (s.outputs && outKey in s.outputs) return { operation: s.operation }
    }
    return null
  }
  // pre_processing + 所有 target_op.paths[*].steps
  // 为简化:只看 default_path
  const def = srcExp.target_op.paths.find(p => p.id === srcExp.target_op.default_path)
  return check(srcExp.pre_processing as unknown as OpStep[] | undefined) || check(def?.steps) || null
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

/**
 * CRR P3/T-3.3 — registerOutput 引用在 compile-time 的类型 / 悬空检测错误。
 *
 * 子类化 Error; name='ParamRefError'; message 含 expId/outKey/type mismatch 上下文。
 */
export class ParamRefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParamRefError'
  }
}

/**
 * CRR P3/T-3.3 — registerOutput type-compat check (best-effort, lenient on missing schema).
 *
 * - source type 来自 op formalSpec.outputs[outKey].type
 * - dest   type 来自 child experience inputs[paramKey].type (若声明)
 * - 'any' / undefined → wildcard, 不报 mismatch
 * - 两边都有具体值且不一致 → throw ParamRefError('incompatible type: ...')
 */
function checkRegisterOutputTypeCompat(
  childExp: Experience,
  paramKey: string,
  srcExp: Experience,
  outKey: string,
  srcType: string | undefined
): void {
  const dstSchema = childExp.inputs?.[paramKey]
  if (!dstSchema || !srcType) return // best-effort: 未声明或无源型 → skip
  const dstType: string | undefined = dstSchema.type as unknown as string | undefined
  if (
    dstType &&
    dstType !== 'any' &&
    srcType !== 'any' &&
    dstType !== srcType
  ) {
    throw new ParamRefError(
      `registerOutput ${JSON.stringify({ expId: srcExp.id ?? null, outKey })} → child '${childExp.id}' input '${paramKey}': incompatible type (${srcType}) -> (${dstType})`
    )
  }
}

// re-export 类型便于测试引用
export type { PreProcessing, ConditionalJudgment, Expr }
