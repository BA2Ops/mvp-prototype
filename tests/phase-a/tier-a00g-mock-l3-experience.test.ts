/**
 * Phase A Tier A0g - Mock L3（Experience 模型版）测试
 *
 * 验证（2026-08-20 新增）：
 * - createMockL3 返回的 L3Service 满足新接口（compile + getExperience + recordFeedback + listExperiences + recompile）
 * - createSpyL3 追踪所有调用（含 recordFeedback/recompile）
 * - createProgrammableL3 支持按 type 路由 children
 *
 * @see ../../src/mocks/mock-l3.ts
 * @see ../../src/l3/service.ts
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { createMockL3, createSpyL3, createProgrammableL3 } from '../../src/mocks/mock-l3.js'
import type { Experience, FeedbackRecord } from '../../src/l3/experience.js'
import type { StackEntry } from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { createMockL2 } from '../../src/mocks/mock-l2.js'

describe('A0g: Mock L3（Experience 模型版）', () => {
  // ============== createMockL3 ==============
  describe('createMockL3', () => {
    test('返回的 service 有新接口的所有方法', () => {
      const service = createMockL3([])
      expect(typeof service.compile).toBe('function')
      expect(typeof service.getExperience).toBe('function')
      expect(typeof service.recordFeedback).toBe('function')
      expect(typeof service.listExperiences).toBe('function')
      expect(typeof service.recompile).toBe('function')
    })

    test('compile 返回预设 children', async () => {
      const children: StackEntry[] = [
        { kind: 'skip_n', id: 'x', parentIntentId: null, createdAt: 0, n: 1 }
      ]
      const service = createMockL3(children)
      const result = await service.compile(
        { type: 'test', params: {} },
        {} as any
      )
      // 值相等（真实 L3 每次 compile 返回新 entries）
      expect(result).toEqual(children)
    })

    test('getExperience 默认返回 null', () => {
      const service = createMockL3([])
      expect(service.getExperience('any_id')).toBeNull()
    })

    test('listExperiences 默认返回空数组', () => {
      const service = createMockL3([])
      expect(service.listExperiences()).toEqual([])
    })

    test('recordFeedback 是 no-op（不抛错）', async () => {
      const service = createMockL3([])
      await expect(
        service.recordFeedback('any_id', {
          timestamp: 0,
          feedback_type: 'other',
          target: 'x',
          suggestion: 'y'
        })
      ).resolves.not.toThrow()
    })
  })

  // ============== createSpyL3 ==============
  describe('createSpyL3', () => {
    test('追踪 compile 调用次数', async () => {
      const spy = createSpyL3([])
      expect(spy.callCount()).toBe(0)

      await spy.compile({ type: 't1', params: {} }, {} as any)
      expect(spy.callCount()).toBe(1)

      await spy.compile({ type: 't2', params: {} }, {} as any)
      expect(spy.callCount()).toBe(2)
    })

    test('记录最后一次 intent', async () => {
      const spy = createSpyL3([])
      await spy.compile({ type: 'first', params: {} }, {} as any)
      await spy.compile({ type: 'second', params: { x: 1 } }, {} as any)

      const last = spy.lastIntent()
      expect(last?.type).toBe('second')
      expect(last?.params.x).toBe(1)
    })

    test('追踪 recordFeedback 调用', async () => {
      const spy = createSpyL3([])
      await spy.recordFeedback('exp1', {
        timestamp: 100,
        feedback_type: 'precheck_added',
        target: 'p1',
        suggestion: 'add check'
      })
      await spy.recordFeedback('exp2', {
        timestamp: 200,
        feedback_type: 'conditional_added',
        target: 'c1',
        suggestion: 'add conditional'
      })

      const calls = spy.recordFeedbackCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0].id).toBe('exp1')
      expect(calls[0].feedback.feedback_type).toBe('precheck_added')
      expect(calls[1].id).toBe('exp2')
    })

    test('追踪 recompile 调用', async () => {
      const spy = createSpyL3([])
      const errorInfo = {
        failedOpName: 'file_read',
        failedOpId: 'op1',
        errorMessage: 'ENOENT'
      }

      await spy.recompile(
        { type: 'read_file_with_default', params: {} },
        {} as any,
        errorInfo
      )

      const calls = spy.recompileCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].errorInfo.errorMessage).toBe('ENOENT')
    })
  })

  // ============== createProgrammableL3 ==============
  describe('createProgrammableL3', () => {
    test('按 intent.type 路由 children', async () => {
      const l3 = createProgrammableL3()

      const children1: StackEntry[] = [
        { kind: 'skip_n', id: 'a', parentIntentId: null, createdAt: 0, n: 1 }
      ]
      const children2: StackEntry[] = [
        { kind: 'skip_n', id: 'b', parentIntentId: null, createdAt: 0, n: 2 }
      ]

      l3.setChildren('op1', children1)
      l3.setChildren('op2', children2)

      const r1 = await l3.compile({ type: 'op1', params: {} }, {} as any)
      const r2 = await l3.compile({ type: 'op2', params: {} }, {} as any)

      // 值相等（compile 返回新 entries 拷贝）
      expect(r1).toEqual(children1)
      expect(r2).toEqual(children2)
    })

    test('未注册的 type 返回空数组', async () => {
      const l3 = createProgrammableL3()
      const result = await l3.compile(
        { type: 'unregistered', params: {} },
        {} as any
      )
      expect(result).toEqual([])
    })

    test('registerExperience 后 getExperience 返回该经验', () => {
      const l3 = createProgrammableL3()
      const exp: Experience = {
        id: 'test_exp',
        description: '测试经验',
        inputs: {},
        outputs: {},
        target_op: {
          base_op: 'noop',
          default_path: 'normal',
          paths: [{ id: 'normal', description: '', steps: [] }]
        }
      }

      l3.registerExperience(exp)

      const retrieved = l3.getExperience('test_exp')
      expect(retrieved).toBe(exp)
    })

    test('getExperience 返回 null（未注册）', () => {
      const l3 = createProgrammableL3()
      expect(l3.getExperience('nonexistent')).toBeNull()
    })

    test('listExperiences 列出所有注册的经验', () => {
      const l3 = createProgrammableL3()
      const exp1: Experience = {
        id: 'exp1', description: 'E1', inputs: {}, outputs: {},
          target_op: { base_op: 'noop', default_path: 'normal', paths: [{ id: 'normal', description: '', steps: [] }] }
        }
      const exp2: Experience = {
        id: 'exp2', description: 'E2', inputs: {}, outputs: {},
          target_op: { base_op: 'noop', default_path: 'normal', paths: [{ id: 'normal', description: '', steps: [] }] }
        }

      l3.registerExperience(exp1)
      l3.registerExperience(exp2)

      const list = l3.listExperiences()
      expect(list).toHaveLength(2)
      expect(list.map(e => e.id).sort()).toEqual(['exp1', 'exp2'])
    })

    test('recompile 也使用 setChildren 路由', async () => {
      const l3 = createProgrammableL3()
      const fallbackChildren: StackEntry[] = [
        { kind: 'skip_n', id: 'fallback', parentIntentId: null, createdAt: 0, n: 1 }
      ]
      l3.setChildren('op1', fallbackChildren)

      const result = await l3.recompile(
        { type: 'op1', params: {} },
        {} as any,
        {
          failedOpName: 'file_read',
          failedOpId: 'op1',
          errorMessage: 'test'
        }
      )

      // 值相等（compile 返回新 entries 拷贝）
      expect(result).toEqual(fallbackChildren)
    })
  })

  // ============== 集成测试：与 ExecutionState 配合 ==============
  describe('与 ExecutionState 集成', () => {
    test('compile 接收 ExecutionState（不会破坏 typecheck）', async () => {
      const l2 = createMockL2()
      const state = createInitialState(l2.registry, createMockL3([]))
      const l3 = createMockL3([])

      // 这里只是验证类型兼容（编译期）
      // 运行时 mock L3 不使用 state（实际 L3 会用）
      const result = await l3.compile(
        { type: 'test', params: {} },
        state
      )
      expect(result).toEqual([])
    })
  })
})