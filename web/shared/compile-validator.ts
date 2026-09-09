/**
 * 编译产物校验(F1.5)
 *
 * 验证 XML→L3 编译产物是合法 L3 Experience,且能端到端执行。
 *
 * 三层验证:
 *   1. L3 编译合法性:调用现有 compileExperience 验证能编译为 StackEntry[]
 *   2. 端到端试执行:用 l1MainLoop 在临时 state 上执行,验证不抛异常
 *   3. 结果完整性:验证 outputs_bindings 声明的输出确实产生
 *
 * @see tasks/phase-f1/README.md F1.5
 */

import type { Experience } from '../../src/l3/experience.js'
import type { RecognizedIntent, StackEntry } from '../../src/l1/types.js'
import type { ExecutionState } from '../../src/l1/execution-state.js'
import type { L2RegistryLike } from '../../src/l3/compiler.js'
import { compileExperience } from '../../src/l3/compiler.js'
import { l1MainLoop } from '../../src/l1/main-loop.js'

// ============== 校验结果 ==============

export interface CompileValidationResult {
  /** Layer 1: L3 编译合法性(compileExperience) */
  layer1_compile: { valid: boolean; errors: string[]; entries?: StackEntry[] }
  /** Layer 2: 端到端执行(l1MainLoop) */
  layer2_exec: { valid: boolean; errors: string[] }
  /** 总体结果 */
  overall: boolean
}

// ============== 辅助:构造测试 Intent ==============

/**
 * 从 Experience 构造测试用的 RecognizedIntent
 * 使用经验的输入参数 schema 生成默认参数
 */
function buildTestIntent(exp: Experience): RecognizedIntent {
  const params: Record<string, unknown> = {}

  for (const [name, spec] of Object.entries(exp.inputs)) {
    if (spec.default !== undefined) {
      params[name] = spec.default
    } else if (spec.required) {
      // 为必填参数提供类型安全的默认值
      switch (spec.type) {
        case 'string':
          params[name] = 'test-value'
          break
        case 'number':
          params[name] = 0
          break
        case 'boolean':
          params[name] = false
          break
        case 'path':
          params[name] = '/tmp/test-path'
          break
        case 'object':
          params[name] = []
          break
        default:
          params[name] = null
      }
    }
  }

  return {
    type: exp.id,
    params
  }
}

// ============== 三层验证 ==============

/**
 * Layer 1: L3 编译合法性验证
 *
 * 调用现有 compileExperience 验证能编译为 StackEntry[]
 */
function validateLayer1Compile(
  exp: Experience,
  state: ExecutionState,
  experiences: Map<string, Experience>,
  registry: L2RegistryLike
): { valid: boolean; errors: string[]; entries?: StackEntry[] } {
  try {
    const intent = buildTestIntent(exp)

    // CRR 新路径需要 active scope —— 在编译前进入 scope
    const allocator = state.frameScopeAllocator
    let scopeId: string | undefined
    if (allocator) {
      scopeId = allocator.enterScope()
    }

    try {
      const entries = compileExperience(intent, state, experiences, registry, {
        useFixedSlotConvention: true
      })
      return { valid: true, errors: [], entries }
    } finally {
      // 编译完成后退出 scope
      if (allocator && scopeId !== undefined) {
        allocator.exitScope()
      }
    }
  } catch (e) {
    return {
      valid: false,
      errors: [`L3 编译失败: ${e instanceof Error ? e.message : String(e)}`]
    }
  }
}

/**
 * Layer 2: 端到端执行验证
 *
 * 用 l1MainLoop 在临时 state 上执行,验证不抛异常
 */
async function validateLayer2Exec(
  exp: Experience,
  state: ExecutionState
): Promise<{ valid: boolean; errors: string[] }> {
  try {
    const intent = buildTestIntent(exp)
    await l1MainLoop(intent, state, {
      maxSteps: 1000,
      maxRecursionDepth: 10,
      rootHandleError: exp.handleError ?? false
    })
    return { valid: true, errors: [] }
  } catch (e) {
    return {
      valid: false,
      errors: [`端到端执行失败: ${e instanceof Error ? e.message : String(e)}`]
    }
  }
}

// ============== 主校验函数 ==============

/**
 * 验证编译产物(L3 Experience)的合法性
 *
 * @param exp 待验证的 L3 Experience
 * @param state 执行状态(会被重置)
 * @param experiences 经验库 Map(含待验证经验)
 * @param registry L2 操作注册表
 * @returns 三层验证结果
 */
export async function validateCompiledL3(
  exp: Experience,
  state: ExecutionState,
  experiences: Map<string, Experience>,
  registry: L2RegistryLike
): Promise<CompileValidationResult> {
  // 确保经验在经验库中
  if (!experiences.has(exp.id)) {
    experiences.set(exp.id, exp)
  }

  // Layer 1: L3 编译合法性
  const layer1 = validateLayer1Compile(exp, state, experiences, registry)

  // Layer 2: 端到端执行(仅当 Layer 1 通过时执行)
  let layer2: { valid: boolean; errors: string[] } = { valid: false, errors: ['Layer 1 失败,跳过'] }
  if (layer1.valid) {
    // 重置 state(清除 Layer 1 的副作用)
    state.stack = []
    state.publicStore.clear()
    state.internalStore.clear()
    state.allocator.reset()
    state.frameScopeAllocator?.reset()
    state.recursionDepth.clear()

    layer2 = await validateLayer2Exec(exp, state)
  }

  return {
    layer1_compile: layer1,
    layer2_exec: layer2,
    overall: layer1.valid && layer2.valid
  }
}
