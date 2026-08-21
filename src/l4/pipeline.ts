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
import type { L2RegistryLike } from '../l3/compiler.js'
import { ExperienceService } from '../l3/experience-service.js'
import { MockL4 } from './mock-llm.js'

/** 各经验的主输出寄存器（pipeline 展示用；L4/pipeline 理解业务细节是合理的）*/
const PRIMARY_OUTPUT: Record<string, string> = {
  read_file: '$r_content',
  read_file_with_default: '$r_content',
  check_file_exists: '$r_exists',
  write_file: '$r_bytes',
  safe_write: '$r_bytes',
  find_files: '$r_matches',
  search_in_files: '$r_matches',
  run_shell: '$r_stdout',
  replace_in_file: '$r_count'
}

/** 单次对话的执行结果 */
export interface SayResult {
  /** 是否正常完成（异常被截获也算 ok=true，看 error 字段判断业务成败）*/
  ok: boolean

  /** L4 识别出的 intent */
  intent: RecognizedIntent

  /** 主输出寄存器值（经验语义上的"返回值"）*/
  primary: Value

  /** 全部业务寄存器（过滤编译器临时寄存器）*/
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
   * @throws UnrecognizedInputError 无法识别的话语
   * @throws UnhandledError 无 handler 且根层不截获的系统级异常
   */
  async say(utterance: string): Promise<SayResult> {
    // ---- L4：自然语言 → intent ----
    const intent = this.l4.recognize(utterance)
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

  private collect(
    intent: RecognizedIntent,
    state: ExecutionState,
    utterance: string,
    elapsedMs: number
  ): SayResult {
    const registers: Record<string, Value> = {}
    for (const [k, v] of state.internalStore) {
      // 过滤编译器内部临时寄存器
      if (k.startsWith('$r_argtmp_') || k.startsWith('$r_cond_') || k.startsWith('$r_judge_')) continue
      registers[k] = v
    }
    const primaryReg = PRIMARY_OUTPUT[intent.type]
    return {
      ok: true,
      intent,
      primary: primaryReg ? (registers[primaryReg] ?? null) : null,
      registers,
      error: (registers[ERROR_REGISTER] as OperationError | null) ?? null,
      elapsedMs,
      utterance
    }
  }
}
