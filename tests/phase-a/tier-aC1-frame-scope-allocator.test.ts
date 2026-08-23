/**
 * CRR P1/T-1.1 FrameScopeAllocator 单元测试
 *
 * @see docs/mvp/19c-implementation-plan.md §三 T-1.1
 * @see docs/mvp/19b-register-design.md §五 R-1🔴高(scope pop/bubbleError 对称性)
 *
 * 覆盖 R-1 关键场景:
 *  ① 正常 enter/exitScope 对称 (pop 后 activeCount=0, 无残留)
 *  ② error 路径对称 (bubbleError abortFrame 也必须 exitScope,不能泄漏)
 *  ③ retry-until-success 嵌套 (A→B→A 第二次进入时 cursor 不重置,不与第一次冲突)
 *  ④ MAX_ACTIVE_SCOPES 软限 (depth=9 throw, depth=8 正常)
 *  ⑤ literal/judge pool round-robin (cursor < pool size 时单调递增,达上限后回绕)
 *  ⑥ slot name 格式契约 ($S<scopeId>.in<k> / .out<k> / .argtmp<N> / .cond<N> / .judge<N>)
 *  ⑦ reset() 语义 (与 createInitialState 一致)
 */

import { describe, it, expect } from 'vitest'
import { FrameScopeAllocator } from '../../src/l1/execution-state.js'
import { MAX_ACTIVE_SCOPES, LITERAL_POOL_SIZE, JUDGE_COND_POOL_SIZE, M_MAX } from '../../src/l3/crr-config.js'

