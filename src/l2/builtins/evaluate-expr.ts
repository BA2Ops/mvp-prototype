/**
 * L2 evaluate_expr operation（表达式求值）
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2.1（2026-08-20 重构新增）
 * @see ../../docs/dev-log/2026-08-20-evaluate-expr-redesign.md
 *
 * 设计动机（2026-08-20 重构）：
 * - L1 完全不调用任何比较/逻辑/算术 op（仅 conditional_skip 读 truthy）
 * - B06 实现的 12 个独立条件 op（equals/gt/and/...）是错误的关注点切分
 * - 真实使用方是 L3 编译器
 * - 重构为单一 evaluate_expr op，接受 JSON 树形表达式递归求值
 *
 * 设计特点：
 * - **单一 op 替代 12 个原子 op**：DAG 长度 5-6 → 1
 * - **JSON AST（Lisp-style S-expression）**：无运算符优先级解析
 * - **短路语义**：and/or 第一参数决定时跳过后续评估
 * - **动态寄存器读取**：通过 var.name + env 映射读 internal 寄存器
 * - **MVP 不实现**：lambda / in / between
 *
 * 支持的操作符（10 类）：
 * - 算术（6）：+, -, *, /, %, neg
 * - 比较（6）：==, !=, >, <, >=, <=
 * - 逻辑（3）：and, or, not（短路）
 * - 位（8）：&, |, ^, ~, <<, >>, >>>, plus 复合
 * - 字符串（6）：length, slice, concat, regex_match, to_string, to_number
 * - 列表（8）：head, tail, length, map, filter, reduce, concat, contains
 * - 对象（5）：get, has, keys, values, merge
 * - 错误（3）：error_code, error_message, is_error（替代旧 extract_error_code）
 * - 空检查（3）：is_null, is_empty, is_truthy
 * - 类型（1）：typeof
 *
 * 测试：tests/phase-b/tier-b07-evaluate-expr.test.ts
 */

import type { Operation } from '../operation.js'
import type { ExecutionState } from '../../l1/execution-state.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

// ============== AST 类型 ==============

/**
 * 表达式 AST（JSON 树形）
 */
export type Expr =
  | { type: 'literal'; value: Value }
  | { type: 'var'; name: string }
  | { type: 'op'; name: OpName; args: Expr[] }
  | { type: 'if'; cond: Expr; then: Expr; else: Expr }

/**
 * 操作符名称
 */
export type OpName =
  // 算术
  | '+' | '-' | '*' | '/' | '%' | 'neg'
  // 比较
  | '==' | '!=' | '>' | '<' | '>=' | '<=' | 'gte' | 'lte'
  // 逻辑
  | 'and' | 'or' | 'not'
  // 位运算
  | '&' | '|' | '^' | '~' | '<<' | '>>' | '>>>'
  // 字符串
  | 'length' | 'slice' | 'concat' | 'regex_match' | 'to_string' | 'to_number'
  // 列表
  | 'head' | 'tail' | 'map' | 'filter' | 'reduce' | 'contains'
  // 对象
  | 'get' | 'has' | 'keys' | 'values' | 'merge'
  // 错误
  | 'error_code' | 'error_message' | 'is_error'
  // 空检查
  | 'is_null' | 'is_empty' | 'is_truthy'
  // 类型
  | 'typeof'

// ============== 求值器 ==============

/**
 * 求值上下文
 */
interface EvalContext {
  /** env 映射：表达式 var.name → internal 寄存器名 */
  env: Record<string, string>
  /** 当前 state（读 internalStore） */
  state: ExecutionState
}

/**
 * 求值入口
 */
function evaluate(expr: Expr, ctx: EvalContext): Value {
  switch (expr.type) {
    case 'literal':
      return expr.value

    case 'var':
      return readVar(expr.name, ctx)

    case 'op': {
      // and/or 短路
      if (expr.name === 'and') return evalAnd(expr.args, ctx)
      if (expr.name === 'or') return evalOr(expr.args, ctx)

      // 单元操作符（~ not neg）
      if (expr.name === '~' || expr.name === 'not' || expr.name === 'neg') {
        if (expr.args.length !== 1) {
          throw createOperationError(
            'INVALID_INPUT',
            `${expr.name} requires 1 arg, got ${expr.args.length}`,
            'evaluate_expr'
          )
        }
        return evalUnaryOp(expr.name, evaluate(expr.args[0], ctx), ctx)
      }

      // 多元操作符
      const args = expr.args.map(a => evaluate(a, ctx))
      return evalMultiOp(expr.name, args, ctx)
    }

    case 'if':
      return evaluate(expr.cond, ctx) ? evaluate(expr.then, ctx) : evaluate(expr.else, ctx)
  }
}

