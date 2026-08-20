/**
 * Mock L3 Service
 *
 * @see ../../docs/mvp/11-prototype-implementation-plan.md §Phase A
 *
 * 为 L1 单元测试提供可预设的 L3 service mock。
 *
 * 设计原则：
 * - L3 compile 返回预设的 children 列表
 * - 不调用真实 L3 编译逻辑（那是 Phase C 的事）
 * - 实现生产代码的 L3Service 接口
 */

import type { RecognizedIntent, StackEntry } from '../l1/types.js'
import type { L3Service } from '../l3/service.js'

/**
 * 创建一个返回预设 children 的 mock L3 service
 *
 * @param children 要返回的 children 数组
 * @returns L3Service 实例
 */
export function createMockL3(children: StackEntry[]): L3Service {
  return {
    compile: async (_intent: RecognizedIntent) => {
      // 直接返回预设值
      return children
    }
  }
}

/**
 * 创建一个 spy L3 service（记录调用）
 *
 * 用于测试 L1 是否正确调 L3.compile，以及传了什么参数。
 */
export interface SpyL3 extends L3Service {
  callCount: () => number
  lastIntent: () => RecognizedIntent | undefined
}

export function createSpyL3(children: StackEntry[]): SpyL3 {
  let calls = 0
  let last: RecognizedIntent | undefined = undefined

  return {
    callCount: () => calls,
    lastIntent: () => last,
    compile: async (intent: RecognizedIntent) => {
      calls++
      last = intent
      return children
    }
  }
}