/**
 * CRR P2/T-2.1 Experience.outputs_bindings schema 测试
 *
 * @see docs/mvp/19c-implementation-plan.md §三 T-2.1
 *
 * 契约:
 *  ① OutputBinding 接口字段完整 (register/type/persist/description)
 *  ② Experience.outputs_bindings 是 optional Record<string,OutputBinding>
 *  ③ persist 默认 false (opt-in 原则)
 *  ④ 类型安全: type 字段与 ParamSpec.type 同步 (六种 + 'any')
 *  ⑤ safe_write/read_file_with_default 默认不声明 (保持现状)
 *  ⑥ 加显式声明后能通过类型检查 (示例)
 */

import { describe, it, expect } from 'vitest'
import type { Experience, OutputBinding } from '../../src/l3/experience.js'
import { CORE_EXPERIENCES } from '../../src/l3/experience-library.js'

describe('CD1: outputs_bindings schema (T-2.1)', () => {
  describe('① OutputBinding 字段完整性', () => {
    it('register/type/persist/description 四字段都存在', () => {
      const binding: OutputBinding = {
        register: '$r_bytes',
        type: 'number',
        persist: true,
        description: '写入字节数'
      }
      expect(binding.register).toBe('$r_bytes')
      expect(binding.type).toBe('number')
      expect(binding.persist).toBe(true)
      expect(binding.description).toBe('写入字节数')
    })

    it('register 可以是 new path 形式 $S<scope>.out<k>', () => {
      const binding: OutputBinding = {
        register: '$Ss0.out4',
        type: 'number',
        persist: true
      }
      expect(binding.register).toMatch(/^\$S\w+\.out\d+$/)
    })

    it('register 可以是 global functional reg ($err/$path)', () => {
      const b1: OutputBinding = { register: '$err', type: 'object', persist: true }
      const b2: OutputBinding = { register: '$path', type: 'string', persist: true }
      expect(b1.register).toBe('$err')
      expect(b2.register).toBe('$path')
    })
  })

  describe('② Experience.outputs_bindings optional + Record', () => {
    it('未声明时字段 undefined (backward compat)', () => {
      const exp: Experience = {
        id: 'foo',
        description: 'test',
        inputs: {},
        outputs: {},
        target_op: { base_op: 'noop', default_path: 'normal', paths: [{ id: 'normal', steps: [] }] }
      }
      expect(exp.outputs_bindings).toBeUndefined()
    })

    it('声明后字段是 Record<key, OutputBinding>', () => {
      const exp: Experience = {
        id: 'foo',
        description: 'test',
        inputs: {},
        outputs: {
          bytes: { type: 'number', required: true }
        },
        outputs_bindings: {
          bytes: { register: '$r_bytes', type: 'number', persist: true }
        },
        target_op: { base_op: 'noop', default_path: 'normal', paths: [{ id: 'normal', steps: [] }] }
      }
      expect(exp.outputs_bindings).toBeDefined()
      expect(exp.outputs_bindings!.bytes.register).toBe('$r_bytes')
      expect(exp.outputs_bindings!.bytes.persist).toBe(true)
    })
  })

  describe('③ persist 默认 false (opt-in)', () => {
    it('未设 persist 应为 undefined (视为 false)', () => {
      const b: OutputBinding = { register: '$r_x', type: 'string' }
      expect(b.persist).toBeUndefined()
      expect(b.persist ?? false).toBe(false)
    })

    it('persist 显式 false 等价于不声明', () => {
      const b: OutputBinding = { register: '$r_x', type: 'string', persist: false }
      expect(b.persist).toBe(false)
    })
  })

  describe('④ type 字段六种 + any', () => {
    it('所有合法 type 值', () => {
      const types: OutputBinding['type'][] = ['string', 'number', 'boolean', 'path', 'object', 'any']
      for (const t of types) {
        const b: OutputBinding = { register: '$r_x', type: t, persist: true }
        expect(b.type).toBe(t)
      }
    })
  })

  describe('⑤ CORE 经验 outputs_bindings 声明覆盖 (P2/T-2.4)', () => {
    it('P2 末所有 CORE_EXPERIENCES 都已声明 outputs_bindings (PRIMARY_OUTPUT 表迁移完成)', () => {
      // T-2.4: pipeline.collect 去 PRIMARY_OUTPUT 硬编码后,
      // 所有 CORE 经验必须显式声明 outputs_bindings,否则 pipeline.primary=null
      const noBindings = CORE_EXPERIENCES.filter(e => !e.outputs_bindings)
      expect(noBindings).toEqual([])
    })
  })

  describe('⑥ 加显式声明示例 (safe_write / read_file_with_default)', () => {
    it('safe_write 声明 bytes_written + content', () => {
      // 模拟声明 —— 不修改原 experience-library,只验证 schema 接受
      const exp = CORE_EXPERIENCES.find(e => e.id === 'safe_write')!
      const augmented: Experience = {
        ...exp,
        outputs_bindings: {
          bytes_written: {
            register: '$r_bytes',
            type: 'number',
            persist: true,
            description: '写入字节数 (仅 success path)'
          }
        }
      }
      expect(augmented.outputs_bindings!.bytes_written.type).toBe('number')
      expect(augmented.outputs_bindings!.bytes_written.persist).toBe(true)
    })

    it('read_file_with_default 声明 content', () => {
      const exp = CORE_EXPERIENCES.find(e => e.id === 'read_file_with_default')!
      const augmented: Experience = {
        ...exp,
        outputs_bindings: {
          content: {
            register: '$r_content',
            type: 'string',
            persist: true,
            description: '文件内容 (或默认值)'
          }
        }
      }
      expect(augmented.outputs_bindings!.content.type).toBe('string')
      expect(augmented.outputs_bindings!.content.persist).toBe(true)
    })

    it('replace_in_file 已声明 count (T-2.4 迁移后)', () => {
      const exp = CORE_EXPERIENCES.find(e => e.id === 'replace_in_file')!
      expect(exp.outputs_bindings).toBeDefined()
      expect(exp.outputs_bindings!.count).toBeDefined()
      expect(exp.outputs_bindings!.count.persist).toBe(true)
    })

    it('persist:false 仍视为不持久化 (augmented override)', () => {
      const exp = CORE_EXPERIENCES.find(e => e.id === 'replace_in_file')!
      const augmented: Experience = {
        ...exp,
        outputs_bindings: {
          count: { register: '$r_count', type: 'number', persist: false }
        }
      }
      expect(augmented.outputs_bindings!.count.persist).toBe(false)
    })
  })
})