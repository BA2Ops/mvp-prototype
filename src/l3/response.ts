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
import { GLOBAL_ERR, isOperationError } from '../l2/errors.js'
import { GLOBAL_PATH } from './crr-config.js'
import { LEGACY_ERROR_REGISTER, LEGACY_PATH_REGISTER } from './crr-config.js'

/** CRR P1 重命名后的错误寄存器/路径寄存器(主推) */
// (GLOBAL_ERR = '$err', GLOBAL_PATH = '$path')
/** Legacy 别名(P4 末删除;本文件同时读双名以兼容过渡期) */

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
    // 跳过两种 prefix:
    // 1. legacy $r_* (含 $r_input_ / $r_argtmp_ / $r_cond_ / $r_judge_)
    // 2. CRR $S*.* (scope-prefixed,应由 caller 调用前过滤)
    if (!k.startsWith('$r_') && !k.startsWith('$S')) continue
    if (k === GLOBAL_ERR || k === GLOBAL_PATH || k === LEGACY_ERROR_REGISTER || k === LEGACY_PATH_REGISTER) continue
    // $r_input_x → x；$r_xxx → xxx；$r_argtmp_*/$r_cond_*/$r_judge_* 由调用方过滤
    const name = k.startsWith('$r_input_')
      ? k.slice('$r_input_'.length)
      : k.startsWith('$S') ? k : k.slice('$r_'.length)
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
 *
 * CRR P1: 读 $err (主) / $r_err (legacy fallback);读 $path (主) / $r_path (legacy)
 */
export function resolveResponse(
  exp: Experience,
  registers: Record<string, Value>
): string {
  const err = registers[GLOBAL_ERR] ?? registers[LEGACY_ERROR_REGISTER] ?? null

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
  const pathId = registers[GLOBAL_PATH] ?? registers[LEGACY_PATH_REGISTER]
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
