/**
 * Phase A Tier A1b - FormalParam 元数据测试
 *
 * 验证：
 * 1. FormalParam 必填字段（register 必选）
 * 2. OperationFormalSpec 结构
 * 3. L2 Operation 必须包含 formalSpec
 * 4. helper 函数：getFormalParam / getInputRegisters / getOutputRegisters / getErrorFormalParam
 */

import { describe, test, expect } from 'vitest'
import {
  getFormalParam,
  getInputRegisters,
  getOutputRegisters,
  getErrorFormalParam
} from '../../src/l2/operation.js'
import { createMockL2 } from '../../src/mocks/mock-l2.js'

describe('A1b: FormalParam 元数据', () => {
  // ============== FormalParam 必填字段 ==============
  describe('FormalParam 字段必填', () => {
    test('缺失 register 字段编译错误（TS 强制）', () => {
      // TypeScript 编译时会报错，这里通过类型检查确认
      // 编译期保证：FormalParam.register 是必选字段
      // 运行时层面：所有创建 FormalParam 必须提供 register

      // 通过 mock L2 验证：所有 FormalParam 都有 register
      const { ops: l2Ops } = createMockL2()

      const inputs = l2Ops.mock_op.formalSpec.inputs
      const outputs = l2Ops.mock_op.formalSpec.outputs

      expect(inputs.x.register).toBe('$r0')
      expect(outputs.result.register).toBe('$r1')
    })

    test('businessName 与 register 对应', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.mock_op.formalSpec

      expect(spec.inputs.x.businessName).toBe('x')
      expect(spec.inputs.x.register).toBe('$r0')

      expect(spec.outputs.result.businessName).toBe('result')
      expect(spec.outputs.result.register).toBe('$r1')
    })

    test('type 字段反映参数类型', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.mock_op.formalSpec

      expect(spec.inputs.x.type).toBe('number')
      expect(spec.outputs.result.type).toBe('number')
    })

    test('required 字段标识必填', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.mock_op.formalSpec

      expect(spec.inputs.x.required).toBe(true)
      expect(spec.outputs.result.required).toBe(true)
    })
  })

  // ============== OperationFormalSpec 结构 ==============
  describe('OperationFormalSpec 结构', () => {
    test('inputs 和 outputs 都是 Record<string, FormalParam>', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.mock_op.formalSpec

      expect(spec.inputs).toBeDefined()
      expect(spec.outputs).toBeDefined()
      expect(typeof spec.inputs).toBe('object')
      expect(typeof spec.outputs).toBe('object')
    })

    test('key 是 businessName', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.mock_op.formalSpec

      expect(Object.keys(spec.inputs)).toContain('x')
      expect(Object.keys(spec.outputs)).toContain('result')
    })

    test('空形参的 op（throwing_op）', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.throwing_op.formalSpec

      expect(spec.inputs).toEqual({})
      expect(spec.outputs).toEqual({})
    })
  })

  // ============== Helper 函数 ==============
  describe('Operation 元数据 helper 函数', () => {
    test('getFormalParam: inputs 查找', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.mock_op.formalSpec

      const param = getFormalParam(spec, 'inputs', 'x')

      expect(param).toBeDefined()
      expect(param!.businessName).toBe('x')
      expect(param!.register).toBe('$r0')
    })

    test('getFormalParam: outputs 查找', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.mock_op.formalSpec

      const param = getFormalParam(spec, 'outputs', 'result')

      expect(param).toBeDefined()
      expect(param!.register).toBe('$r1')
    })

    test('getFormalParam: 不存在的 businessName 返回 undefined', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.mock_op.formalSpec

      expect(getFormalParam(spec, 'inputs', 'missing')).toBeUndefined()
    })

    test('getInputRegisters: 列出所有输入寄存器名', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.mock_op.formalSpec

      const regs = getInputRegisters(spec)

      expect(regs).toEqual(['$r0'])
    })

    test('getOutputRegisters: 列出所有输出寄存器名', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.mock_op.formalSpec

      const regs = getOutputRegisters(spec)

      expect(regs).toEqual(['$r1'])
    })

    test('getErrorFormalParam: 查找 $r_err 输出', () => {
      const { ops: l2Ops } = createMockL2()
      const spec = l2Ops.mock_op.formalSpec

      // mock_op 没有 error 输出
      expect(getErrorFormalParam(spec)).toBeUndefined()
    })
  })
})