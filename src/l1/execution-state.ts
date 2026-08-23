/**
 * L1 调度器运行时状态（双区架构版）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §二
 * @see ../../docs/mvp/09-l1-implementation.md §5
 * @see docs/mvp/19-register-file-core.md (CRR 核心需求)
 * @see docs/mvp/19b-register-design.md  (CRR 详细设计)
 *
 * 完整设计：
 * - 双区存储：publicStore（业务）+ internalStore（寄存器）
 * - RegisterAllocator：每个外部意图处理循环初始化一次（legacy, deprecated P4 删除）
 * - FrameScopeAllocator：CRR 新路径,Frame scope prefixing + fixed-slot pool
 * - $r_err / $err 保留为错误寄存器（不参与普通分配）
 */

import type { StackEntry, Value } from './types.js'
import type { L2Registry } from '../l2/registry.js'
import type { L3Service } from '../l3/service.js'
import { ERROR_REGISTER } from '../l2/errors.js'
import {
  MAX_ACTIVE_SCOPES,
  LITERAL_POOL_SIZE,
  JUDGE_COND_POOL_SIZE,
  GLOBAL_ERR
} from '../l3/crr-config.js'

// ============== Legacy Register Allocator（保留，P4 删除）==============
/**
 * L1 寄存器分配器（Legacy）
 *
 * 职责：
 * - 分配新的寄存器名（$r0, $r1, $r2,...）
 * - $r_err 保留（不参与普通分配）
 *
 * 生命周期：
 * - 每个外部意图处理循环初始化一次
 * - L1 创建，L3 通过 state.allocator 访问
 * - 子意图重用同一 allocator
 *
 * MVP 简化：分配后不回收（register 名单调递增）
 *
 * @deprecated CRR P1 起由 FrameScopeAllocator 替代；P4 末删除
 */
export class RegisterAllocator {
  private counter = 0

  /**
   * 分配下一个可用寄存器
   * @returns 寄存器名（如 '$r0'）
   */
  allocate(): string {
    return `$r${this.counter++}`
  }

  /**
   * 获取当前已分配的最大寄存器编号（用于调试）
   */
  maxAllocated(): number {
    return this.counter
  }

  /**
   * 重置分配器（用于新的外部意图处理循环）
   */
  reset(): void {
    this.counter = 0
  }

  /**
   * 错误寄存器（全局共享，特殊处理）
   *
   * 不通过 allocate() 分配，是保留名
   */
  static errorRegister(): string {
    return ERROR_REGISTER
  }
}

// ============== Frame Scope Allocator (CRR P1 新增) ==============
/**
 * CRR FrameScopeAllocator：frame-aware 寄存器名生成器
 *
 * 核心职责（替换原 RegisterAllocator）:
 * 1. 维护 active scope stack (CALL 嵌套的语义边界)
 * 2. 每 op 输入/输出 slot = scope-prefixed 固定编号 ($S<scopeId>.in<k> / .out<k>)
 * 3. literal sidecar pool round-robin (size=8,消除 $r_argtmp_N 自增无界增长)
 * 4. judge/cond scratch pool round-robin (size≤10)
 * 5. MAX_ACTIVE_SCOPES=8 软限 (与 A11 RecursionDepthError 并列检查,
 *    doc 19 K3 ×maxConcurrentScopes=8 是 U_max≈84 核算口径的前提)
 *
 * 为什么不“每个 scope 独立 Map”而是“scope-prefixed shared Map”：
 * - internalStore 是 Map<string,Value>,名字不同=不同 entry,物理上隔离 (doc 19 K4)
 * - 避免每个 scope 创建/销毁 Map 的 GC 开销
 * - 简化 L1 Address/execute_op/move primitive(不变,只认字符串名)
 *
 * CALL/RET convention (doc 19 K4):
 * - 父 frame A 的 out slot ($SA.outK) 在 A pending→done+pop 期间稳定存活
 * - 被子 frame B 引用 = B.bindInputs 生成 makeMove(from=$SA.outK, to=$SB.in<k>)
 * - $SA.outK 可被同 experience 后续 step 覆写(caller-saved,合法)
 * - A done+pop 后 $SA.* 不主动回收,残留在 internalStore 直到后续覆盖 (P4+ 可优化)
 *
 * R-1🔴高 风险点(对称性):
 * - bubbleError abortFrame 必须同步 exitScope(),不则计数器泄漏 → U_max 超限
 * - 本类提供 enterScope/exitScope 双侧 hook,调用方(main-loop.ts T-1.5)必须对称调用
 */
