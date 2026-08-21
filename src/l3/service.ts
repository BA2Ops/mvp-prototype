/**
 * L3 Service 接口（生产代码，Experience 模型版）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §四
 * @see ../../docs/mvp/07-intent-library.md
 * @see ../../docs/mvp/12-experience-model.md
 *
 * 2026-08-20 重写：原 StandardIntent + DAG 节点 → Experience 三段式
 *
 * 当前状态：接口定义完整，实现待 Phase C 完成。
 */

import type { RecognizedIntent, StackEntry } from '../l1/types.js'
import type { ExecutionState } from '../l1/execution-state.js'
import type { Experience, FeedbackRecord, CompileOptions } from './experience.js'

/**
 * 错误信息（recompile 时使用）
 */
export interface ErrorInfo {
  failedExperienceId?: string
  failedOpName: string
  failedOpId: string
  errorCode?: string
  errorMessage: string
  errorStack?: string
  attemptedInputs: Record<string, unknown>
}

/**
 * L3 Service 接口
 *
 * 职责：
 * - compile(intent, state) → 返回该意图展开后的 StackEntry[]
 * - getExperience(id) → 获取经验定义
 * - recordFeedback(id, feedback) → 记录用户反馈（MVP 仅存储）
 * - listExperiences() → 列出所有经验
 * - recompile(intent, state, errorInfo) → 错误后重新编译
 *
 * 设计原则：
 * - L3 是被调 service，不是编译阶段
 * - 每次 compile 返回新 entries（带新 ID）
 * - 不持有执行状态（state 由调用方提供）
 */
export interface L3Service {
  /**
   * 编译意图为子 entries
   *
   * @param intent 已识别意图（type 已被 L4 LLM 标准化）
   * @param state ExecutionState（访问 allocator、internalStore）
   * @returns 生成的 StackEntry[]
   *
   * 编译流程：
   * 1. 根据 intent.type 获取 Experience 定义
   * 2. 绑定输入参数（intent.params → internal 寄存器）
   * 3. 编译前置处理（按 skip_cost 跳过）
   * 4. 编译条件判断（决定 target-op 路径）
   * 5. 编译 target-op 选定路径的 steps
   */
  compile(
    intent: RecognizedIntent,
    state: ExecutionState,
    options?: CompileOptions
  ): Promise<StackEntry[]>

  /**
   * 获取经验定义（by id）
   *
   * @returns Experience 或 null（找不到）
   */
  getExperience(id: string): Experience | null

  /**
   * 记录用户反馈（MVP 仅存储，不自动演化）
   *
   * @param id Experience ID
   * @param feedback 反馈记录
   */
  recordFeedback(id: string, feedback: FeedbackRecord): Promise<void>

  /**
   * 列出所有经验
   *
   * @returns Experience[]（所有内置经验）
   */
  listExperiences(): Experience[]

  /**
   * 失败后重新编译（可产生不同的 children）
   *
   * @param intent 已识别意图
   * @param state ExecutionState
   * @param errorInfo 错误信息
   * @returns 重新生成的 StackEntry[]
   */
  recompile(
    intent: RecognizedIntent,
    state: ExecutionState,
    errorInfo: ErrorInfo
  ): Promise<StackEntry[]>
}