/**
 * 读 var 变量（从 internalStore 或 env 映射）
 */
function readVar(name: string, ctx: EvalContext): Value {
  const registerName = ctx.env[name] ?? name
  if (!ctx.state.internalStore.has(registerName)) {
    throw createOperationError(
      'VARIABLE_NOT_FOUND',
      `Variable '${name}' (register '${registerName}') not found`,
      'evaluate_expr'
    )
  }
  return ctx.state.internalStore.get(registerName)!
}

// ============== 短路语义 ==============

function evalAnd(args: Expr[], ctx: EvalContext): Value {
  for (const arg of args) {
    const v = evaluate(arg, ctx)
    if (!v) return false
  }
  return args.length > 0
}

function evalOr(args: Expr[], ctx: EvalContext): Value {
  for (const arg of args) {
    const v = evaluate(arg, ctx)
    if (v) return true
  }
  return false
}

// ============== 单元操作符 ==============

function evalUnaryOp(op: OpName, v: Value, _ctx: EvalContext): Value {
  switch (op) {
    case '~': {
      if (typeof v !== 'number') {
        throw createOperationError('INVALID_INPUT', `~ requires number, got ${typeof v}`, 'evaluate_expr')
      }
      return ~v
    }
    case 'not':
      return !v
    case 'neg': {
      if (typeof v !== 'number') {
        throw createOperationError('INVALID_INPUT', `neg requires number, got ${typeof v}`, 'evaluate_expr')
      }
      return -v
    }
    default:
      throw createOperationError('INVALID_INPUT', `Unknown unary op: ${op}`, 'evaluate_expr')
  }
}

// ============== 多元操作符 ==============

function evalMultiOp(op: OpName, args: Value[], _ctx: EvalContext): Value {
  // 算术
  if (op === '+') return arithmeticPlus(args)
  if (op === '-') return arithmeticBinary(args, (a, b) => a - b, '-')
  if (op === '*') return arithmeticBinary(args, (a, b) => a * b, '*')
  if (op === '/') {
    if (args.length !== 2 || args[1] === 0) {
      throw createOperationError('DIVIDE_BY_ZERO', 'Division by zero', 'evaluate_expr')
    }
    return arithmeticBinary(args, (a, b) => a / b, '/')
  }
  if (op === '%') {
    if (args.length !== 2 || args[1] === 0) {
      throw createOperationError('DIVIDE_BY_ZERO', 'Modulo by zero', 'evaluate_expr')
    }
    return arithmeticBinary(args, (a, b) => a % b, '%')
  }

  // 比较（严格）
  if (op === '==') return args.length === 2 && args[0] === args[1]
  if (op === '!=') return !(args.length === 2 && args[0] === args[1])
  if (op === '>') return compareBinary(args, (a, b) => a > b, '>')
  if (op === '<') return compareBinary(args, (a, b) => a < b, '<')
  if (op === '>=') return compareBinary(args, (a, b) => a >= b, '>=')
  if (op === '<=') return compareBinary(args, (a, b) => a <= b, '<=')
  if (op === 'gte') return compareBinary(args, (a, b) => a >= b, 'gte')
  if (op === 'lte') return compareBinary(args, (a, b) => a <= b, 'lte')

  // 位运算
  if (op === '&') return bitBinary(args, (a, b) => a & b, '&')
  if (op === '|') return bitBinary(args, (a, b) => a | b, '|')
  if (op === '^') return bitBinary(args, (a, b) => a ^ b, '^')
  if (op === '<<') return bitBinary(args, (a, b) => a << b, '<<')
  if (op === '>>') return bitBinary(args, (a, b) => a >> b, '>>')
  if (op === '>>>') return bitBinary(args, (a, b) => a >>> b, '>>>')

  // 字符串
  if (op === 'length') return stringOrListLength(args)
  if (op === 'slice') return sliceOp(args)
  if (op === 'concat') return concatOp(args)
  if (op === 'regex_match') return regexMatch(args)
  if (op === 'to_string') return String(args[0])
  if (op === 'to_number') return toNumberOp(args)

  // 列表
  if (op === 'head') return headOp(args)
  if (op === 'tail') return tailOp(args)
  if (op === 'map') return mapOp(args)
  if (op === 'filter') return filterOp(args)
  if (op === 'reduce') return reduceOp(args)
  if (op === 'contains') return containsOp(args)

  // 对象
  if (op === 'get') return getOp(args)
  if (op === 'has') return hasOp(args)
  if (op === 'keys') return keysOp(args)
  if (op === 'values') return valuesOp(args)
  if (op === 'merge') return mergeOp(args)

  // 错误
  if (op === 'error_code') return errorCodeOp(args)
  if (op === 'error_message') return errorMessageOp(args)
  if (op === 'is_error') return isErrorOp(args)

  // 空检查
  if (op === 'is_null') return args[0] === null || args[0] === undefined
  if (op === 'is_empty') return isEmptyOp(args)
  if (op === 'is_truthy') return Boolean(args[0])

  // 类型
  if (op === 'typeof') return typeofValue(args[0])

  throw createOperationError('INVALID_INPUT', `Unknown op: ${op}`, 'evaluate_expr')
}

