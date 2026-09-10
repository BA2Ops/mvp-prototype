/**
 * CRR P1/T-1.2 schema migration test
 *
 * @see docs/mvp/19c-implementation-plan.md §三 T-1.2
 * @see docs/mvp/19b-register-design.md §五 R5.4
 *
 * 契约:
 *  ① 全部 11 个 L2 ops 的 formalSpec 都有 slotIndex 字段 (CRR P1 必填)
 *  ② slotIndex 与 register 同步: $r<N> → <N>, $r_err → ERROR_SLOT_INDEX(99)
 *  ③ parseSlotIndexFromRegister 双向一致 (string ↔ number)
 *  ④ ERROR_SLOT_INDEX=99 sentinel 唯一性
 *  ⑤ formalSpec[k].type 字段不丢失 (从 11 ops 全检)
 *  ⑥ L2Registry.getSpec() 返回值完整
 *
 * 注:sort_by/take_first 已迁移到 evaluate_collection 运算符域
 */

import { describe, it, expect } from 'vitest'
import { L2Registry } from '../../src/l2/registry.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { globMatchOp } from '../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../src/l2/builtins/grep-search.js'
import { shellExecOp } from '../../src/l2/builtins/shell-exec.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../../src/l2/builtins/evaluate-expr.js'
import { evaluateCollectionOp } from '../../src/l2/builtins/evaluate-collection.js'
import { incrementCounterOp } from '../../src/l2/builtins/increment-counter.js'
import { decrementCounterOp } from '../../src/l2/builtins/decrement-counter.js'
import {
  parseSlotIndexFromRegister,
  ERROR_SLOT_INDEX,
  getErrorFormalParam
} from '../../src/l2/operation.js'

function mkRegistry(): L2Registry {
  const r = new L2Registry()
  r.register(fileReadOp); r.register(fileWriteOp); r.register(globMatchOp)
  r.register(grepSearchOp); r.register(shellExecOp); r.register(stringReplaceOp)
  r.register(evaluateExprOp); r.register(evaluateCollectionOp); r.register(incrementCounterOp); r.register(decrementCounterOp)
  return r
}

