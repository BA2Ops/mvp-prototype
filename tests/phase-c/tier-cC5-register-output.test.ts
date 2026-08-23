/**
 * CRR P3/T-3.1 + T-3.2 — ParamRef.kind:'registerOutput' schema + compiler binding move
 *
 * @see docs/mvp/19c-implementation-plan.md §三 T-3.1, T-3.2
 *
 * 契约:
 *  ① ParamRef union 增加 registerOutput 分支 { expId?, outKey }
 *  ② 嵌套 intent 的 registerOutput input 编译生成 binding move:
 *     from: $S<parentScope>.out<K> (K = 源 op formalSpec.outputs[outKey].slotIndex)
 *     to:   $r_input_<inputParamName>
 *  ③ binding move 在 children 数组中先于嵌套 IntentEntry (LIFO:先 pop)
 *  ④ type check (T-3.3 联动): source.type 与 child op formalSpec.input[k].type 不一致 → throw ParamRefError
 *  ⑤ 端到端: 父经验 A.file_read.output.content → 子经验 B.string_replace.input.text 真实传值
 */

import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { l1MainLoop } from '../../src/l1/main-loop.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { enableCrrNewPath } from '../../src/l1/main-loop.js'
import { compileExperience, ParamRefError } from '../../src/l3/compiler.js'
import { L2Registry } from '../../src/l2/registry.js'
import { ExperienceService } from '../../src/l3/experience-service.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { shellExecOp } from '../../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../../src/l2/builtins/evaluate-expr.js'
import { incrementCounterOp } from '../../src/l2/builtins/increment-counter.js'
import { decrementCounterOp } from '../../src/l2/builtins/decrement-counter.js'
import { sortByOp } from '../../src/l2/builtins/sort-by.js'
import { takeFirstOp } from '../../src/l2/builtins/take-first.js'
import type { Experience, OpStep } from '../../src/l3/experience.js'

function mkRegistry(): L2Registry {
  const r = new L2Registry()
  r.register(fileReadOp); r.register(fileWriteOp); r.register(shellExecOp)
  r.register(globMatchOp); r.register(grepSearchOp); r.register(stringReplaceOp)
  r.register(evaluateExprOp); r.register(incrementCounterOp); r.register(decrementCounterOp)
  r.register(sortByOp); r.register(takeFirstOp)
  return r
}

// 测试用 fixtures: 模拟 A (file_read) → B (string_replace) 串联
function mkExA(): Experience {
  const steps: OpStep[] = [{
    operation: 'file_read',
    inputs: { path: { kind: 'literal', value: '/tmp/test-a.txt' } },
    outputs: {
      content: { kind: 'register', name: '$r_content' },
      error: { kind: 'register', name: '$r_err' }
    }
  }]
  return {
    id: 'exp_a',
    description: 'reads file, produces content',
    inputs: {},
    outputs: { content: { type: 'string', required: true } },
    outputs_bindings: {
      content: { register: '$r_content', type: 'string', persist: true }
    },
    target_op: {
      base_op: 'file_read',
      default_path: 'normal',
      paths: [{ id: 'normal', steps }]
    }
  }
}

function mkExB(): Experience {
  const steps: OpStep[] = [{
    operation: 'string_replace',
    inputs: {
      text: { kind: 'input', name: 'text' },
      find: { kind: 'literal', value: 'WORLD' },
      replace: { kind: 'literal', value: 'WORLD-EXP-B' }
    },
    outputs: {
      result: { kind: 'register', name: '$r_result' },
      error: { kind: 'register', name: '$r_err' }
    }
  }]
  return {
    id: 'exp_b',
    description: 'string_replace on text',
    inputs: {
      text: { type: 'string', required: true }
    },
    outputs: { result: { type: 'string', required: true } },
    outputs_bindings: {
      result: { register: '$r_result', type: 'string', persist: true }
    },
    target_op: {
      base_op: 'string_replace',
      default_path: 'normal',
      paths: [{ id: 'normal', steps }]
    }
  }
}

function mkExC(): Experience {
  // C: 调用 A 取 file_read.content, 然后调用 B 做 string_replace
  const steps: OpStep[] = [
    {
      operation: 'exp_a',
      inputs: {},
      outputs: { content: { kind: 'register', name: '$r_c_content' } }
    },
    {
      operation: 'exp_b',
      inputs: {
        // T-3.2 contract: 引用 A 的 output 'content'
        text: { kind: 'registerOutput', expId: 'exp_a', outKey: 'content' }
      },
      outputs: { result: { kind: 'register', name: '$r_c_result' } }
    }
  ]
  return {
    id: 'exp_c',
    description: 'reads file (via A) then replaces (via B)',
    inputs: {},
    outputs: { result: { type: 'string', required: true } },
    outputs_bindings: {
      result: { register: '$r_c_result', type: 'string', persist: true }
    },
    target_op: {
      base_op: 'string_replace',  // 随意,只为通过编译检查
      default_path: 'normal',
      paths: [{ id: 'normal', steps }]
    }
  }
}

