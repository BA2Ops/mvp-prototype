/**
 * CRR (Compiler Register-file Redesign) 常量与类型定义
 *
 * @see docs/mvp/19-register-file-core.md (核心需求 C1-C5)
 * @see docs/mvp/19b-register-design.md  (详细设计 R5.x/R6.x)
 * @see docs/mvp/19c-implementation-plan.md (实施计划 P0-P4)
 *
 * 本文件是 CRR 新路径的唯一常量源。旧路径不变（compiler.ts 内部分支控制）。
 * P4 末 feature flag 移除时,本模块的全部常量会被 promotion 为 hardcode。
 */

// ============== Slot Pool 容量常量 ==============
// 来源:P0/T-0.1 formalSpec dump (2026-08-22) + doc 19 §三核算 + doc 19 §评审 checklist ② 修订

/** 每 op 最多 input slot 数 (= string_replace formalSpec.inputs 计数)
 *  来源:scripts/dump-formal-spec.ts P0 实证 —— string_replace 有 5 个 inputs
 *  (text/find/replace/regex/replace_all);原 M_max=4 假设被打破,上调至 5 */
export const M_MAX = 5

/** 每 op 最多 output slot 数 (= grep_search formalSpec.outputs 非 error 计数)
 *  11 条 op 全部有 $r_err alias,error slot 复用 global $err 不计入 P_max */
export const P_MAX = 3

/** 文字参数 sidecar pool 大小 (round-robin) —— 必须 >= M_MAX 留缓冲 */
export const LITERAL_POOL_SIZE = 8

/** judgment/condition scratch pool 大小 (≤ J_max × 2 per-scope)
 *  J_max=5 个 judgments / scope,每 judgment 最多 2 枚 scratch (cond_/judge_) */
export const JUDGE_COND_POOL_SIZE = 10

/** FrameScope 嵌套深度软限 = 与 A11 RecursionDepthError 并列检查
 *  P4/T-4.3: 从 8 提到 1024（匹配 DEFAULT_MAX_RECURSION_DEPTH=1000 + 余量），
 *  允许 counter 等递归经验深度嵌套。
 *  U_max 随之调整为线性上限公式（见下方 U_MAX_P1_ESTIMATE 注释）。 */
export const MAX_ACTIVE_SCOPES = 1024

/** Global functional registers 枚举 (C4)
 *  现状 {$err,$path} = 2 枚;预留空位 ≤ 6 (N6 冻结线)
 *  全库 new addition 必须走 doc 19 变更流程 */
export const GLOBAL_FUNCTIONAL_REGS = ['$err', '$path'] as const
export type GlobalRegName = typeof GLOBAL_FUNCTIONAL_REGS[number]

/** 错误寄存器名 (兼容旧名 $r_err —— P4 末清理前保留过渡 alias) */
export const GLOBAL_ERR = '$err' as const

/** 路径标记寄存器名 (兼容旧名 $r_path —— resolveResponse 行为不变) */
export const GLOBAL_PATH = '$path' as const

/** 旧错误寄存器名 (transition alias, P4 删除) */
export const LEGACY_ERROR_REGISTER = '$r_err' as const

/** 旧路径标记寄存器名 (transition alias, P4 删除) */
export const LEGACY_PATH_REGISTER = '$r_path' as const

// ============== U_max 估算 (P0/T-0.1 实证修订 + P4/T-4.3 调整) ==============
// 来源:doc 19 K3 + scripts/dump-formal-spec.ts 修正(M_max 4→5 后的重算)
//
// P4/T-4.3 调整:
// - MAX_ACTIVE_SCOPES 从 8 提到 1024，U_max 线性上限随之增大。
// - 但 P4 实测峰值(全量 e2e + demos)仅 12，远低于估算。
// - $r_* 全局寄存器在 new path 下不 scope-prefix（T-4.3 改动），
//   formalSpec outputs 仍走 slotIndex scope-prefixing。
// - 以下估算保留为理论上限；实测峰值 12 已记录在 doc 19 N4。
//
// 公式:
//   U_max = GlobalRegs(2)
//         + LiteralPool(LITERAL_POOL_SIZE)
//         + JudgeCondPool(JUDGE_COND_POOL_SIZE)
//         + inSlots(M_MAX × MAX_ACTIVE_SCOPES)
//         + outSlots(P_MAX × MAX_ACTIVE_SCOPES)
//         = 2 + 8 + 10 + 5×1024 + 3×1024 = 8202
//
// ⚠️ 这是理论上限,P4 实测峰值=12（远低于此）；doc 19 N4 冻结线
export const U_MAX_P1_ESTIMATE = 2 + LITERAL_POOL_SIZE + JUDGE_COND_POOL_SIZE
                              + M_MAX * MAX_ACTIVE_SCOPES
                              + P_MAX * MAX_ACTIVE_SCOPES

// ============== Scope Prefixing ==============

/** Frame scope key 前缀 —— 物理 internalStore key = `${SCOPE_PREFIX}<scopeId>.in<k>` */
export const SCOPE_PREFIX = '$S' as const

/** 生成 scope-prefixed slot name (in slot)
 *  例: scopeInSlotName('A1', 0) = '$SA1.in0' */
export function scopeInSlotName(scopeId: string, slotIndex: number): string {
  return `${SCOPE_PREFIX}${scopeId}.in${slotIndex}`
}

/** 生成 scope-prefixed slot name (out slot) */
export function scopeOutSlotName(scopeId: string, slotIndex: number): string {
  return `${SCOPE_PREFIX}${scopeId}.out${slotIndex}`
}

/** 生成 argtmp pool slot name (per-scope round-robin) */
export function scopeArgtmpSlotName(scopeId: string, poolIndex: number): string {
  return `${SCOPE_PREFIX}${scopeId}.argtmp${poolIndex % LITERAL_POOL_SIZE}`
}

/** 生成 judge/cond scratch slot name (per-scope round-robin) */
export function scopeJudgeScratchName(scopeId: string, kind: 'cond' | 'judge', scratchIndex: number): string {
  return `${SCOPE_PREFIX}${scopeId}.${kind}${scratchIndex % JUDGE_COND_POOL_SIZE}`
}

// ============== Type Guards ==============

/** 判断一个 register 名是否属于 global functional registers (不参与 scope prefixing) */
export function isGlobalFunctionalReg(name: string): boolean {
  return (GLOBAL_FUNCTIONAL_REGS as readonly string[]).includes(name)
}

/** 判断一个 register 名是否是 legacy 旧名 (过渡期兼容) */
export function isLegacyRegisterName(name: string): boolean {
  return name === LEGACY_ERROR_REGISTER || name === LEGACY_PATH_REGISTER
}