describe('BC2: FormalParam slotIndex schema migration (T-1.2)', () => {
  describe('① 全部 10 ops 都有 slotIndex 字段', () => {
    it('formalSpec.inputs[k].slotIndex 与 outputs[k].slotIndex 必填', () => {
      const reg = mkRegistry()
      const ops = ['file_read', 'file_write', 'glob_match', 'grep_search', 'shell_exec',
                   'string_replace', 'evaluate_expr', 'evaluate_collection',
                   'increment_counter', 'decrement_counter']
      for (const name of ops) {
        const spec = reg.getSpec(name)
        expect(spec).toBeDefined()
        for (const fp of Object.values(spec!.inputs)) {
          expect(typeof fp.slotIndex).toBe('number')
        }
        for (const fp of Object.values(spec!.outputs)) {
          expect(typeof fp.slotIndex).toBe('number')
        }
      }
    })
  })

  describe('② slotIndex 与 register 同步', () => {
    it('正常寄存器 $r<N> → slotIndex=<N>', () => {
      const reg = mkRegistry()
      const spec = reg.getSpec('file_read')!
      // inputs: $r0=0, $r1=1; outputs: $r2=2
      expect(spec.inputs.path.slotIndex).toBe(0)
      expect(spec.inputs.encoding.slotIndex).toBe(1)
      expect(spec.outputs.content.slotIndex).toBe(2)
    })

    it('错误寄存器 $r_err → slotIndex=ERROR_SLOT_INDEX(99)', () => {
      const reg = mkRegistry()
      const spec = reg.getSpec('file_read')!
      expect(spec.outputs.error.slotIndex).toBe(ERROR_SLOT_INDEX)
      expect(spec.outputs.error.slotIndex).toBe(99)
    })

    it('P0/T-0.1 dump 数据同步: string_replace 5 inputs / shell_exec 4 outputs', () => {
      const reg = mkRegistry()
      const srSpec = reg.getSpec('string_replace')!
      // inputs: $r0..$r4 → 0..4
      expect(Object.keys(srSpec.inputs).length).toBe(5)
      const inputIndices = Object.values(srSpec.inputs).map(p => p.slotIndex).sort((a, b) => a - b)
      expect(inputIndices).toEqual([0, 1, 2, 3, 4])
      // outputs: $r5, $r6, $r_err → 5, 6, 99
      const outputIndices = Object.values(srSpec.outputs).map(p => p.slotIndex).sort((a, b) => a - b)
      expect(outputIndices).toEqual([5, 6, ERROR_SLOT_INDEX])

      const shSpec = reg.getSpec('shell_exec')!
      // outputs: $r4, $r5, $r6, $r_err → 4, 5, 6, 99 (P_max=3 + error)
      const shOuts = Object.values(shSpec.outputs).map(p => p.slotIndex).sort((a, b) => a - b)
      expect(shOuts).toEqual([4, 5, 6, ERROR_SLOT_INDEX])
    })
  })

  describe('③ parseSlotIndexFromRegister 双向一致', () => {
    it('$r<N> → N', () => {
      expect(parseSlotIndexFromRegister('$r0')).toBe(0)
      expect(parseSlotIndexFromRegister('$r5')).toBe(5)
      expect(parseSlotIndexFromRegister('$r99')).toBe(99)
    })

    it('$r_err / $err → ERROR_SLOT_INDEX(99)', () => {
      expect(parseSlotIndexFromRegister('$r_err')).toBe(ERROR_SLOT_INDEX)
      expect(parseSlotIndexFromRegister('$err')).toBe(ERROR_SLOT_INDEX)
    })

    it('scope-prefixed slot: $S<scope>.in<k> / .out<k> / .argtmp<k> / .cond<k> / .judge<k>', () => {
      expect(parseSlotIndexFromRegister('$Ss0.in0')).toBe(0)
      expect(parseSlotIndexFromRegister('$Ss12.out3')).toBe(3)
      expect(parseSlotIndexFromRegister('$Ss0.argtmp5')).toBe(5)
      expect(parseSlotIndexFromRegister('$Ss0.cond0')).toBe(0)
      expect(parseSlotIndexFromRegister('$Ss0.judge2')).toBe(2)
    })

    it('不可识别的字符串抛错', () => {
      expect(() => parseSlotIndexFromRegister('foo')).toThrow(/cannot parse/i)
      expect(() => parseSlotIndexFromRegister('$r_xx')).toThrow(/cannot parse/i)
    })
  })

  describe('④ ERROR_SLOT_INDEX sentinel 唯一性', () => {
    it('99 是 sentinel,且不与任何 op 的正常 slotIndex 冲突', () => {
      const reg = mkRegistry()
      const ops = ['file_read', 'file_write', 'glob_match', 'grep_search', 'shell_exec',
                   'string_replace', 'evaluate_expr', 'evaluate_collection',
                   'increment_counter', 'decrement_counter']
      for (const name of ops) {
        const spec = reg.getSpec(name)!
        for (const fp of Object.values(spec.inputs)) {
          expect(fp.slotIndex).not.toBe(ERROR_SLOT_INDEX)
        }
        for (const fp of Object.values(spec.outputs)) {
          // 非 error slot 不会撞 99
          if (fp.businessName !== 'error') {
            expect(fp.slotIndex).not.toBe(ERROR_SLOT_INDEX)
          }
        }
      }
    })
  })

  describe('⑤ type 字段不丢失 (迁移安全)', () => {
    it('所有 formalSpec 条目都保留 type 字段', () => {
      const reg = mkRegistry()
      const ops = ['file_read', 'file_write', 'glob_match', 'grep_search', 'shell_exec',
                   'string_replace', 'evaluate_expr', 'evaluate_collection',
                   'increment_counter', 'decrement_counter']
      for (const name of ops) {
        const spec = reg.getSpec(name)!
        for (const fp of Object.values({ ...spec.inputs, ...spec.outputs })) {
          expect(fp.type).toBeDefined()
          expect(typeof fp.type).toBe('string')
        }
      }
    })
  })

  describe('⑥ L2Registry.getSpec() 完整性', () => {
    it('getSpec 返回值与 op.formalSpec 同引用', () => {
      const reg = mkRegistry()
      const op = reg.get('file_read')!
      expect(reg.getSpec('file_read')).toBe(op.formalSpec)
    })

    it('未注册的 op 返回 undefined', () => {
      const reg = mkRegistry()
      expect(reg.getSpec('unknown_op')).toBeUndefined()
    })

    it('getErrorFormalParam 同时支持 register 或 slotIndex 判定', () => {
      const reg = mkRegistry()
      const spec = reg.getSpec('file_read')!
      const err = getErrorFormalParam(spec)
      expect(err).toBeDefined()
      expect(err!.businessName).toBe('error')
    })
  })
})