export class FrameScopeAllocator {
  /** scope stack —— 栈顶 = current scope */
  private scopeStack: string[] = []

  /** per-scope literal pool cursor (round-robin index, LITERAL_POOL_SIZE modulus) */
  private argtmpCursors = new Map<string, number>()

  /** per-scope cond scratch cursor (獨立 counter,防止 cond/judge 互相污染 pool index) */
  private condCursors = new Map<string, number>()

  /** per-scope judge scratch cursor (獨立 counter) */
  private judgeCursors = new Map<string, number>()

  /** 全局 scopeId 计数器 (与 experience 嵌套无关,单调递增供唯一性) */
  private globalScopeCounter = 0

  /** 当前 active scope 数量 (同步辅助计数器,与 scopeStack.length 同值但便于 O(1) 检查) */
  private activeScopeCount = 0

  /**
   * push 一个新 scope(CALL 入口)
   * @returns 新 scope 的 ID(供 compiler 闭包捕获)
   * @throws RecursionDepthError-like 当 activeScopeCount >= MAX_ACTIVE_SCOPES
   */
  enterScope(): string {
    if (this.activeScopeCount >= MAX_ACTIVE_SCOPES) {
      throw new Error(
        `FrameScopeAllocator: max active scopes (${MAX_ACTIVE_SCOPES}) exceeded — ` +
        'concurrent nested experience frames too deep; check for retry-until-success loop without bound'
      )
    }
    const scopeId = `s${this.globalScopeCounter++}`
    this.scopeStack.push(scopeId)
    this.activeScopeCount++
    return scopeId
  }

  /**
   * pop 一个 scope(RET 出口 / bubbleError abortFrame)
   * @throws 当 scopeStack 为空时(调用方不对称,设计错误)
   *
   * 重要:不清理 internalStore 残留 (P4+ 可优化;P1–P3 只靠相同字符串 key 覆盖)
   */
  exitScope(): void {
    if (this.scopeStack.length === 0) {
      throw new Error('FrameScopeAllocator: exitScope called with empty scope stack (asymmetric hook)')
    }
    const popped = this.scopeStack.pop()!
    this.activeScopeCount--
    // pool cursor / judge cursor 不主动 reset —— 同 scopeId 不会重入(retry 场景下是
    // 新的 frame 走 enterScope 拿到新 scopeId,不会重用旧的)
    // 但若某种场景下同 scopeId 重入,会出现 cursor 不从 0 开始的非确定性,
    // 目前依靠 globalScopeCounter 单调递增作为防御
    void popped // 仅用于 debugger
  }

  /** 当前 scope ID(栈顶),供 compiler 闭包捕获 */
  currentScope(): string {
    if (this.scopeStack.length === 0) {
      throw new Error('FrameScopeAllocator: currentScope() called with no active scope')
    }
    return this.scopeStack[this.scopeStack.length - 1]
  }

  /** 当前 active scope 数量(0 表示未初始化或已全部 exit) */
  getActiveScopeCount(): number {
    return this.activeScopeCount
  }

  /**
   * 为给定 scopeId 生成 argtmp sidecar slot name(round-robin)
   * @returns literal sidecar slot name(由 caller 使用 makeMove 写入)
   */
  allocateArgtmpSlot(scopeId: string): string {
    const cursor = this.argtmpCursors.get(scopeId) ?? 0
    const name = `$S${scopeId}.argtmp${cursor % LITERAL_POOL_SIZE}`
    this.argtmpCursors.set(scopeId, cursor + 1)
    return name
  }

  /**
   * 为给定 scopeId 生成 cond scratch slot name(条件表达式 AST literal 暂存)
   */
  allocateCondScratch(scopeId: string): string {
    const cursor = this.condCursors.get(scopeId) ?? 0
    const name = `$S${scopeId}.cond${cursor % JUDGE_COND_POOL_SIZE}`
    this.condCursors.set(scopeId, cursor + 1)
    return name
  }

