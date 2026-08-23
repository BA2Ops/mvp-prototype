/**
 * Agent Pipeline — 自然语言端到端入口（Phase E1）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md
 * @see ./mock-llm.ts（L4 识别）
 *
 * 完整链路：
 *   用户话语 → MockL4.recognize → RecognizedIntent
 *            → ExperienceService.compile（L3）
 *            → l1MainLoop（L1）
 *            → L2 真实 op → 真实世界
 *            → SayResult（寄存器 + 主输出 + 错误）
 *
 * 这是「LLM 不能直接调 L2」边界的演示闭环：
 * 上层只能说话（text），永远接触不到指令栈和 op。
 */

import { join, isAbsolute } from 'path'
import { l1MainLoop } from '../l1/main-loop.js'
import { createInitialState } from '../l1/execution-state.js'
import type { ExecutionState } from '../l1/execution-state.js'
import type { RecognizedIntent, Value } from '../l1/types.js'
import type { OperationError } from '../l2/errors.js'
import { ERROR_REGISTER } from '../l2/errors.js'
import { GLOBAL_ERR, LEGACY_ERROR_REGISTER } from '../l3/crr-config.js'
import type { L2RegistryLike } from '../l3/compiler.js'
import { ExperienceService } from '../l3/experience-service.js'
import { resolveResponse } from '../l3/response.js'
import { MockL4, UnrecognizedInputError } from './mock-llm.js'

/**
 * CRR P2/T-2.4: pipeline.collect 去 PRIMARY_OUTPUT 硬编码
 *
 * 之前: 人工维护 expId → register 名 的 Record<string,string> 表
 * 问题: 经验新加主输出 → 忘了同步修改 PRIMARY_OUTPUT (同步债,9 条经验 不一致)
 *
 * 现在: 走 publicStore (CRR P2 outputs_bindings 显式声明 → post-bindings move → publicStore)
 * - exp.outputs_bindings[firstPersistKey] = exp 的 "主输出" (首个 persist:true binding)
 * - pipeline.collect 直接读 publicStore.get(`${expId}.${key}`)
 * - 经验未声明 bindings → primary = null (不读 internalStore)
 * - 经验多个 bindings → primary = 首个 persist:true binding (与 errors 语义一致)
 *
 * 透退 fallback (P4 删除):
 * - 若 publicStore 无该 entry, 回退读 internalStore[$r_<X>] (legacy)
 * - 仅用于 P2→P4 过渡期, P4 T-4.3 完整删除
 */

/** 单次对话的执行结果 */
export interface SayResult {
  /** 是否正常完成（异常被截获也算 ok=true，看 error 字段判断业务成败）*/
  ok: boolean

  /**
   * 人类可读结果消息（D-E2-1）
   *
   * 由 L3 经验定义的 response/failure 模板插值生成——
   * 信息内容确定在 L3，L4 只做渲染。
   * 识别失败时为引导性回复（含能力清单）。
   */
  message: string

  /** L4 识别出的 intent（识别失败时 undefined）*/
  intent?: RecognizedIntent

  /** 主输出寄存器值（经验语义上的"返回值"；识别失败时 null）*/
  primary: Value

  /** 全部业务寄存器（过滤编译器临时寄存器；识别失败时空表）*/
  registers: Record<string, Value>

  /** 业务错误（$r_err；null = 无错误）*/
  error: OperationError | Value | null

  /** 执行耗时 ms */
  elapsedMs: number

  /** 原始话语 */
  utterance: string
}

export interface PipelineOptions {
  /**
   * 相对路径解析基准目录。
   *
   * L4 场景中用户说「读取 note.txt」时通常指当前工作区——
   * pipeline 把 params 中 path/cwd 的相对路径拼接到 baseDir。
   */
  baseDir?: string
}

export class AgentPipeline {
  private readonly l4: MockL4
  private readonly service: ExperienceService
  private readonly registry: L2RegistryLike & object
  private readonly baseDir?: string

  constructor(
    service: ExperienceService,
    registry: L2RegistryLike & object,
    options?: PipelineOptions
  ) {
    this.l4 = new MockL4()
    this.service = service
    this.registry = registry
    this.baseDir = options?.baseDir
  }

