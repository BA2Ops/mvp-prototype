/**
 * Phase A Tier A0 - Sanity Test
 *
 * @see ../../docs/mvp/11-prototype-implementation-plan.md §A0
 *
 * 验证：
 * 1. 项目骨架可编译、可运行测试
 * 2. Mock L2 op 可调用并记录
 * 3. Mock L3 service 返回预设 children
 * 4. Mock L2 throwing_op 模拟硬错误
 */

import { describe, test, expect } from 'vitest'
import { createMockL2 } from '../../src/mocks/mock-l2.js'
import { createMockL3, createSpyL3 } from '../../src/mocks/mock-l3.js'

describe('A0: 项目骨架 + Mock 基础设施', () => {
  describe('Mock L2', () => {
    test('createMockL2 返回 registry 和 tracker', () => {
      const mock = createMockL2()
      expect(mock.registry).toBeDefined()
      expect(mock.tracker).toBeDefined()
      expect(mock.ops.mock_op).toBeDefined()
      expect(mock.ops.throwing_op).toBeDefined()
    })

    test('mock_op 接收 x 返回 x*2', async () => {
      const mock = createMockL2()
      const result = await mock.ops.mock_op.execute({ x: 21 })
      expect(result).toEqual({ result: 42 })
    })

    test('mock_op 调用被 tracker 记录', async () => {
      const mock = createMockL2()
      await mock.ops.mock_op.execute({ x: 5 })
      await mock.ops.mock_op.execute({ x: 10 })

      const calls = mock.tracker.getCalls()
      expect(calls).toEqual([
        { op: 'mock_op', inputs: { x: 5 } },
        { op: 'mock_op', inputs: { x: 10 } }
      ])
      expect(mock.tracker.getCallCount()).toBe(2)
    })

    test('throwing_op 抛出硬错误', async () => {
      const mock = createMockL2()
      await expect(mock.ops.throwing_op.execute({}))
        .rejects.toThrow('mock_throw: hard error from throwing_op')
    })

    test('throwing_op 也被 tracker 记录（验证调用发生过）', async () => {
      const mock = createMockL2()
      try {
        await mock.ops.throwing_op.execute({})
      } catch {
        // expected
      }
      expect(mock.tracker.getCallCount()).toBe(1)
      expect(mock.tracker.getCalls()[0].op).toBe('throwing_op')
    })

    test('mock_op 重置 tracker 后计数清零', async () => {
      const mock = createMockL2()
      await mock.ops.mock_op.execute({ x: 1 })
      expect(mock.tracker.getCallCount()).toBe(1)

      mock.tracker.reset()
      expect(mock.tracker.getCallCount()).toBe(0)
      expect(mock.tracker.getCalls()).toEqual([])
    })

    test('registry.list() 返回已注册 operation 名称', () => {
      const mock = createMockL2()
      const list = mock.registry.list()
      expect(list).toContain('mock_op')
      expect(list).toContain('throwing_op')
    })
  })

  describe('Mock L3', () => {
    test('createMockL3 返回预设 children', async () => {
      const children = [{ id: 'a' }, { id: 'b' }]
      const l3 = createMockL3(children)
      const result = await l3.compile({ type: 'test', params: {} })
      expect(result).toBe(children)
    })

    test('createSpyL3 记录调用次数', async () => {
      const children = [{ id: 'a' }]
      const l3 = createSpyL3(children)

      await l3.compile({ type: 'foo', params: { x: 1 } })
      await l3.compile({ type: 'bar', params: { y: 2 } })

      expect(l3.callCount()).toBe(2)
      expect(l3.lastIntent()).toEqual({ type: 'bar', params: { y: 2 } })
    })
  })
})