/**
 * Demo 01 — L1 五原语与主循环（CPU 取指-执行模型）
 *
 * 演示能力：move / execute_op / conditional_skip / skip_n / execute_intent
 *          以及 l1MainLoop 的 5-case dispatch 与栈式执行
 *
 * 运行：npx tsx demos/demo-01-l1-primitives.ts
 *
 * 核心观察点：
 * - 寄存器写入（internalStore）
 * - 条件跳转的"真则跳过 n 条"语义
 * - execute_intent 帧保留（CALL）与 children 执行顺序
 */

import { setupDemo, step, observe, note, verify, teardownDemo, type DemoCtx } from './lib.js'
import { l1MainLoop } from '../src/l1/main-loop.js'
import { createInitialState } from '../src/l1/execution-state.js'
import { L2Registry } from '../src/l2/registry.js'
import { evaluateExprOp } from '../src/l2/builtins/evaluate-expr.js'
import { createMockL3 } from '../src/mocks/mock-l3.js'
import type { StackEntry } from '../src/l1/types.js'

const ctx = await setupDemo('Demo 01 — L1 五原语与主循环')

// ============== 准备 ==============

step('0', '环境准备：注册 L2 op + 预设 L3 mock')
const registry = new L2Registry()
registry.register(evaluateExprOp)
observe('已注册 op', registry.list())

/** 构造 move entry 的辅助 */
function mv(from: unknown, to: string): StackEntry {
  return {
    id: `mv_${to}`, parentIntentId: null, createdAt: 0, kind: 'move',
    from: { kind: 'literal', value: from as never },
    to: { kind: 'internal', name: to }
  }
}

// ============== 步骤 1: move ==============

step('1', 'move — 字面量装入寄存器（MOV 立即数装载）')
{
  const state = createInitialState(registry, createMockL3([]))
  const entries: StackEntry[] = [
    mv(42, '$r_a'),
    mv('hello', '$r_b')
  ]
  for (let i = entries.length - 1; i >= 0; i--) state.stack.push(entries[i])
  await l1MainLoop({ type: 'noop', params: {} }, state)
  observe('$r_a', state.internalStore.get('$r_a'))
  observe('$r_b', state.internalStore.get('$r_b'))
  verify(ctx, 'move 装载字面量到寄存器', () =>
    state.internalStore.get('$r_a') === 42 && state.internalStore.get('$r_b') === 'hello')
}

// ============== 步骤 2: execute_op ==============

step('2', 'execute_op — 调用 L2 evaluate_expr（1 + 2）')
{
  const state = createInitialState(registry, createMockL3([]))
  const entries: StackEntry[] = [
    mv({ type: 'op', name: '+', args: [{ type: 'literal', value: 1 }, { type: 'literal', value: 2 }] } as never, '$r_expr'),
    {
      id: 'op_add', parentIntentId: null, createdAt: 0, kind: 'execute_op',
      operation: 'evaluate_expr',
      inputs: { expr: { kind: 'internal', name: '$r_expr' } },
      outputs: { result: { kind: 'internal', name: '$r_sum' }, error: { kind: 'internal', name: '$r_err' } },
      status: 'pending'
    }
  ]
  for (let i = entries.length - 1; i >= 0; i--) state.stack.push(entries[i])
  await l1MainLoop({ type: 'noop', params: {} }, state)
  observe('$r_sum', state.internalStore.get('$r_sum'))
  observe('$r_err', state.internalStore.get('$r_err'))
  note('execute_op 只能读写 internal 寄存器（双区架构约束，L1 强制校验）')
  verify(ctx, 'execute_op 求值 1+2=3 且无错误', () =>
    state.internalStore.get('$r_sum') === 3 && state.internalStore.get('$r_err') === null)
}

// ============== 步骤 3: conditional_skip ==============

step('3', 'conditional_skip — 条件为真跳过后续 n 条（Jcc）')
{
  const state = createInitialState(registry, createMockL3([]))
  // 布局: [mv(flag=true), cskip(n=2), mv(A被跳过), mv(B被跳过), mv(C落地)]
  const entries: StackEntry[] = [
    mv(true, '$r_flag'),
    {
      id: 'cskip', parentIntentId: null, createdAt: 0, kind: 'conditional_skip',
      conditionAddr: { kind: 'internal', name: '$r_flag' },
      n: 2
    },
    mv('SHOULD-NOT-EXIST', '$r_skipped'),
    mv('ALSO-SKIPPED', '$r_skipped2'),
    mv('reached', '$r_after')   // cskip 弹 self+2 后正好落到这里
  ]
  for (let i = entries.length - 1; i >= 0; i--) state.stack.push(entries[i])
  await l1MainLoop({ type: 'noop', params: {} }, state)
  observe('$r_skipped（应不存在）', state.internalStore.has('$r_skipped') ? state.internalStore.get('$r_skipped') : '(未写入)')
  observe('$r_skipped2（应不存在）', state.internalStore.has('$r_skipped2') ? state.internalStore.get('$r_skipped2') : '(未写入)')
  observe('$r_after', state.internalStore.get('$r_after'))
  note('truthy → 弹 self+n；falsy → 仅弹自己。这是所有 if/else 编译的基石')
  verify(ctx, 'conditional_skip 为真时跳过 2 条后续指令', () =>
    !state.internalStore.has('$r_skipped') && state.internalStore.get('$r_after') === 'reached')
}

// ============== 步骤 4: skip_n ==============

step('4', 'skip_n — 无条件跳过（JMP）')
{
  const state = createInitialState(registry, createMockL3([]))
  const entries: StackEntry[] = [
    { id: 'jmp', parentIntentId: null, createdAt: 0, kind: 'skip_n', n: 1 },
    mv('SKIPPED', '$r_jmp_skipped'),
    mv('landed', '$r_landed')
  ]
  for (let i = entries.length - 1; i >= 0; i--) state.stack.push(entries[i])
  await l1MainLoop({ type: 'noop', params: {} }, state)
  observe('$r_landed', state.internalStore.get('$r_landed'))
  verify(ctx, 'skip_n 无条件跳过中间指令', () => state.internalStore.get('$r_landed') === 'landed')
}

// ============== 步骤 5: execute_intent（帧保留）==============

step('5', 'execute_intent — CALL 子程序（帧保留 + children 顺序执行）')
{
  // mock L3 返回子序列: [mv(child-1), op(child-2)]
  const childEntries: StackEntry[] = [
    mv('from-child', '$r_child_val'),
    mv('child-done', '$r_child_done')
  ]
  const state = createInitialState(registry, createMockL3(childEntries))
  // 根 intent 由 l1MainLoop 创建；mock L3 会把 children 返回给根帧
  await l1MainLoop(
    { type: 'demo_subroutine', params: {} },
    state
  )
  observe('$r_child_val', state.internalStore.get('$r_child_val'))
  observe('最终栈深度（应为 0，帧已收尾弹出）', state.stack.length)
  note('execute_intent 先调 L3.compile 展开 children，逆序压栈；全部执行完后帧标记 done 并弹出')
  verify(ctx, 'execute_intent 展开的 children 全部执行且帧正常收尾', () =>
    state.internalStore.get('$r_child_val') === 'from-child' && state.stack.length === 0)
}

// ============== 结束验证 ==============

await teardownDemo(ctx)
