/**
 * Phase A Tier A0f - Experience 数据结构测试
 *
 * 验证（2026-08-20 新增）：
 * - Experience / PreProcessing / ConditionalJudgment / TargetOp 类型定义正确
 * - ParamRef 四种 kind 可用
 * - skip_threshold 0-100 范围约束
 * - FeedbackRecord 字段必填
 * - 编译选项 CompileOptions.skip_cost 可选
 *
 * @see ../../src/l3/experience.ts
 * @see ../../docs/mvp/12-experience-model.md
 */

import { describe, test, expect } from 'vitest'
import type {
  Experience,
  PreProcessing,
  ConditionalJudgment,
  TargetOp,
  ParamRef,
  FeedbackRecord,
  CompileOptions,
  OpStep
} from '../../src/l3/experience.js'
import type { RecognizedIntent } from '../../src/l1/types.js'

describe('A0f: Experience 数据结构（双区架构版）', () => {
  // ============== ParamRef 四种 kind ==============
  describe('ParamRef 四种来源', () => {
    test('literal: 字面量值', () => {
      const ref: ParamRef = { kind: 'literal', value: 'hello' }
      expect(ref.kind).toBe('literal')
      expect(ref.value).toBe('hello')
    })

    test('input: 来自 experience.inputs', () => {
      const ref: ParamRef = { kind: 'input', name: 'path' }
      expect(ref.kind).toBe('input')
      expect(ref.name).toBe('path')
    })

    test('register: 来自 internal 寄存器', () => {
      const ref: ParamRef = { kind: 'register', name: '$r0' }
      expect(ref.kind).toBe('register')
      expect(ref.name).toBe('$r0')
    })

    test('preprocessing: 来自前置处理输出', () => {
      const ref: ParamRef = {
        kind: 'preprocessing',
        preproc_id: 'check_exists',
        output: 'content'
      }
      expect(ref.kind).toBe('preprocessing')
      expect(ref.preproc_id).toBe('check_exists')
      expect(ref.output).toBe('content')
    })

    test('四种 kind 互斥', () => {
      const refs: ParamRef[] = [
        { kind: 'literal', value: 1 },
        { kind: 'input', name: 'x' },
        { kind: 'register', name: '$r0' },
        { kind: 'preprocessing', preproc_id: 'p', output: 'o' }
      ]
      const kinds = new Set(refs.map(r => r.kind))
      expect(kinds.size).toBe(4)
    })
  })

  // ============== PreProcessing ==============
  describe('PreProcessing（前置处理）', () => {
    test('基本字段：id/operation/inputs/outputs/skip_threshold', () => {
      const preproc: PreProcessing = {
        id: 'check_exists',
        operation: 'file_read',
        inputs: { path: { kind: 'input', name: 'path' } },
        outputs: { content: { kind: 'register', name: '$r_content' } },
        skip_threshold: 50
      }

      expect(preproc.id).toBe('check_exists')
      expect(preproc.operation).toBe('file_read')
      expect(preproc.skip_threshold).toBe(50)
    })

    test('skip_threshold 0 意味着必须执行', () => {
      const preproc: PreProcessing = {
        id: 'must_run',
        operation: 'glob_match',
        inputs: {},
        outputs: {},
        skip_threshold: 0
      }
      expect(preproc.skip_threshold).toBe(0)
    })

    test('skip_threshold 100 意味着永远可跳过', () => {
      const preproc: PreProcessing = {
        id: 'always_skip',
        operation: 'noop',
        inputs: {},
        outputs: {},
        skip_threshold: 100
      }
      expect(preproc.skip_threshold).toBe(100)
    })
  })

  // ============== ConditionalJudgment ==============
  describe('ConditionalJudgment（条件判断）', () => {
    test('基本字段：trigger/then_path/else_path', () => {
      const judgment: ConditionalJudgment = {
        id: 'check_error',
        trigger: {
          source: 'preprocessing',
          source_id: 'try_read',
          condition_op: 'is_truthy',
          compare_value: true
        },
        then_path: 'file_not_found',
        else_path: 'normal'
      }

      expect(judgment.then_path).toBe('file_not_found')
      expect(judgment.else_path).toBe('normal')
    })

    test('else_path 可选（默认 normal）', () => {
      const judgment: ConditionalJudgment = {
        id: 'j1',
        trigger: {
          source: 'input',
          source_id: 'strict',
          condition_op: 'equals',
          compare_value: true
        },
        then_path: 'strict_mode'
        // 没有 else_path
      }

      expect(judgment.else_path).toBeUndefined()
    })

    test('trigger 三种 source：preprocessing/input/register', () => {
      const sources: ('preprocessing' | 'input' | 'register')[] = [
        'preprocessing',
        'input',
        'register'
      ]

      for (const source of sources) {
        const j: ConditionalJudgment = {
          id: `j_${source}`,
          trigger: { source, source_id: 'x', condition_op: 'equals', compare_value: 0 },
          then_path: 'p'
        }
        expect(j.trigger.source).toBe(source)
      }
    })
  })

  // ============== TargetOp / TargetOpPath / OpStep ==============
  describe('TargetOp / TargetOpPath / OpStep', () => {
    test('基本 TargetOp：一个 base_op + 多路径', () => {
      const opStep: OpStep = {
        operation: 'file_write',
        inputs: { content: { kind: 'literal', value: 'default' } },
        outputs: { success: { kind: 'register', name: '$r_ok' } }
      }

      const target: TargetOp = {
        base_op: 'file_read',
        default_path: 'normal',
        paths: [
          {
            id: 'normal',
            description: '正常路径',
            steps: []
          },
          {
            id: 'file_not_found',
            description: '文件不存在',
            steps: [opStep]
          }
        ]
      }

      expect(target.base_op).toBe('file_read')
      expect(target.default_path).toBe('normal')
      expect(target.paths).toHaveLength(2)
    })

    test('OpStep operation 可指向另一个 Experience（嵌套调用）', () => {
      const step: OpStep = {
        operation: 'read_file_with_default',  // 另一个 Experience ID
        inputs: { path: { kind: 'register', name: '$r0' } },
        outputs: { content: { kind: 'register', name: '$r_content' } }
      }
      expect(step.operation).toBe('read_file_with_default')
    })
  })

  // ============== FeedbackRecord ==============
  describe('FeedbackRecord（反馈记录）', () => {
    test('4 种 feedback_type', () => {
      const types: FeedbackRecord['feedback_type'][] = [
        'precheck_added',
        'conditional_added',
        'path_added',
        'other'
      ]
      expect(types).toHaveLength(4)
    })

    test('基本字段', () => {
      const feedback: FeedbackRecord = {
        timestamp: Date.now(),
        feedback_type: 'precheck_added',
        target: 'target_op.ops[1]',
        suggestion: '添加 check_file_readable 前置检查',
        detail: { reason: '文件可能不可读' }
      }

      expect(feedback.timestamp).toBeGreaterThan(0)
      expect(feedback.feedback_type).toBe('precheck_added')
      expect(feedback.target).toBe('target_op.ops[1]')
    })
  })

  // ============== Experience ==============
  describe('Experience 完整定义', () => {
    test('最小 Experience（只有 target_op）', () => {
      const minimal: Experience = {
        id: 'simple_op',
        description: '简单操作',
        inputs: {},
        outputs: {},
        target_op: {
          base_op: 'noop',
          default_path: 'normal',
          paths: [{ id: 'normal', description: '', steps: [] }]
        }
      }

      expect(minimal.pre_processing).toBeUndefined()
      expect(minimal.conditional_judgment).toBeUndefined()
      expect(minimal.feedback_history).toBeUndefined()
    })

    test('完整 Experience（三段式 + 反馈）', () => {
      const full: Experience = {
        id: 'read_file_with_default',
        description: '读取文件，不存在则使用默认内容',

        inputs: {
          path: { type: 'path', required: true },
          default_content: { type: 'string', required: false }
        },
        outputs: {
          content: { type: 'string', required: true }
        },

        pre_processing: [
          {
            id: 'try_read',
            operation: 'file_read',
            inputs: { path: { kind: 'input', name: 'path' } },
            outputs: {
              content: { kind: 'register', name: '$r_content' },
              error: { kind: 'register', name: '$r_err' }
            },
            skip_threshold: 50
          }
        ],

        conditional_judgment: [
          {
            id: 'check_error',
            trigger: {
              source: 'preprocessing',
              source_id: 'try_read',
              condition_op: 'is_truthy',
              compare_value: true
            },
            then_path: 'file_not_found',
            else_path: 'normal'
          }
        ],

        target_op: {
          base_op: 'file_read',
          default_path: 'normal',
          paths: [
            {
              id: 'normal',
              description: '文件存在',
              steps: []
            },
            {
              id: 'file_not_found',
              description: '文件不存在',
              steps: [
                {
                  operation: 'move',
                  inputs: { source: { kind: 'input', name: 'default_content' } },
                  outputs: { content: { kind: 'register', name: '$r_content' } }
                }
              ]
            }
          ]
        },

        feedback_history: [
          {
            timestamp: 1234567890,
            feedback_type: 'precheck_added',
            target: 'pre_processing[0]',
            suggestion: '降低 skip_threshold 到 30',
            detail: { reason: '太多 false positive' }
          }
        ]
      }

      expect(full.pre_processing).toHaveLength(1)
      expect(full.conditional_judgment).toHaveLength(1)
      expect(full.target_op.paths).toHaveLength(2)
      expect(full.feedback_history).toHaveLength(1)
    })
  })

  // ============== CompileOptions ==============
  describe('CompileOptions（编译选项）', () => {
    test('skip_cost 可选（默认 0）', () => {
      const opts: CompileOptions = {}
      expect(opts.skip_cost).toBeUndefined()
    })

    test('skip_cost 显式值', () => {
      const opts: CompileOptions = { skip_cost: 80 }
      expect(opts.skip_cost).toBe(80)
    })

    test('skip_cost 0 = 不跳过任何前置', () => {
      const opts: CompileOptions = { skip_cost: 0 }
      expect(opts.skip_cost).toBe(0)
    })
  })

  // ============== RecognizedIntent ==============
  describe('RecognizedIntent（输入）', () => {
    test('type + params 必填', () => {
      const intent: RecognizedIntent = {
        type: 'read_file_with_default',
        params: { path: '/tmp/test.txt', default_content: '' }
      }

      expect(intent.type).toBe('read_file_with_default')
      expect(intent.params.path).toBe('/tmp/test.txt')
    })
  })
})