function mkExperiences(a: Experience, b: Experience, c: Experience): Map<string, Experience> {
  const m = new Map<string, Experience>()
  m.set(a.id, a); m.set(b.id, b); m.set(c.id, c)
  return m
}

describe('CC5: ParamRef.registerOutput + compiler binding move (T-3.1 + T-3.2)', () => {
  describe('① ParamRef schema', () => {
    it('registerOutput 变体包含 expId (可选) + outKey (必填)', () => {
      const ref: import('../../src/l3/experience.js').ParamRef = {
        kind: 'registerOutput',
        expId: 'exp_a',
        outKey: 'content'
      }
      expect(ref.kind).toBe('registerOutput')
      expect(ref.expId).toBe('exp_a')
      expect(ref.outKey).toBe('content')
    })

    it('registerOutput 允许 expId 省略 (运行时通过当前 frame 反查)', () => {
      const ref: import('../../src/l3/experience.js').ParamRef = {
        kind: 'registerOutput',
        outKey: 'content'
      }
      expect(ref.kind).toBe('registerOutput')
      expect(ref.expId).toBeUndefined()
    })
  })

  describe('② ③ compiler binding move 生成 (new path)', () => {
    it('嵌套 registerOutput input 编译生成 binding move: $Sparent.outK → $r_input_<k>', () => {
      enableCrrNewPath()
      const r = mkRegistry()
      const A = mkExA(), B = mkExB(), C = mkExC()
      const state = createInitialState(r, new ExperienceService([A, B, C], r))
      state.frameScopeAllocator!.enterScope()
      const entries = compileExperience(
        { type: 'exp_c', params: {} },
        state, mkExperiences(A, B, C), r,
        { useFixedSlotConvention: true }
      )
      // 找 binding move (internal → $r_input_*)
      const bindingMoves = entries.filter((e: any) =>
        e.kind === 'move' &&
        e.to.kind === 'internal' &&
        e.to.name.startsWith('$r_input_')
      )
      expect(bindingMoves.length).toBe(1)
      const m = bindingMoves[0] as any
      expect(m.to.name).toBe('$r_input_text')
      // exp_a 声明了 outputs_bindings.content.persist:true → 通过 publicStore 间接引用 (T-2.2 materialization)
      expect(m.from.kind).toBe('public')
      expect(m.from.name).toBe('exp_a.content')
    })

    it('binding move 在 children 数组中先于嵌套 IntentEntry (顺序保障)', () => {
      enableCrrNewPath()
      const r = mkRegistry()
      const A = mkExA(), B = mkExB(), C = mkExC()
      const state = createInitialState(r, new ExperienceService([A, B, C], r))
      state.frameScopeAllocator!.enterScope()
      const entries = compileExperience(
        { type: 'exp_c', params: {} },
        state, mkExperiences(A, B, C), r,
        { useFixedSlotConvention: true }
      )
      // children[0] 应是 binding move (先执行)
      // children[1] 应是 exp_b 的 IntentEntry (含 exp_b.children 中的 file_read move)
      // 整体: [binding_move_for_b_text, intent_exp_b (含 file_read 副作用), ...]
      // 找到第一个 kind === 'move' 且 to.name === '$r_input_text' 的项
      const idx = entries.findIndex((e: any) =>
        e.kind === 'move' &&
        (e as any).to.name === '$r_input_text'
      )
      expect(idx).toBeGreaterThanOrEqual(0)
      // 紧跟其后应是 exp_b 的 IntentEntry
      expect(entries[idx + 1].kind).toBe('execute_intent')
      expect((entries[idx + 1] as any).intent.type).toBe('exp_b')
    })
  })

  describe('④ legacy path 兼容', () => {
    it('legacy mode 下也生成 binding move, 但 source 是 $r_<outKey> 直接名', () => {
      // 不调用 enableCrrNewPath → legacy
      const r = mkRegistry()
      const A = mkExA(), B = mkExB(), C = mkExC()
      const state = createInitialState(r, new ExperienceService([A, B, C], r))
      const entries = compileExperience(
        { type: 'exp_c', params: {} },
        state, mkExperiences(A, B, C), r
      )
      const bindingMoves = entries.filter((e: any) =>
        e.kind === 'move' &&
        e.to.name === '$r_input_text'
      )
      expect(bindingMoves.length).toBe(1)
      // legacy: from = $r_content (legacy register 名)
      expect((bindingMoves[0] as any).from.name).toBe('$r_content')
    })
  })

  describe('⑤ 端到端 l1MainLoop + binding', () => {
    it('new path: A.file_read.content → B.string_replace.text 真实传值', async () => {
      enableCrrNewPath()
      const dir = await fs.mkdtemp(join(tmpdir(), 'cc5-'))
      try {
        await fs.writeFile(join(dir, 'in.txt'), 'hello WORLD world', 'utf-8')
        const r = mkRegistry()
        const A = mkExA()
        const B = mkExB()
        // 覆写 A.path 为绝对文件路径 (test fixture)
        const aFixture: Experience = {
          ...A,
          target_op: {
            ...A.target_op,
            paths: [{
              id: 'normal',
              steps: [{
                operation: 'file_read',
                inputs: { path: { kind: 'literal', value: join(dir, 'in.txt') } },
                outputs: {
                  content: { kind: 'register', name: '$r_content' },
                  error: { kind: 'register', name: '$r_err' }
                }
              }]
            }]
          }
        }
        const C: Experience = {
          ...mkExC(),
          target_op: {
            ...mkExC().target_op,
            paths: [{
              id: 'normal',
              steps: [
                { operation: 'exp_a', inputs: {}, outputs: { content: { kind: 'register', name: '$r_c_content' } } },
                { operation: 'exp_b', inputs: { text: { kind: 'registerOutput', expId: 'exp_a', outKey: 'content' } }, outputs: { result: { kind: 'register', name: '$r_c_result' } } }
              ]
            }]
          }
        }
const state = createInitialState(r, new ExperienceService([aFixture, B, C], r))
        await l1MainLoop({ type: 'exp_c', params: {} }, state, true)
        // 断言: string_replace 应用到 read_file.content 上
        // exp_b.outputs_bindings.result.persist:true → post-bindings 写入 publicStore['exp_b.result']
        expect(state.publicStore.has('exp_b.result')).toBe(true)
        const result = state.publicStore.get('exp_b.result')
        expect(result).toBe('hello WORLD-EXP-B world')
      } finally {
        await fs.rm(dir, { recursive: true, force: true })
      }
    })
  })

  describe('T-3.3 compile-time type mismatch + 悬空检测', () => {
    const r = mkRegistry()
    const A = mkExA(), B = mkExB()

    function withStep(textKind: any): Experience {
      return {
        ...mkExC(),
        target_op: {
          ...mkExC().target_op,
          paths: [{
            id: 'normal',
            steps: [
              { operation: 'exp_a', inputs: {}, outputs: {} },
              { operation: 'exp_b', inputs: { text: textKind }, outputs: {} }
            ]
          }]
        }
      }
    }

    it('source.type vs dest.inputs[k].type 不一致 → throw ParamRefError("incompatible type")', () => {
      enableCrrNewPath()
      // exp_b.inputs.text.type='string'; source file_read.content slotIndex 的 opSpec type 可能为 string —— 构造不匹配:
      //   造一个 fake source op type 'number' via custom registry? MVP 用 monkey patch getSpec。
      const reg2 = mkRegistry()
      const origGetSpec = reg2.getSpec.bind(reg2)
      ;(reg2 as any).getSpec = (name: string) => {
        const spec = origGetSpec(name)
        if (spec?.outputs?.content && name === 'file_read') {
          return { ...spec, outputs: { ...spec.outputs, content: { ...(spec.outputs as any).content, type: 'number' as any } } }
        }
        return spec
      }
      const state = createInitialState(r, new ExperienceService([A, B], r))
      state.frameScopeAllocator!.enterScope()
      try {
        compileExperience(
          { type: 'exp_c', params: {} },
          state,
          mkExperiences(A, B, withStep({ kind: 'registerOutput', expId: 'exp_a', outKey: 'content' })),
          reg2 as unknown as L2Registry,
          { useFixedSlotConvention: true }
        )
        expect.fail('应 throw ParamRefError')
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
        // T-3.4 验收: message 含 incompatible type
        expect((e as Error).message).toMatch(/incompatible type/)
      }
    })

    it('ParamRefError is Error subclass + name=ParamRefError', async () => {
      enableCrrNewPath()
      const C = withStep({ kind: 'registerOutput', expId: 'exp_a', outKey: 'NOT_EXIST' })
      const state = createInitialState(r, new ExperienceService([A, B, C], r))
      state.frameScopeAllocator!.enterScope()
      let caught: unknown
      try {
        compileExperience(
          { type: 'exp_c', params: {} },
          state,
          mkExperiences(A, B, C),
          r,
          { useFixedSlotConvention: true }
        )
      } catch (e) { caught = e; void e }
      expect(caught).toBeTruthy()
      const err = new ParamRefError('sample'); expect(err.name).toBe('ParamRefError'); expect(err instanceof Error).toBe(true)
    })
  })


  describe('错误处理 (T-3.2)', () => {
    it('registerOutput 引用悬空 outKey → throw ParamRefError (T-3.3 联动)', () => {
      enableCrrNewPath()
      const r = mkRegistry()
      const A = mkExA(), B = mkExB()
      const C: Experience = {
        ...mkExC(),
        target_op: {
          ...mkExC().target_op,
          paths: [{
            id: 'normal',
            steps: [
              { operation: 'exp_a', inputs: {}, outputs: { content: { kind: 'register', name: '$r_c_content' } } },
              { operation: 'exp_b', inputs: { text: { kind: 'registerOutput', expId: 'exp_a', outKey: 'NOT_EXIST' } }, outputs: { result: { kind: 'register', name: '$r_c_result' } } }
            ]
          }]
        }
      }
      const state = createInitialState(r, new ExperienceService([A, B, C], r))
      state.frameScopeAllocator!.enterScope()
      expect(() => compileExperience(
        { type: 'exp_c', params: {} },
        state, mkExperiences(A, B, C), r,
        { useFixedSlotConvention: true }
      )).toThrow(/NOT_EXIST/)
    })
  })
})