// ============== 算术辅助 ==============

function arithmeticPlus(args: Value[]): Value {
  if (args.length === 0) {
    throw createOperationError('INVALID_INPUT', '+ requires at least 1 arg', 'evaluate_expr')
  }
  // 字符串拼接
  if (typeof args[0] === 'string') {
    return args.map(String).join('')
  }
  // 数组拼接
  if (Array.isArray(args[0])) {
    const result: Value[] = []
    for (const a of args) {
      if (!Array.isArray(a)) {
        throw createOperationError('INVALID_INPUT', 'Cannot mix array with non-array in +', 'evaluate_expr')
      }
      result.push(...(a as Value[]))
    }
    return result
  }
  // 数字加法
  let sum = 0
  for (const a of args) {
    if (typeof a !== 'number') {
      throw createOperationError('INVALID_INPUT', '+ requires number/string/array', 'evaluate_expr')
    }
    sum += a
  }
  return sum
}

function arithmeticBinary(args: Value[], fn: (a: number, b: number) => number, op: string): number {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', `${op} requires 2 args, got ${args.length}`, 'evaluate_expr')
  }
  if (typeof args[0] !== 'number' || typeof args[1] !== 'number') {
    throw createOperationError('INVALID_INPUT', `${op} requires numbers`, 'evaluate_expr')
  }
  return fn(args[0] as number, args[1] as number)
}

function compareBinary(args: Value[], fn: (a: any, b: any) => boolean, op: string): boolean {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', `${op} requires 2 args`, 'evaluate_expr')
  }
  const [a, b] = args
  if (typeof a === 'number' && typeof b === 'number') return fn(a, b)
  if (typeof a === 'string' && typeof b === 'string') return fn(a, b)
  throw createOperationError('INVALID_INPUT', `${op} requires same-type (number/string)`, 'evaluate_expr')
}

function bitBinary(args: Value[], fn: (a: number, b: number) => number, op: string): number {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', `${op} requires 2 args`, 'evaluate_expr')
  }
  if (typeof args[0] !== 'number' || typeof args[1] !== 'number') {
    throw createOperationError('INVALID_INPUT', `${op} requires numbers`, 'evaluate_expr')
  }
  // 32 位整数运算
  return fn(args[0] as number | 0, args[1] as number | 0)
}

// ============== 字符串/列表操作 ==============

function stringOrListLength(args: Value[]): number {
  if (args.length !== 1) {
    throw createOperationError('INVALID_INPUT', 'length requires 1 arg', 'evaluate_expr')
  }
  const v = args[0]
  if (typeof v === 'string') return v.length
  if (Array.isArray(v)) return v.length
  if (v && typeof v === 'object') return Object.keys(v as object).length
  throw createOperationError('INVALID_INPUT', 'length requires string/list/object', 'evaluate_expr')
}

function sliceOp(args: Value[]): string {
  if (args.length !== 3) {
    throw createOperationError('INVALID_INPUT', 'slice requires (str, start, end)', 'evaluate_expr')
  }
  const [s, start, end] = args
  if (typeof s !== 'string' || typeof start !== 'number' || typeof end !== 'number') {
    throw createOperationError('INVALID_INPUT', 'slice args must be (string, number, number)', 'evaluate_expr')
  }
  return s.slice(start, end)
}

