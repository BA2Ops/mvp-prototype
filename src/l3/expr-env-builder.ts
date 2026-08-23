/**
 * CRR P1/T-1.6 evaluate_expr env map 显式填充 (D-5 修复)
 *
 * @see docs/mvp/19c-implementation-plan.md §三 T-1.6
 * @see docs/mvp/19b-register-design.md §五 R5.5
 *
 * 背景:
 * - evaluate_expr op 通过 env map (var.name → register name) 解析变量引用
 * - legacy path: env 由调用方构造并作为 input 传入;否则使用 fallback `?? name`
 *   (假定 var.name == register name) — 这一巧合让 legacy 表达式直接工作
 * - new path: var.name = '$r_content' (legacy 寄存器名),但实际数据已写到
 *   $S<scopeId>.out<k> (CRR slot),fallback 找不到 → VARIABLE_NOT_FOUND 异常
 *
 * 修复:
 * - compiler.new path 在调用 evaluate_expr 时,显式构造 env map
 * - env 映射规则:
 *   - 解析 Expr AST,收集所有 { type: 'var', name } 节点
 *   - 对每个 var.name,通过 experience 上下文找出"它实际指向哪里":
 *     a) 表达式定义时使用了 literal 寄存器名 ($r_<output_business_name>)
 *        → 对应 op 的 formalSpec.outputs[k].slotIndex,env[name] = $S<scopeId>.out<k>
 *     b) global functional register ($r_err / $err) → env[name] = $err
 *     c) input ($r_input_<key>) → env[name] = $r_input_<key>
 *     d) 其他 (legacy 业务寄存器) → env[name] = 原 var.name
 *
 * - 调用方负责把 env 作为 evaluate_expr 的 inputs.env (object literal)
 *   (注意:evaluate_expr 当前 inputs.env 是 optional,本 PR 增强为 filled by compiler)
 */

import type { Expr } from '../l2/builtins/evaluate-expr.js'
import type { OperationFormalSpec, FormalParam } from '../l2/operation.js'
import { GLOBAL_ERR } from './crr-config.js'

/**
 * 表达式 var.name → register name 的解析结果
 *
 * - resolved: 是否能确定映射(否则用 fallback = var.name)
 * - registerName: 解析到的 register 字符串
 * - reason: 'global' | 'slot' | 'input' | 'literal-name' | 'fallback'
 */
export interface VarResolution {
  resolved: boolean
  registerName: string
  reason: 'global' | 'slot' | 'input' | 'literal-name' | 'fallback'
}

/**
 * 收集 Expr AST 中所有 { type: 'var', name } 节点
 *
 * 重复 name 返回多次(代表多次引用),调用方用 Set 去重
 */
export function collectVarNames(expr: Expr): string[] {
  const out: string[] = []
  walk(expr, out)
  return out
}

function walk(expr: Expr, out: string[]): void {
  if (expr.type === 'literal') return
  if (expr.type === 'var') {
    out.push(expr.name)
    return
  }
  if (expr.type === 'op') {
    for (const arg of expr.args) walk(arg, out)
    return
  }
  if (expr.type === 'if') {
    walk(expr.cond, out)
    walk(expr.then, out)
    walk(expr.else, out)
  }
}

/**
 * CRR env 构造:为 Expr AST 收集所有 var.name → register name 映射
 *
 * @param expr 待求值表达式 AST
 * @param scopeId 当前 frame scope (new path 必填)
 * @param outputsByName 当前经验可见的 output 名 → formalSpec FormalParam (经 params 聚合)
 *        - 经验定义中 step.outputs[k].kind === 'register' 时, businessName 来自 op's formalSpec
 *        - 经验输入 ($r_input_<key>) 永远可见
 *        - global functional regs ($err / $path) 永远可见
 * @param inputNames 经验 schema 声明的 input 名(供 $r_input_<name> 解析)
 *
 * @returns env map (Record<string,string>),可直接喂给 evaluate_expr
 *
 * 解析优先级:
 *  1. global functional reg ($err / $path) → GLOBAL_ERR / GLOBAL_PATH
 *  2. input ($r_input_<inputName>) → $r_input_<inputName>
 *  3. step outputs (按 businessName 反查 formalParam.slotIndex) → $S<scopeId>.out<k>
 *  4. legacy 业务寄存器 ($r_<X>) → 原 var.name (fallback 语义)
 */
