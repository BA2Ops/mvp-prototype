/**
 * L1 调度器运行时状态
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §二
 * @see ../../docs/mvp/09-l1-implementation.md §5
 *
 * A2 阶段定义最小版本：
 * - stack：当前指令栈
 * - resultStore：数据存储
 * - l2, l3：对下层的引用
 *
 * Phase 后续扩展：
 * - recursionDepth：递归深度跟踪（A11）
 * - logger：追踪日志
 * - env：环境上下文完整实现
 */

import type { StackEntry, Value } from './types.js'
import type { L2Registry } from '../l2/registry.js'
import type { L3Service } from '../l3/service.js'

/**
 * L1 调度器运行时状态
 *
 * 由 l1MainLoop 持有，所有 primitive 执行函数共享同一 state。
 *
 * 设计原则：
 * - 单一对象（避免传递多个参数）
 * - stack 是当前活跃的指令栈（LIFO）
 * - resultStore 是数据传递的载体（被所有 primitive 共享）
 */
export interface ExecutionState {
  /**
   * 当前指令栈
   *
   * LIFO 栈：
   * - 调度器循环 pop 栈顶，根据 kind 分发
   * - execute_intent 会 push children（反向 DFS）
   * - skip_n 会 pop 多个（self + n）
   */
  stack: StackEntry[]

  /**
   * 数据存储
   *
   * Map<key, Value> 形式：
   * - key：variable name（如 '$x'）
   * - value：执行结果或中间值
   *
   * A2 阶段简化：A3+ Address 解析后才有完整 key 规则
   */
  resultStore: Map<string, Value>

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
 * @returns 新的 ExecutionState（空 stack、空 resultStore）
 *
 * 每次调用返回独立实例，stack 和 resultStore 不共享。
 */
export function createInitialState(
  l2: L2Registry,
  l3: L3Service
): ExecutionState {
  return {
    stack: [],
    resultStore: new Map(),
    l2,
    l3
  }
}

/**
 * 类型守卫：检查 state 是否已初始化
 *
 * 主要用于测试和调试，确保不会意外使用空 state。
 */
export function isInitialized(state: ExecutionState): boolean {
  return state.stack !== undefined && state.resultStore !== undefined
}