function concatOp(args: Value[]): Value {
  // concat 接受混合：字符串或列表
  if (args.length === 0) return ''
  if (typeof args[0] === 'string') {
    return args.map(String).join('')
  }
  if (Array.isArray(args[0])) {
    const result: Value[] = []
    for (const a of args) {
      if (!Array.isArray(a)) {
        throw createOperationError('INVALID_INPUT', 'concat: cannot mix list with non-list', 'evaluate_expr')
      }
      result.push(...(a as Value[]))
    }
    return result
  }
  throw createOperationError('INVALID_INPUT', 'concat requires strings or lists', 'evaluate_expr')
}

function regexMatch(args: Value[]): boolean {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', 'regex_match requires (str, pattern)', 'evaluate_expr')
  }
  const [s, pattern] = args
  if (typeof s !== 'string' || typeof pattern !== 'string') {
    throw createOperationError('INVALID_INPUT', 'regex_match args must be strings', 'evaluate_expr')
  }
  try {
    return new RegExp(pattern).test(s)
  } catch (e) {
    throw createOperationError('INVALID_REGEX', String((e as Error).message), 'evaluate_expr')
  }
}

function toNumberOp(args: Value[]): number {
  if (args.length !== 1) {
    throw createOperationError('INVALID_INPUT', 'to_number requires 1 arg', 'evaluate_expr')
  }
  const n = Number(args[0])
  if (Number.isNaN(n)) {
    throw createOperationError('INVALID_INPUT', `Cannot convert to number: ${String(args[0])}`, 'evaluate_expr')
  }
  return n
}

// ============== 列表操作 ==============

function headOp(args: Value[]): Value {
  if (args.length !== 1 || !Array.isArray(args[0])) {
    throw createOperationError('INVALID_INPUT', 'head requires list', 'evaluate_expr')
  }
  return (args[0] as Value[])[0] ?? null
}

function tailOp(args: Value[]): Value[] {
  if (args.length !== 1 || !Array.isArray(args[0])) {
    throw createOperationError('INVALID_INPUT', 'tail requires list', 'evaluate_expr')
  }
  return (args[0] as Value[]).slice(1)
}

function mapOp(args: Value[]): Value[] {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', 'map requires (list, items, fn)', 'evaluate_expr')
  }
  // 注意：fn 是 Expr，不能在 evaluate 阶段求值
  // MVP 简化：map 不支持内联 fn（需要在 L3 编译时展开）
  // 这里只支持"提取字段"模式：map(list, 'fieldName')
  throw createOperationError('UNSUPPORTED', 'map with fn requires L3 compiler expansion (MVP)', 'evaluate_expr')
}

function filterOp(args: Value[]): Value[] {
  // 同 map，filter 也需要 L3 编译器展开
  throw createOperationError('UNSUPPORTED', 'filter requires L3 compiler expansion (MVP)', 'evaluate_expr')
}

function reduceOp(args: Value[]): Value {
  throw createOperationError('UNSUPPORTED', 'reduce requires L3 compiler expansion (MVP)', 'evaluate_expr')
}

function containsOp(args: Value[]): boolean {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', 'contains requires (list, value)', 'evaluate_expr')
  }
  const [list, value] = args
  if (!Array.isArray(list)) {
    throw createOperationError('INVALID_INPUT', 'contains 1st arg must be list', 'evaluate_expr')
  }
  return (list as Value[]).some(v => v === value)
}

// ============== 对象操作 ==============

function getOp(args: Value[]): Value {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', 'get requires (obj, key)', 'evaluate_expr')
  }
  const [obj, key] = args
  if (!obj || typeof obj !== 'object') {
    throw createOperationError('INVALID_INPUT', 'get 1st arg must be object', 'evaluate_expr')
  }
  if (typeof key !== 'string' && typeof key !== 'number') {
    throw createOperationError('INVALID_INPUT', 'get key must be string/number', 'evaluate_expr')
  }
  return ((obj as Record<string, unknown>)[key as string] ?? null) as Value
}

function hasOp(args: Value[]): boolean {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', 'has requires (obj, key)', 'evaluate_expr')
  }
  const [obj, key] = args
  if (!obj || typeof obj !== 'object') {
    throw createOperationError('INVALID_INPUT', 'has 1st arg must be object', 'evaluate_expr')
  }
  if (typeof key !== 'string' && typeof key !== 'number') {
    throw createOperationError('INVALID_INPUT', 'has key must be string/number', 'evaluate_expr')
  }
  return Object.prototype.hasOwnProperty.call(obj, key as string)
}

