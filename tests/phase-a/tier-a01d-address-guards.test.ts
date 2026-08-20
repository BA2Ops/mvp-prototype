/**
 * Phase A Tier A1d - Address 类型守卫测试
 *
 * 验证：
 * 1. isLiteralAddress
 * 2. isPublicAddress
 * 3. isInternalAddress
 * 4. isFileAddress
 */

import { describe, test, expect } from 'vitest'
import {
  isLiteralAddress,
  isPublicAddress,
  isInternalAddress,
  isFileAddress
} from '../../src/l1/types.js'
import type { Address } from '../../src/l1/types.js'

describe('A1d: Address 类型守卫', () => {
  const literals: Address[] = [
    { kind: 'literal', value: 'x' },
    { kind: 'literal', value: 42 },
    { kind: 'literal', value: null }
  ]

  const publics: Address[] = [
    { kind: 'public', name: 'business_var' },
    { kind: 'public', name: 'output_content' }
  ]

  const internals: Address[] = [
    { kind: 'internal', name: '$r0' },
    { kind: 'internal', name: '$r_err' }
  ]

  const files: Address[] = [
    { kind: 'file', path: '/tmp/a.txt' },
    { kind: 'file', path: './relative' }
  ]

  // ============== isLiteralAddress ==============
  describe('isLiteralAddress', () => {
    test('literal 返回 true', () => {
      for (const addr of literals) {
        expect(isLiteralAddress(addr)).toBe(true)
      }
    })

    test('非 literal 返回 false', () => {
      for (const addr of [...publics, ...internals, ...files]) {
        expect(isLiteralAddress(addr)).toBe(false)
      }
    })

    test('类型缩窄（TypeScript type guard）', () => {
      const addr: Address = { kind: 'literal', value: 'x' }
      if (isLiteralAddress(addr)) {
        // TypeScript 应该知道 addr.value 可访问
        expect(addr.value).toBe('x')
      }
    })
  })

  // ============== isPublicAddress ==============
  describe('isPublicAddress', () => {
    test('public 返回 true', () => {
      for (const addr of publics) {
        expect(isPublicAddress(addr)).toBe(true)
      }
    })

    test('非 public 返回 false', () => {
      for (const addr of [...literals, ...internals, ...files]) {
        expect(isPublicAddress(addr)).toBe(false)
      }
    })
  })

  // ============== isInternalAddress ==============
  describe('isInternalAddress', () => {
    test('internal 返回 true', () => {
      for (const addr of internals) {
        expect(isInternalAddress(addr)).toBe(true)
      }
    })

    test('非 internal 返回 false', () => {
      for (const addr of [...literals, ...publics, ...files]) {
        expect(isInternalAddress(addr)).toBe(false)
      }
    })

    test('$r_err 是 internal', () => {
      const addr: Address = { kind: 'internal', name: '$r_err' }
      expect(isInternalAddress(addr)).toBe(true)
    })
  })

  // ============== isFileAddress ==============
  describe('isFileAddress', () => {
    test('file 返回 true', () => {
      for (const addr of files) {
        expect(isFileAddress(addr)).toBe(true)
      }
    })

    test('非 file 返回 false', () => {
      for (const addr of [...literals, ...publics, ...internals]) {
        expect(isFileAddress(addr)).toBe(false)
      }
    })
  })

  // ============== 互斥性 ==============
  describe('互斥性', () => {
    test('每个 Address 恰好匹配一个 type guard', () => {
      const allAddrs: Address[] = [...literals, ...publics, ...internals, ...files]
      for (const addr of allAddrs) {
        const matches = [
          isLiteralAddress(addr),
          isPublicAddress(addr),
          isInternalAddress(addr),
          isFileAddress(addr)
        ].filter(Boolean).length

        expect(matches).toBe(1)
      }
    })
  })
})