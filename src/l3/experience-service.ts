/**
 * ExperienceService — L3Service 的生产实现（Phase C）
 *
 * @see ../../docs/mvp/12-experience-model.md
 * @see ../../docs/mvp/10-reactive-execution-model.md §四
 *
 * 职责：
 * - 持有经验库（Map<id, Experience>）+ L2 registry 引用
 * - compile → 委托 compileExperience（静态展开）
 * - recordFeedback → 追加到 experience.feedback_history（MVP 仅存储，不自动演化）
 * - recompile → MVP 与 compile 相同（错误信息仅记录；重试策略留给上层）
 *
 * 设计原则：
 * - L3 是被调 service，不是编译阶段
 * - 每次 compile 返回新 entries（带新 ID）
 * - 不持有执行状态（state 由调用方提供）
 */

import type { RecognizedIntent, StackEntry } from '../l1/types.js'
import type { ExecutionState } from '../l1/execution-state.js'
import type { L2RegistryLike } from './compiler.js'
import { compileExperience } from './compiler.js'
import type { Experience, FeedbackRecord, CompileOptions } from './experience.js'
import type { L3Service, ErrorInfo } from './service.js'

export class ExperienceService implements L3Service {
  private readonly experiences: Map<string, Experience>
  private readonly registry: L2RegistryLike
  private readonly defaultOptions: CompileOptions
  private lastErrorInfo: ErrorInfo | null = null

  constructor(experiences: Experience[], registry: L2RegistryLike, defaultOptions?: CompileOptions) {
    this.experiences = new Map(experiences.map(e => [e.id, e]))
    this.registry = registry
    this.defaultOptions = defaultOptions ?? {}
  }

  compile(
    intent: RecognizedIntent,
    state: ExecutionState,
    options?: CompileOptions
  ): Promise<StackEntry[]> {
    // P4/T-4.3: 合并 defaultOptions (含 skip_cost) 与调用方 options (含 useFixedSlotConvention)
    // 之前 `options ?? this.defaultOptions` 会导致调用方 options 覆盖 defaultOptions，
    // 丢失 skip_cost 等服务级配置。
    const merged: CompileOptions = { ...this.defaultOptions, ...options }
    return Promise.resolve(
      compileExperience(
        intent, state, this.experiences, this.registry,
        merged
      )
    )
  }

  getExperience(id: string): Experience | null {
    return this.experiences.get(id) ?? null
  }

  async recordFeedback(id: string, feedback: FeedbackRecord): Promise<void> {
    const exp = this.experiences.get(id)
    if (!exp) {
      throw new Error(`L3 recordFeedback: unknown experience '${id}'`)
    }
    exp.feedback_history = [...(exp.feedback_history ?? []), feedback]
  }

  listExperiences(): Experience[] {
    return Array.from(this.experiences.values())
  }

  /**
   * 失败后重新编译。
   *
   * MVP：记录 errorInfo 后与 compile 相同（经验库是静态的，重编译产物一致；
   * 真正的「换个方式重试」策略留给上层 LLM 决定——比如换参数再调 compile）。
   */
  async recompile(
    intent: RecognizedIntent,
    state: ExecutionState,
    errorInfo: ErrorInfo
  ): Promise<StackEntry[]> {
    this.lastErrorInfo = errorInfo
    return this.compile(intent, state)
  }

  /** 最近一次 recompile 收到的错误信息（调试/观测用）*/
  getLastErrorInfo(): ErrorInfo | null {
    return this.lastErrorInfo
  }

  /**
   * 根意图帧的 handleError 标志（D-C4-5）
   *
   * 根帧由调用方创建（createRootIntentEntry(intent, handleError)），
   * 此方法从经验定义读取标志，保证「错误处置权在 L3」的一致性。
   */
  shouldHandleError(intentType: string): boolean {
    return this.experiences.get(intentType)?.handleError ?? false
  }
}