export function buildEnvMap(
  expr: Expr,
  scopeId: string | null,
  outputsByName: Map<string, FormalParam>,
  inputNames: Set<string>
): Record<string, string> {
  const env: Record<string, string> = {}
  const varNames = new Set(collectVarNames(expr))
  const newPath = scopeId !== null

  for (const name of varNames) {
    const resolution = resolveVar(name, scopeId, outputsByName, inputNames)
    env[name] = resolution.registerName
    // 调试钩子:new path 下若 fallback (legacy name) 可能造成运行时 VARIABLE_NOT_FOUND
    if (newPath && resolution.reason === 'fallback') {
      // 仍记录,但不报错 —— 允许 legacy 业务寄存器在 new path 下兼容
      // (P3 register ref defer 改造时升级为编译期 ParamRefError)
    }
  }
  return env
}

/**
 * 单个 var.name 的解析(独立出来便于单测 + 复用)
 */
export function resolveVar(
  name: string,
  scopeId: string | null,
  outputsByName: Map<string, FormalParam>,
  inputNames: Set<string>
): VarResolution {
  // 1. global functional
  if (name === '$err' || name === '$r_err' || name === '$path' || name === '$r_path') {
    if (name === '$err' || name === '$r_err') {
      return { resolved: true, registerName: GLOBAL_ERR, reason: 'global' }
    }
    return { resolved: true, registerName: '$path', reason: 'global' }
  }
  // 2. input ($r_input_<name>)
  for (const inputName of inputNames) {
    if (name === `$r_input_${inputName}`) {
      return { resolved: true, registerName: name, reason: 'input' }
    }
  }
  // 3. step output: $r_<X> (legacy) → $S<scopeId>.out<slotIndex>
  //    注:experience.library 里 ref.name = '$r_<X>' 中 X 是 legacy 简称,
  //    可能与 op formalSpec.outputs[businessName] 的 businessName 不同
  //    (e.g. experience 用 '$r_bytes',op spec 用 'bytes_written')。
  //    索引策略: outputsByName 同时索引 [aliasName, businessName]
  const legacyMatch = name.match(/^\$r_(.+)$/)
  if (legacyMatch) {
    const aliasName = legacyMatch[1]
    if (aliasName === 'err') {
      return { resolved: true, registerName: GLOBAL_ERR, reason: 'slot' }
    }
    // 优先查 aliasName;若没有,查常见业务名 (content/exists/bytes_written/probe 等)
    let fp = outputsByName.get(aliasName)
    if (!fp) {
      // 尝试常见别名
      const aliases: Record<string, string> = {
        'bytes': 'bytes_written',
        'count': 'count',
        'exists': 'exists',
        'probe': 'probe',
        'replaced': 'replaced'
      }
      const realBusinessName = aliases[aliasName]
      if (realBusinessName) fp = outputsByName.get(realBusinessName)
    }
    if (fp) {
      if (fp.slotIndex === 99) {
        return { resolved: true, registerName: GLOBAL_ERR, reason: 'slot' }
      }
      if (scopeId) {
        return {
          resolved: true,
          registerName: `$S${scopeId}.out${fp.slotIndex}`,
          reason: 'slot'
        }
      }
      return { resolved: true, registerName: name, reason: 'literal-name' }
    }
  }
  // 4. fallback: var.name == register name (legacy 兼容)
  return { resolved: false, registerName: name, reason: 'fallback' }
}

/**
 * 从 spec 构造 outputsByName 索引 (供 buildEnvMap 调用)
 *
 * @param spec op formalSpec
 * @returns Map<businessName, FormalParam>
 */
export function indexOutputsByName(spec: OperationFormalSpec): Map<string, FormalParam> {
  return new Map(Object.entries(spec.outputs))
}