/**
 * L3 结果消息解析（D-E2-1，2026-08-20）
 *
 * @see ./experience.ts（TargetOpPath.response / Experience.responses.failure）
 *
 * 职责边界：
 * - **L3** 确定信息内容：根据实际走过的路径 + $r_err，从经验定义中选出
 *   正确/错误时的消息模板并插值——业务含义判断在 L3
 * - **L4** 只做渲染：拿到确定的 message 字符串直接返回给用户
 *
 * 消息优先级：
 *   1. $r_err 非空 → failure[err.code] ?? failure['*'] ?? 默认失败格式
 *   2. $r_path 标记 → 对应 path.response
 *   3. 兜底 → default_path.response ?? "已完成 <experience.id>"
 */

import type { Experience } from './experience.js'
import type { Value } from '../l1/types.js'
import { ERROR_REGISTER, isOperationError } from '../l2/errors.js'

/** 编译器写入的路径标记寄存器（与 compiler.ts PATH_MARK_REG 一致）*/
const PATH_MARK_REG = '$r_path'

/**
 * 模板插值：{name} 替换。
 *
 * 变量查找顺序：
 * 1. err.code / err.message（错误信息）
 * 2. 寄存器去前缀名：$r_input_path → path；$r_content → content；$r_bytes → bytes
 */
function interpolate(template: string, vars: Record<string, Value>): string {
  return template.replace(/\{([^}]+)\}/g, (raw, key: string) => {
    const v = vars[key]
    return v === undefined || v === null ? raw : String(v)
  })
}

/** 从寄存器表构建插值变量 */
function buildVars(registers: Record<string, Value>, err: Value): Record<string, Value> {
  const vars: Record<string, Value> = {}
  for (const [k, v] of Object.entries(registers)) {
    if (!k.startsWith('$r_')) continue
    if (k === ERROR_REGISTER || k === PATH_MARK_REG) continue
    // $r_input_x → x；$r_xxx → xxx；$r_argtmp_*/$r_cond_*/$r_judge_* 由调用方过滤
    const name = k.startsWith('$r_input_') ? k.slice('$r_input_'.length) : k.slice('$r_'.length)
    if (name.length > 0 && !(name in vars)) vars[name] = v
  }
  if (isOperationError(err)) {
    vars['err.code'] = err.code
    vars['err.message'] = err.message
  }
  return vars
}

/**
 * 解析经验的用户可读结果消息。
 *
 * @param exp 执行的经验定义
 * @param registers 业务寄存器（应已过滤编译器临时寄存器）
 * @returns 插值后的中文消息
 */
export function resolveResponse(
  exp: Experience,
  registers: Record<string, Value>
): string {
  const err = registers[ERROR_REGISTER] ?? null

  // ---- 优先级 1: 失败显性化 ----
  if (err !== null && err !== undefined) {
    const failureMap = exp.responses?.failure
    if (failureMap) {
      const code = isOperationError(err) ? err.code : '*'
      const tpl = failureMap[code] ?? failureMap['*']
      if (tpl) return interpolate(tpl, buildVars(registers, err))
    }
    if (isOperationError(err)) {
      return `操作失败：[${err.code}] ${err.message}`
    }
    return '操作失败'
  }

  // ---- 优先级 2: 实际路径的 response ----
  const pathId = registers[PATH_MARK_REG]
  if (typeof pathId === 'string') {
    const path = exp.target_op.paths.find(p => p.id === pathId)
    if (path?.response) {
      return interpolate(path.response, buildVars(registers, null))
    }
  }

  // ---- 优先级 3: default_path 的 response ----
  const fallback = exp.target_op.paths.find(p => p.id === exp.target_op.default_path)
  if (fallback?.response) {
    return interpolate(fallback.response, buildVars(registers, null))
  }
  return `已完成 ${exp.id}`
}