  /**
   * 说一句话，执行完整链路，返回观察结果。
   *
   * D-E2-1：不再抛 UnrecognizedInputError——识别失败转为引导性回复
   * （ok=false + 能力清单），符合人类对话预期。
   *
   * @throws UnhandledError 无 handler 且根层不截获的系统级异常
   */
  async say(utterance: string): Promise<SayResult> {
    // ---- L4：自然语言 → intent ----
    let intent: RecognizedIntent
    try {
      intent = this.l4.recognize(utterance)
    } catch (e) {
      if (e instanceof UnrecognizedInputError) {
        return this.unrecognized(utterance)
      }
      throw e
    }
    this.resolveRelativePaths(intent)

    // ---- L3/L1/L2：执行 ----
    const state = createInitialState(this.registry as never, this.service)
    const t0 = Date.now()
    await l1MainLoop(intent, state, {
      rootHandleError: this.service.shouldHandleError(intent.type)
    })
    const elapsedMs = Date.now() - t0

    return this.collect(intent, state, utterance, elapsedMs)
  }

  /** 相对路径拼接 baseDir（模拟真实 LLM 拿到的工作区上下文）*/
  private resolveRelativePaths(intent: RecognizedIntent): void {
    if (!this.baseDir) return
    for (const key of ['path', 'cwd']) {
      const v = intent.params[key]
      if (typeof v === 'string' && v.length > 0 && !isAbsolute(v)) {
        intent.params[key] = join(this.baseDir, v)
      }
    }
    // 用户没说目录时，cwd 默认指工作区（而非进程 cwd）
    if (!('cwd' in intent.params)) {
      intent.params.cwd = this.baseDir
    }
  }

  /** 识别失败 → 引导性回复（能力清单来自 L3 经验库的业务描述）*/
  private unrecognized(utterance: string): SayResult {
    const capabilities = this.service
      .listExperiences()
      .map(e => `  - ${e.id}：${e.description}`)
      .join('\n')
    return {
      ok: false,
      message: `我没有理解这句话。目前我能处理这些操作：\n${capabilities}\n请换个说法试试。`,
      intent: undefined,
      primary: null,
      registers: {},
      error: null,
      elapsedMs: 0,
      utterance
    }
  }

  private collect(
    intent: RecognizedIntent,
    state: ExecutionState,
    utterance: string,
    elapsedMs: number
  ): SayResult {
    const registers: Record<string, Value> = {}
    for (const [k, v] of state.internalStore) {
      // 过滤编译器内部临时寄存器（$r_path 保留——resolveResponse 需要）
      if (k.startsWith('$r_argtmp_') || k.startsWith('$r_cond_') || k.startsWith('$r_judge_')) continue
      registers[k] = v
    }
    const exp = this.service.getExperience(intent.type)
    const message = exp
      ? resolveResponse(exp, registers)
      : `已完成 ${intent.type}`
    const primary = this.extractPrimary(intent.type, exp, state)
    return {
      ok: true,
      message,
      intent,
      primary,
      registers,
      error: ((registers[GLOBAL_ERR] ?? registers[LEGACY_ERROR_REGISTER ?? ERROR_REGISTER] ?? null) as unknown) as OperationError | null,
      elapsedMs,
      utterance
    }
  }

  /**
   * CRR P2/T-2.4: 从 publicStore 提取主输出
   *
   * 策略:
   *  1. 读 exp.outputs_bindings, 找首个 persist:true binding
   *  2. 从 publicStore.get(`${expId}.${key}`) 读值
   *  3. 若 publicStore 没值 (未声明 / abort path), 回退读 internalStore[binding.register]
   *  4. exp 未声明 bindings → primary = null
   */
  private extractPrimary(
    expId: string,
    exp: ReturnType<ExperienceService['getExperience']>,
    state: ExecutionState
  ): Value {
    if (!exp?.outputs_bindings) return null
    // 取首个 persist:true binding (作为语义主输出)
    const primaryEntry = Object.entries(exp.outputs_bindings).find(([, b]) => b.persist === true)
    if (!primaryEntry) return null
    const [key, binding] = primaryEntry
    // 优先 publicStore (T-2.2 post-bindings 写入)
    const pubKey = `${expId}.${key}`
    if (state.publicStore.has(pubKey)) {
      return state.publicStore.get(pubKey)!
    }
    // fallback: internalStore[binding.register] (P2→P4 过渡期兼容)
    return state.internalStore.has(binding.register)
      ? state.internalStore.get(binding.register)!
      : null
  }
}
