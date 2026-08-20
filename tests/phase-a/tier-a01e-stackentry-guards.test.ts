/**
 * Phase A Tier A1e - StackEntry 类型守卫测试
 *
 * 验证：
 * 1. isOpEntry
 * 2. isIntentEntry
 * 3. isMoveEntry
 * 4. isSkipN
 * 5. isConditionalSkip
 */

import { describe, test, expect } from 'vitest'
import {
  isOpEntry,
  isIntentEntry,
  isMoveEntry,
  isSkipN,
  isConditionalSkip,
  assertNever
} from '../../src/l1/types.js'
import type { StackEntry } from '../../src/l1/types.js'

function makeOpEntry(): StackEntry {
  return {
    id: 'op1', parentIntentId: null, createdAt: 0,
    kind: 'execute_op', operation: 'noop',
    inputs: {}, outputs: {}, status: 'pending'
  }
}

function makeIntentEntry(): StackEntry {
  return {
    id: 'i1', parentIntentId: null, createdAt: 0,
    kind: 'execute_intent',
    intent: { type: 'test', params: {} },
    phase: 'pending', children: []
  }
}

function makeMoveEntry(): StackEntry {
  return {
    id: 'm1', parentIntentId: null, createdAt: 0,
    kind: 'move',
    from: { kind: 'literal', value: 'x' },
    to: { kind: 'internal', name: '$r0' }
  }
}

function makeSkipN(): StackEntry {
  return {
    id: 's1', parentIntentId: null, createdAt: 0,
    kind: 'skip_n', n: 1
  }
}

function makeConditionalSkip(): StackEntry {
  return {
    id: 'cs1', parentIntentId: null, createdAt: 0,
    kind: 'conditional_skip',
    conditionAddr: { kind: 'internal', name: '$r_err' },
    n: 2
  }
}

describe('A1e: StackEntry 类型守卫', () => {
  describe('isOpEntry', () => {
    test('execute_op 返回 true', () => {
      expect(isOpEntry(makeOpEntry())).toBe(true)
    })

    test('其他 kind 返回 false', () => {
      expect(isOpEntry(makeMoveEntry())).toBe(false)
      expect(isOpEntry(makeIntentEntry())).toBe(false)
      expect(isOpEntry(makeSkipN())).toBe(false)
      expect(isOpEntry(makeConditionalSkip())).toBe(false)
    })
  })

  describe('isIntentEntry', () => {
    test('execute_intent 返回 true', () => {
      expect(isIntentEntry(makeIntentEntry())).toBe(true)
    })

    test('其他 kind 返回 false', () => {
      expect(isIntentEntry(makeOpEntry())).toBe(false)
      expect(isIntentEntry(makeMoveEntry())).toBe(false)
      expect(isIntentEntry(makeSkipN())).toBe(false)
      expect(isIntentEntry(makeConditionalSkip())).toBe(false)
    })
  })

  describe('isMoveEntry', () => {
    test('move 返回 true', () => {
      expect(isMoveEntry(makeMoveEntry())).toBe(true)
    })

    test('其他 kind 返回 false', () => {
      expect(isMoveEntry(makeOpEntry())).toBe(false)
      expect(isMoveEntry(makeIntentEntry())).toBe(false)
      expect(isMoveEntry(makeSkipN())).toBe(false)
      expect(isMoveEntry(makeConditionalSkip())).toBe(false)
    })
  })

  describe('isSkipN', () => {
    test('skip_n 返回 true', () => {
      expect(isSkipN(makeSkipN())).toBe(true)
    })

    test('其他 kind 返回 false', () => {
      expect(isSkipN(makeOpEntry())).toBe(false)
      expect(isSkipN(makeIntentEntry())).toBe(false)
      expect(isSkipN(makeMoveEntry())).toBe(false)
      expect(isSkipN(makeConditionalSkip())).toBe(false)
    })
  })

  describe('isConditionalSkip', () => {
    test('conditional_skip 返回 true', () => {
      expect(isConditionalSkip(makeConditionalSkip())).toBe(true)
    })

    test('其他 kind 返回 false', () => {
      expect(isConditionalSkip(makeOpEntry())).toBe(false)
      expect(isConditionalSkip(makeIntentEntry())).toBe(false)
      expect(isConditionalSkip(makeMoveEntry())).toBe(false)
      expect(isConditionalSkip(makeSkipN())).toBe(false)
    })
  })

  describe('互斥性', () => {
    test('每个 entry 恰好匹配一个 type guard', () => {
      const all = [
        makeOpEntry(),
        makeIntentEntry(),
        makeMoveEntry(),
        makeSkipN(),
        makeConditionalSkip()
      ]

      for (const entry of all) {
        const matches = [
          isOpEntry(entry),
          isIntentEntry(entry),
          isMoveEntry(entry),
          isSkipN(entry),
          isConditionalSkip(entry)
        ].filter(Boolean).length

        expect(matches).toBe(1)
      }
    })
  })

  describe('assertNever', () => {
    test('never 类型抛错', () => {
      const fake = 'not-a-kind' as never
      expect(() => assertNever(fake)).toThrow(/Unhandled/)
    })
  })
})