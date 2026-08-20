/**
 * execute_op primitive 执行函数（双区架构版）
 *
 * @see ../../docs/mvp/06-execution-layer.md §3.2
 * @see ../../docs/mvp/10-reactive-execution-model.md §三.3
 * @see ../../docs/mvp/11-prototype-implementation-plan.md Phase A
 *
 * 完整设计：
 * - 从 internalStore 读取所有 inputs（每个 input 必须是 internal kind）
 * - 通过 state.l2.get(operation) 查找 op
 * - 调用 op.execute(inputs)
 * - 把 outputs 写入 internalStore（每个 output 必须是 internal kind）
 * - 已知错误（OperationError 对象）作为 outputs.error 正常写入（不抛错）
 * - 硬错误（throw）抛给 L1 主循环处理（propagateHardError）
 *
 * 双区架构约束：
 * - inputs 中所有 Address.kind === 'internal'（否则抛错）
 * - outputs 中所有 Address.kind === 'internal'（否则抛错）
 * - execute_op 不直接读写 publicStore / file / literal
 *
 * 错误处理路径：
 * 1. 成功：op 返回 outputs → 写入 internalStore → entry.status = 'done' → pop
 * 2. 已知错误：op 返回 { ..., error: OperationError } → 写入 outputs（包括 error）
 *    → DAG 通过 conditional_skip 检查 $r_err 处理
 * 3. 硬错误：op throw → 抛给 L1 主循环 → propagateHardError 向上传播
 */

import type { OpEntry } from '../types.js'
import type { ExecutionState } from '../execution-state.js'
import { isInternalAddress } from '../types.js'
import { writeAddress } from '../address-resolver.js'

/**
 * execute_op 参数错误
 */
export class ExecuteOpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecuteOpError'
  }
}

/**
 * 解析 inputs：从 internalStore 读取
 *
 * @param inputs Record<业务名, internal Address>
 * @param state ExecutionState
 * @returns Record<业务名, Value>
 */
async function resolveInputs(
  inputs: OpEntry['inputs'],
  state: ExecutionState
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {}
  for (const [name, addr] of Object.entries(inputs)) {
    if (!isInternalAddress(addr)) {
      throw new ExecuteOpError(
        `execute_op input '${name}' must be internal (got '${addr.kind}'). ` +
        `Use move to copy from literal/public/file first.`
      )
    }
    resolved[name] = state.internalStore.get(addr.name)
  }
  return resolved
}

/**
 * 验证 outputs 中所有 Address 都是 internal
 *
 * @param outputs Record<业务名, Address>
 * @throws ExecuteOpError 任意 output 不是 internal
 */
function validateOutputs(outputs: OpEntry['outputs']): void {
  for (const [name, addr] of Object.entries(outputs)) {
    if (!isInternalAddress(addr)) {
      throw new ExecuteOpError(
        `execute_op output '${name}' must be internal (got '${addr.kind}')`
      )
    }
  }
}

/**
 * 执行 execute_op primitive
 *
 * @param entry execute_op 条目
 * @param state 当前执行状态
 *
 * 行为：
 * 1. 校验 op 已注册
 * 2. 校验 inputs 都是 internal
 * 3. 校验 outputs 都是 internal
 * 4. 解析 inputs（从 internalStore 读取）
 * 5. 调用 op.execute(resolvedInputs)
 *    - 已知错误 → 返回 { ..., error: OperationError }
 *    - 硬错误 → throw（向上传播，不在这里 catch）
 * 6. 写入 outputs 到 internalStore
 * 7. entry.status = 'done'，pop
 *
 * 错误处理：
 * - op 未注册 → ExecuteOpError
 * - input/output 不是 internal → ExecuteOpError
 * - op 抛错（硬错误）→ 向上抛（由 L1 main loop 的 catch 处理 → propagateHardError）
 * - 已知错误（返回 { error: OperationError }）→ 不抛错，正常写入
 */
export async function executeOp(
  entry: OpEntry,
  state: ExecutionState
): Promise<void> {
  // ============ Step 1: 查找 op ============
  const op = state.l2.get(entry.operation)
  if (!op) {
    throw new ExecuteOpError(
      `Operation '${entry.operation}' not registered in L2Registry`
    )
  }

  // ============ Step 2: 验证 inputs/outputs 都是 internal ============
  // inputs 校验在 resolveInputs 中做（避免重复遍历）
  validateOutputs(entry.outputs)

  // ============ Step 3: 标记 running ============
  entry.status = 'running'

  // ============ Step 4: 解析 inputs（从 internalStore） ============
  const resolvedInputs = await resolveInputs(entry.inputs, state)

  // ============ Step 5: 调用 op.execute ============
  // 硬错误会在这里 throw，让外层 catch 处理（propagateHardError）
  // 已知错误作为 outputs.error 返回（不抛错，正常处理）
  const outputs = await op.execute(resolvedInputs as Record<string, never>)

  // ============ Step 6: 写入 outputs 到 internalStore ============
  for (const [name, addr] of Object.entries(entry.outputs)) {
    const value = outputs[name]
    await writeAddress(addr, value, state)
  }

  // ============ Step 7: 完成 ============
  entry.status = 'done'
  state.stack.pop()
}