function keysOp(args: Value[]): string[] {
  if (args.length !== 1 || !args[0] || typeof args[0] !== 'object') {
    throw createOperationError('INVALID_INPUT', 'keys requires object', 'evaluate_expr')
  }
  return Object.keys(args[0] as object)
}

function valuesOp(args: Value[]): Value[] {
  if (args.length !== 1 || !args[0] || typeof args[0] !== 'object') {
    throw createOperationError('INVALID_INPUT', 'values requires object', 'evaluate_expr')
  }
  return Object.values(args[0] as object)
}

function mergeOp(args: Value[]): Value {
  if (args.length !== 2 || !args[0] || !args[1] || typeof args[0] !== 'object' || typeof args[1] !== 'object') {
    throw createOperationError('INVALID_INPUT', 'merge requires (obj1, obj2)', 'evaluate_expr')
  }
  return { ...(args[0] as object), ...(args[1] as object) }
}

// ============== 错误操作 ==============

function errorCodeOp(args: Value[]): string | null {
  if (args.length !== 1) {
    throw createOperationError('INVALID_INPUT', 'error_code requires 1 arg', 'evaluate_expr')
  }
  const err = args[0]
  if (err === null || err === undefined) return null
  if (typeof err === 'object' && 'code' in (err as object)) {
    const code = (err as { code: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}

function errorMessageOp(args: Value[]): string | null {
  if (args.length !== 1) {
    throw createOperationError('INVALID_INPUT', 'error_message requires 1 arg', 'evaluate_expr')
  }
  const err = args[0]
  if (err === null || err === undefined) return null
  if (typeof err === 'object' && 'message' in (err as object)) {
    const msg = (err as { message: unknown }).message
    return typeof msg === 'string' ? msg : null
  }
  return null
}

function isErrorOp(args: Value[]): boolean {
  if (args.length !== 1) {
    throw createOperationError('INVALID_INPUT', 'is_error requires 1 arg', 'evaluate_expr')
  }
  const v = args[0]
  if (!v || typeof v !== 'object') return false
  return 'code' in (v as object) && 'message' in (v as object) && 'op' in (v as object)
}

// ============== 空检查 ==============

function isEmptyOp(args: Value[]): boolean {
  /* v8 ignore next 3 -- 防御代码：参数数量错误在求值器外层已校验 */
  if (args.length !== 1) {
    throw createOperationError('INVALID_INPUT', 'is_empty requires 1 arg', 'evaluate_expr')
  }
  const v = args[0]
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.length === 0
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

function typeofValue(v: Value): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

// ============== Operation ==============

export const evaluateExprOp: Operation = {
  name: 'evaluate_expr',
  description: 'JSON 树形表达式求值（替代 12 个独立条件 op）',

  formalSpec: {
    inputs: {
      expr: {
        businessName: 'expr',
        register: '$r0',
        type: 'object',
        required: true,
        description: 'JSON 表达式树'
      },
      env: {
        businessName: 'env',
        register: '$r1',
        type: 'object',
        required: false,
        description: '变量名 → internal 寄存器名映射（可选）'
      }
    },
    outputs: {
      result: {
        businessName: 'result',
        register: '$r2',
        type: 'any',
        required: true,
        description: '求值结果'
      },
      error: {
        businessName: 'error',
        register: '$r_err',
        type: 'object',
        required: false,
        description: '错误信息'
      }
    }
  },

  execute: async (inputs: Record<string, Value>, state?: ExecutionState): Promise<Record<string, Value>> => {
    if (!state) {
      /* v8 ignore next 7 -- 防御代码：execute_op 总传 state，此分支不可达 */
      return {
        result: null,
        error: createOperationError(
          'EXECUTION_ERROR',
          'evaluate_expr requires ExecutionState (state undefined)',
          'evaluate_expr'
        ) as unknown as Value
      }
    }

    const expr = inputs.expr as unknown as Expr
    const env = (inputs.env as Record<string, string> | undefined) ?? {}

    try {
      const ctx: EvalContext = { env, state }
      const result = evaluate(expr, ctx)
      return { result, error: null }
    } catch (err) {
      if (err && typeof err === 'object' && 'op' in (err as object)) {
        // 已是 OperationError
        return { result: null, error: err as unknown as Value }
      }
      /* v8 ignore next 6 -- 防御代码：已知错误都包装为 OperationError；非 Error 值为运行时不可达 */
      return {
        result: null,
        error: createOperationError(
          'EXCEPTION',
          String((err as Error)?.message ?? err),
          'evaluate_expr'
        ) as unknown as Value
      }
    }
  }
}