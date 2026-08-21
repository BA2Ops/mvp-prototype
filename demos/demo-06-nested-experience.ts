/**
 * Demo 06 — 嵌套经验调用与幂等编排
 *
 * 演示能力：
 *          - 经验 step 引用另一条经验 → execute_intent 嵌套帧
 *          - 编排经验串联多条核心经验
 *          - 幂等性（safe_write 已存在则跳过）
 *
 * 运行：npx tsx demos/demo-06-nested-experience.ts
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { setupDemo, step, observe, note, verify, teardownDemo, type DemoCtx } from './lib.js'
import { l1MainLoop } from '../src/l1/main-loop.js'
import { createInitialState } from '../src/l1/execution-state.js'
import { L2Registry } from '../src/l2/registry.js'
import { ExperienceService } from '../src/l3/experience-service.js'
import { CORE_EXPERIENCES } from '../src/l3/experience-library.js'
import type { Experience } from '../src/l3/experience.js'
import type { Value } from '../src/l1/types.js'
import { fileReadOp } from '../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../src/l2/builtins/file-write.js'
import { shellExecOp } from '../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../src/l2/builtins/evaluate-expr.js'

const ctx = await setupDemo('Demo 06 — 嵌套经验调用')

// ============== 准备 ==============

step('0', '准备：注册 op + 编排经验（嵌套 3 条核心经验）')
const registry = new L2Registry()
for (const op of [fileReadOp, fileWriteOp, shellExecOp, globMatchOp, grepSearchOp, stringReplaceOp, evaluateExprOp]) {
  registry.register(op)
}

/** 编排经验：初始化工作区（嵌套 safe_write / write_file / replace_in_file）*/
const setupWorkspace: Experience = {
  id: 'setup_workspace', description: '初始化工作区',
  handleError: true,
  inputs: {
    config_path: { type: 'path', required: true },
    note_path: { type: 'path', required: true }
  },
  outputs: {},
  target_op: { base_op: 'file_read', default_path: 'normal', paths: [{
    id: 'normal', description: '', steps: [
      // 嵌套调用 1：safe_write（params 用 input ref + literal）
      { operation: 'safe_write',
        inputs: { path: { kind: 'input', name: 'config_path' }, content: { kind: 'literal', value: '[default]\nmode=demo' } },
        outputs: {} },
      // 嵌套调用 2：write_file
      { operation: 'write_file',
        inputs: { path: { kind: 'input', name: 'note_path' }, content: { kind: 'literal', value: 'TODO: old-task' } },
        outputs: {} },
      // 嵌套调用 3：replace_in_file（内部又是 读→替换→写 三步链）
      { operation: 'replace_in_file',
        inputs: { path: { kind: 'input', name: 'note_path' }, find: { kind: 'literal', value: 'old-task' }, replace: { kind: 'literal', value: 'new-task' } },
        outputs: {} }
    ]
  }] }
}

const service = new ExperienceService([...CORE_EXPERIENCES, setupWorkspace], registry)

async function runSetup() {
  const state = createInitialState(registry, service)
  await l1MainLoop(
    { type: 'setup_workspace', params: { config_path: join(ctx.dir, 'config.ini'), note_path: join(ctx.dir, 'note.txt') } },
    state,
    { rootHandleError: service.shouldHandleError('setup_workspace') }
  )
  return state.internalStore as unknown as Map<string, unknown>
}

// ============== 步骤 1: 首次运行 ==============

step('1', '首次运行 — 三个嵌套帧依次执行')
{
  const store = await runSetup()
  const configContent = await fs.readFile(join(ctx.dir, 'config.ini'), 'utf-8')
  const noteContent = await fs.readFile(join(ctx.dir, 'note.txt'), 'utf-8')
  observe('config.ini 内容', configContent)
  observe('note.txt 内容', noteContent)
  observe('$r_count（replace_in_file 的替换数，跨经验可见）', store.get('$r_count'))
  observe('$r_err', store.get('$r_err'))
  note('replace_in_file 内部还有三层嵌套——嵌套深度只受递归深度防护约束')
  verify(ctx, '配置写入且笔记完成替换', () =>
    configContent === '[default]\nmode=demo' &&
    noteContent === 'TODO: new-task' &&
    store.get('$r_count') === 1 &&
    store.get('$r_err') === null)
}

// ============== 步骤 2: 幂等重跑 ==============

step('2', '第二次运行 — safe_write 跳过已存在配置（幂等性）')
{
  const store = await runSetup()
  const configAfter = await fs.readFile(join(ctx.dir, 'config.ini'), 'utf-8')
  observe('config.ini 内容（应不变）', configAfter)
  observe('$r_bytes（safe_write abort 路径 → 后续 write_file 的字节数）', store.get('$r_bytes'))
  verify(ctx, '配置未被覆盖（幂等）且全程无错误', () =>
    configAfter === '[default]\nmode=demo' && store.get('$r_err') === null)
}

// ============== 步骤 3: MVP 限制演示 ==============

step('3', 'MVP 限制：嵌套 params 不支持 register 引用（编译期报错）')
{
  const badExp: Experience = {
    id: 'bad_nested', description: '', inputs: {}, outputs: {},
    target_op: { base_op: 'x', default_path: 'normal', paths: [{
      id: 'normal', description: '', steps: [{
        operation: 'write_file',
        inputs: { path: { kind: 'input', name: 'p' }, content: { kind: 'register', name: '$r_something' } },
        outputs: {}
      }]
    }] }
  }
  const svc = new ExperienceService([...CORE_EXPERIENCES, badExp], registry)
  const state = createInitialState(registry, svc)
  let msg = ''
  try {
    svc.compile({ type: 'bad_nested', params: { p: 'x' } }, state)
  } catch (e) { msg = (e as Error).message }
  observe('编译错误信息', msg.slice(0, 80))
  note('register 引用需运行时求值，而 intent.params 是静态值——Phase D 用全局寄存器方案绕过')
  verify(ctx, 'register 引用在编译期被拒绝', () => /register ref/i.test(msg))
}

// ============== 结束验证 ==============

await teardownDemo(ctx)
