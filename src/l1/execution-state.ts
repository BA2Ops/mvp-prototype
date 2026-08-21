/**
 * L1 调度器运行时状态（双区架构版）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §二
 * @see ../../docs/mvp/09-l1-implementation.md §5
 *
 * 完整设计：
 * - 双区存储：publicStore（业务）+ internalStore（寄存器）
 * - RegisterAllocator：每个外部意图处理循环初始化一次
 * - $r_err 保留为错误寄存器（不参与普通分配）
 */

import type { StackEntry, Value } from './types.js'
import type { L2Registry } from '../l2/registry.js'
import type { L3Service } from '../l3/service.js'
import { ERROR_REGISTER } from '../l2/errors.js'

// ============== Register Allocator ==============
/**
 * L1 寄存器分配器
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
   * 寄存器分配器
   *
   * L1 创建，每个外部意图处理循环初始化一次
   * L3 通过 state.allocator.allocate() 分配新寄存器
   */
  allocator: RegisterAllocator

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
  state.recursionDepth.clear()
}