describe('A C1: FrameScopeAllocator (CRR P1/T-1.1)', () => {
  describe('basic enter/exit', () => {
    it('① enter 一個 scope 後 activeCount=1, currentScope 返回正確 id', () => {
      const alloc = new FrameScopeAllocator()
      const s = alloc.enterScope()
      expect(alloc.getActiveScopeCount()).toBe(1)
      expect(alloc.currentScope()).toBe(s)
    })

    it('退出對稱: enter N 次後 exit N 次, activeCount 歸零', () => {
      const alloc = new FrameScopeAllocator()
      const scopes: string[] = []
      for (let i = 0; i < 5; i++) scopes.push(alloc.enterScope())
      expect(alloc.getActiveScopeCount()).toBe(5)
      for (let i = 0; i < 5; i++) alloc.exitScope()
      expect(alloc.getActiveScopeCount()).toBe(0)
    })

    it('退出空 stack 會拋錯(設計錯誤信号)', () => {
      const alloc = new FrameScopeAllocator()
      expect(() => alloc.exitScope()).toThrow(/asymmetric/i)
    })

    it('未 enterScope 直接 currentScope 會拋錯', () => {
      const alloc = new FrameScopeAllocator()
      expect(() => alloc.currentScope()).toThrow(/no active scope/i)
    })
  })

  describe('R-1🔴高 scenario ②: error path 對稱性', () => {
    it('error 路径後 exitScope 與正常路径語義相同 —— 計數器不泄漏', () => {
      const alloc = new FrameScopeAllocator()
      const s1 = alloc.enterScope()
      expect(alloc.getActiveScopeCount()).toBe(1)
      // 模擬 op.execute 拋錯 → bubbleError → abortFrame 對稱退出
      alloc.exitScope()
      expect(alloc.getActiveScopeCount()).toBe(0)
      // 進新 scope 應拿到新 id (counter 遞增)
      const s2 = alloc.enterScope()
      expect(s2).not.toBe(s1)
      expect(alloc.getActiveScopeCount()).toBe(1)
    })

    it('嵌套 A→B→err: A frame 與 B frame 各自正確計數', () => {
      const alloc = new FrameScopeAllocator()
      alloc.enterScope() // A
      expect(alloc.getActiveScopeCount()).toBe(1)
      alloc.enterScope() // B
      expect(alloc.getActiveScopeCount()).toBe(2)
      // B 拋錯 → exitScope B
      alloc.exitScope()
      expect(alloc.getActiveScopeCount()).toBe(1)
      // A 正常完成 → exitScope A
      alloc.exitScope()
      expect(alloc.getActiveScopeCount()).toBe(0)
    })
  })

  describe('R-1 scenario ③: retry-until-success 嵌套重入', () => {
    it('同 scopeId 不重用(globalScopeCounter 單調遞增保證唯一性)', () => {
      const alloc = new FrameScopeAllocator()
      const ids = new Set<string>()
      for (let i = 0; i < 10; i++) {
        const s = alloc.enterScope()
        expect(ids.has(s)).toBe(false) // 永不重複
        ids.add(s)
        alloc.exitScope()
      }
      expect(ids.size).toBe(10)
    })

    it('嵌套循環 A→B→A 第二次 B 拿到新 scopeId 不與第一次衝突', () => {
      const alloc = new FrameScopeAllocator()
      // 第一次嵌套
      alloc.enterScope() // A1
      const b1 = alloc.enterScope() // B1
      alloc.exitScope()
      alloc.exitScope()
      // 第二次嵌套
      alloc.enterScope() // A2
      const b2 = alloc.enterScope() // B2
      expect(b1).not.toBe(b2)
      expect(b1.startsWith('s')).toBe(true)
      expect(b2.startsWith('s')).toBe(true)
      alloc.exitScope()
      alloc.exitScope()
    })
  })

  describe('R-1 scenario ④: MAX_ACTIVE_SCOPES 軟限', () => {
    it(`depth=${MAX_ACTIVE_SCOPES} 正常, 第 ${MAX_ACTIVE_SCOPES + 1} 次 enterScope 拋錯`, () => {
      const alloc = new FrameScopeAllocator()
      for (let i = 0; i < MAX_ACTIVE_SCOPES; i++) {
        expect(() => alloc.enterScope()).not.toThrow()
      }
      expect(alloc.getActiveScopeCount()).toBe(MAX_ACTIVE_SCOPES)
      expect(() => alloc.enterScope()).toThrow(/max active scopes/i)
    })

    it('exit 後 再 enter 可成功(計數器釋放)', () => {
      const alloc = new FrameScopeAllocator()
      for (let i = 0; i < MAX_ACTIVE_SCOPES; i++) alloc.enterScope()
      expect(() => alloc.enterScope()).toThrow()
      alloc.exitScope()
      expect(() => alloc.enterScope()).not.toThrow()
    })
  })

  describe('literal/judge pool round-robin', () => {
    it('allocateArgtmpSlot: 同 scope 連續 N 次, N≤pool size 單調遞增', () => {
      const alloc = new FrameScopeAllocator()
      const s = alloc.enterScope()
      const names: string[] = []
      for (let i = 0; i < LITERAL_POOL_SIZE; i++) {
        names.push(alloc.allocateArgtmpSlot(s))
      }
      // 命名格式 $S<scopeId>.argtmp<k>
      expect(names[0]).toBe(`$S${s}.argtmp0`)
      expect(names[LITERAL_POOL_SIZE - 1]).toBe(`$S${s}.argtmp${LITERAL_POOL_SIZE - 1}`)
    })

    it('argtmp cursor 超過 pool size 後回繞 (round-robin)', () => {
      const alloc = new FrameScopeAllocator()
      const s = alloc.enterScope()
      // 取 pool_size * 2 + 1 個, 確認回到 argtmp0
      const taken: string[] = []
      for (let i = 0; i < LITERAL_POOL_SIZE * 2 + 1; i++) {
        taken.push(alloc.allocateArgtmpSlot(s))
      }
      expect(taken[LITERAL_POOL_SIZE]).toBe(`$S${s}.argtmp0`) // 回繞
      expect(taken[LITERAL_POOL_SIZE * 2]).toBe(`$S${s}.argtmp0`) // 再次回繞
    })

    it('allocateCondScratch / allocateJudgeScratch: cond vs judge 各自獨立 round-robin', () => {
      const alloc = new FrameScopeAllocator()
      const s = alloc.enterScope()
      const cond0 = alloc.allocateCondScratch(s)
      const cond1 = alloc.allocateCondScratch(s)
      const judge0 = alloc.allocateJudgeScratch(s)
      // cond 和 judge 各自從 0 遞增 (隔離的 counter Map,不會互相污染)
      expect(cond0).toBe(`$S${s}.cond0`)
      expect(cond1).toBe(`$S${s}.cond1`)
      expect(judge0).toBe(`$S${s}.judge0`)
      expect(judge0).not.toBe(cond0)
      expect(judge0).not.toBe(cond1)
    })

    it('不同 scope 的 argtmp cursor 獨立(round-robin per-scope)', () => {
      const alloc = new FrameScopeAllocator()
      const s1 = alloc.enterScope()
      const name1a = alloc.allocateArgtmpSlot(s1)
      const s2 = alloc.enterScope()
      const name2a = alloc.allocateArgtmpSlot(s2)
      // 不同 scope 都從 0 開始,各自 round-robin
      expect(name1a).toBe(`$S${s1}.argtmp0`)
      expect(name2a).toBe(`$S${s2}.argtmp0`)
      expect(name1a).not.toBe(name2a)
    })
  })

  describe('reset() 語義', () => {
    it('reset 後 activeCount=0, 可從頭 enterScope', () => {
      const alloc = new FrameScopeAllocator()
      alloc.enterScope()
      alloc.enterScope()
      expect(alloc.getActiveScopeCount()).toBe(2)
      alloc.reset()
      expect(alloc.getActiveScopeCount()).toBe(0)
      const s = alloc.enterScope()
      expect(s.startsWith('s')).toBe(true)
      expect(alloc.getActiveScopeCount()).toBe(1)
    })

    it('reset 後 globalScopeCounter 歸零(scopeId 從頭開始)', () => {
      const alloc = new FrameScopeAllocator()
      const a = alloc.enterScope()
      alloc.exitScope()
      alloc.reset()
      const b = alloc.enterScope()
      expect(a).toBe(b) // reset 後重新計數,s0 第一次出現
    })
  })

  describe('slot name 格式契約(防 regression)', () => {
    it('scopeId 格式: s<number>', () => {
      const alloc = new FrameScopeAllocator()
      const s = alloc.enterScope()
      expect(s).toMatch(/^s\d+$/)
    })

    it('pool size 上限驗證: LITERAL_POOL_SIZE > M_MAX (P0/T-0.1 約束)', () => {
      // 確保 literal pool 有足夠余量給 in-slot 之外的字面量參數
      expect(LITERAL_POOL_SIZE).toBeGreaterThan(M_MAX)
    })

    it('judge/cond pool size 上限驗證: JUDGE_COND_POOL_SIZE ≥ 10', () => {
      expect(JUDGE_COND_POOL_SIZE).toBeGreaterThanOrEqual(10)
    })
  })
})