  /**
   * 为给定 scopeId 生成 judge scratch slot name(条件求值结果)
   */
  allocateJudgeScratch(scopeId: string): string {
    const cursor = this.judgeCursors.get(scopeId) ?? 0
    const name = `$S${scopeId}.judge${cursor % JUDGE_COND_POOL_SIZE}`
    this.judgeCursors.set(scopeId, cursor + 1)
    return name
  }

  /**
   * 重置整个 allocator(每个外部意图处理循环初始化一次,createInitialState 调用)
   */
  reset(): void {
    this.scopeStack = []
    this.argtmpCursors.clear()
    this.condCursors.clear()
    this.judgeCursors.clear()
    this.globalScopeCounter = 0
    this.activeScopeCount = 0
  }
}

/**
 * L1 调度器运行时状态
 */
export interface ExecutionState {
  /**
   * 当前指令栈（LIFO）
   */
  stack: StackEntry[]

  /**
   * 公共数据区（业务数据，持久）
   *
   * 业务命名（如 'output_content', 'user_config'）
   * 长期持久，跨 primitive 调用保留
   */
  publicStore: Map<string, Value>

  /**
   * 内部寄存器区（形参，瞬态）
   *
   * 寄存器命名（如 '$r0', '$r1', '$r_err'）
   * 瞬态，被同一寄存器名覆盖即可
   */
  internalStore: Map<string, Value>

  /**
   * 寄存器分配器 (legacy)
   *
   * L1 创建，每个外部意图处理循环初始化一次
   * L3 通过 state.allocator.allocate() 分配新寄存器
   *
   * @deprecated CRR P1 起由 frameScopeAllocator 替代；P4 末删除
   */
  allocator: RegisterAllocator

  /**
   * Frame Scope 分配器 (CRR P1 新增)
   *
   * 当 CompileOptions.useFixedSlotConvention=true 时由 compiler 使用;
   * useFixedSlotConvention=false 时仍走 state.allocator (legacy 兼容)
   */
  frameScopeAllocator?: FrameScopeAllocator

  /**
   * 递归深度计数（A11）
   *
   * key = intent.type（循环通过递归 intent 引用实现）
   * value = 当前调用链上该意图的帧数
   *
   * 由主循环管理：帧 activate（pending → compile）时 enterIntent，
   * 帧回收（done / aborted）时 exitIntent（见 src/l1/recursion.ts）
   */
  recursionDepth: Map<string, number>

  /** L2 operation 注册表（execute_op 使用）*/
  l2: L2Registry

  /** L3 意图分解服务（execute_intent 使用）*/
  l3: L3Service
}

/**
 * 创建初始 ExecutionState
 *
 * @param l2 L2 operation 注册表
 * @param l3 L3 意图分解服务
 * @returns 新的 ExecutionState（空 stack、双区空、新的 allocator）
 *
 * 注意：每个外部意图处理循环都应调用 createInitialState
 */
export function createInitialState(
  l2: L2Registry,
  l3: L3Service
): ExecutionState {
  return {
    stack: [],
    publicStore: new Map(),
    internalStore: new Map(),
    allocator: new RegisterAllocator(),
    frameScopeAllocator: new FrameScopeAllocator(),
    recursionDepth: new Map(),
    l2,
    l3
  }
}

/**
 * 类型守卫：检查 state 是否已初始化
 */
export function isInitialized(state: ExecutionState): boolean {
  return (
    state.stack !== undefined &&
    state.publicStore !== undefined &&
    state.internalStore !== undefined &&
    state.allocator !== undefined
  )
}

/**
 * 重置 state 但保留 l2/l3/allocator（用于测试）
 */
export function resetState(state: ExecutionState): void {
  state.stack = []
  state.publicStore.clear()
  state.internalStore.clear()
  state.allocator.reset()
  state.frameScopeAllocator?.reset()
  state.recursionDepth.clear()
}

// re-export 全局常量供测试 / main-loop 调用
export { GLOBAL_ERR }