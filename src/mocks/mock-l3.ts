/**
 * Mock L3 Service（Experience 模型版）
 *
 * @see ../../docs/mvp/11-prototype-implementation-plan.md §Phase A
 * @see ../../docs/mvp/12-experience-model.md
 *
 * 2026-08-20 重写：适配 Experience 模型接口
 *
 * 为 L1 单元测试提供可预设的 L3 service mock。
 *
 * 设计原则：
 * - mock L3 compile 返回预设的 children 列表
 * - 不调用真实 L3 编译逻辑（那是 Phase C 的事）
 * - 实现生产代码的 L3Service 接口（含 getExperience/recordFeedback/listExperiences）
 */

import type { RecognizedIntent, StackEntry } from '../l1/types.js'
import type { L3Service, ErrorInfo } from '../l3/service.js'
import type { Experience, FeedbackRecord } from '../l3/experience.js'

/**
 * 创建一个返回预设 children 的 mock L3 service
 *
 * @param children 要返回的 children 数组
 * @returns L3Service 实例
 *
 * 默认情况下：
 * - getExperience: 始终返回 null
 * - listExperiences: 返回空数组
 * - recordFeedback: no-op
 */
export function createMockL3(children: StackEntry[]): L3Service {
  return {
    compile: async (_intent: RecognizedIntent) => {
      // 直接返回预设值
      return children
    },
    getExperience: (_id: string) => null,
    recordFeedback: async (_id: string, _feedback: FeedbackRecord) => {
      // no-op
    },
    listExperiences: () => [],
    recompile: async (
      _intent: RecognizedIntent,
      _state: unknown,
      _errorInfo: ErrorInfo
    ) => {
      // 默认与 compile 行为一致
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
  recordFeedbackCalls: () => Array<{ id: string; feedback: FeedbackRecord }>
  recompileCalls: () => Array<{ intent: RecognizedIntent; errorInfo: ErrorInfo }>
}

export function createSpyL3(children: StackEntry[]): SpyL3 {
  let calls = 0
  let last: RecognizedIntent | undefined = undefined
  const feedbackCalls: Array<{ id: string; feedback: FeedbackRecord }> = []
  const recompileTracker: Array<{ intent: RecognizedIntent; errorInfo: ErrorInfo }> = []

  return {
    callCount: () => calls,
    lastIntent: () => last,
    recordFeedbackCalls: () => [...feedbackCalls],
    recompileCalls: () => [...recompileTracker],
    compile: async (intent: RecognizedIntent) => {
      calls++
      last = intent
      return children
    },
    getExperience: (_id: string) => null,
    recordFeedback: async (id: string, feedback: FeedbackRecord) => {
      feedbackCalls.push({ id, feedback })
    },
    listExperiences: () => [],
    recompile: async (
      intent: RecognizedIntent,
      _state: unknown,
      errorInfo: ErrorInfo
    ) => {
      recompileTracker.push({ intent, errorInfo })
      return children
    }
  }
}

/**
 * 创建一个可编程的 mock L3（按 intent.type 返回不同 children）
 *
 * 用于 A8 测试中按不同 type 路由到不同 children。
 */
export interface ProgrammableL3 extends L3Service {
  /** 注册 experience */
  registerExperience(exp: Experience): void
  /** 按 intent.type 设置要返回的 children */
  setChildren(type: string, children: StackEntry[]): void
}

export function createProgrammableL3(): ProgrammableL3 {
  const experiences = new Map<string, Experience>()
  const childrenMap = new Map<string, StackEntry[]>()

  return {
    registerExperience(exp: Experience) {
      experiences.set(exp.id, exp)
    },
    setChildren(type: string, children: StackEntry[]) {
      childrenMap.set(type, children)
    },
    compile: async (intent: RecognizedIntent) => {
      const children = childrenMap.get(intent.type) ?? []
      // 模拟真实 L3：每次 compile 返回**新的** entries（新 ID）
      // 不能返回同一引用——递归/多次调用会共享 entry 对象，phase 互相污染
      return structuredClone(children)
    },
    getExperience: (id: string) => experiences.get(id) ?? null,
    recordFeedback: async (id: string, feedback: FeedbackRecord) => {
      // 模拟存储
      void id
      void feedback
    },
    listExperiences: () => Array.from(experiences.values()),
    recompile: async (
      intent: RecognizedIntent,
      _state: unknown,
      _errorInfo: ErrorInfo
    ) => {
      const children = childrenMap.get(intent.type) ?? []
      return structuredClone(children)
    }
  }
}