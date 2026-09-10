/**
 * L2 evaluate_collection operation（集合表达式求值）
 *
 * 与 evaluate_expr 对应,专门处理列表/集合类型数据的表达式求值。
 * 两者运算符集完全不重叠:
 * - evaluate_expr:标量运算(算术/比较/逻辑/位/字符串/对象/错误/空检查/类型)
 * - evaluate_collection:集合运算(排序/过滤/映射/分组/去重/切片/取前/聚合)
 *
 * 设计特点:
 * - **JSON AST(Lisp-style S-expression)**:无运算符优先级解析
 * - **管道语义**:pipe 节点支持多阶段链式处理,避免深层嵌套
 * - **字段名 + 字面量参数替代 lambda**:MVP 不实现 lambda,用字段名表达变换
 * - **多输出**:result(列表或聚合值)+ count + error
 * - **不修改原数组**:所有操作创建副本
 *
 * 支持的运算符(12 个):
 * - 排序:sort(items, field, desc?)
 * - 过滤:filter(items, field, value)
 * - 映射(字段提取):map(items, field)
 * - 取前:take(items, n)
 * - 切片:slice(items, start, end)
 * - 去重:unique(items, field?)
 * - 分组:group_by(items, field) → object
 * - 计数:count_by(items, field) → object
 * - 拼接:concat(list1, list2, ...)
 * - 长度:length(items) → number
 * - 包含:contains(items, value) → boolean
 * - 首元素:head(items) → value
 *
 * AST 节点:
 * - literal: 列表字面量
 * - var: 读寄存器(列表)
 * - op: 集合运算符调用
 * - pipe: 管道(source → stages[])
 *
 * @see ../../docs/mvp/06-execution-layer.md §7.2
 */

import type { Operation } from '../operation.js'
import type { ExecutionState } from '../../l1/execution-state.js'
import { createOperationError } from '../errors.js'
import type { Value } from '../../l1/types.js'

// ============== AST 类型 ==============

/**
 * 集合表达式 AST(JSON 树形)
 */
export type CollectionExpr =
  | { type: 'literal'; value: Value }
  | { type: 'var'; name: string }
  | { type: 'op'; name: CollectionOpName; args: CollectionExpr[] }
  | { type: 'pipe'; source: CollectionExpr; stages: CollectionStage[] }

/**
 * 管道阶段(每个阶段是一个 op 调用,args 是该 op 的参数,不含 items)
 */
export interface CollectionStage {
  op: CollectionOpName
  args: CollectionExpr[]
}

/**
 * 集合运算符名称
 */
export type CollectionOpName =
  | 'sort'        // sort(items, field, desc?) → list
  | 'filter'      // filter(items, field, value) → list
  | 'map'         // map(items, field) → list(字段提取)
  | 'take'        // take(items, n) → list
  | 'slice'       // slice(items, start, end) → list
  | 'unique'      // unique(items, field?) → list
  | 'group_by'    // group_by(items, field) → object
  | 'count_by'    // count_by(items, field) → object
  | 'concat'      // concat(list1, list2, ...) → list
  | 'length'      // length(items) → number
  | 'contains'    // contains(items, value) → boolean
  | 'head'        // head(items) → value
  | 'flatten'     // flatten(items) → list

// ============== 求值上下文 ==============

interface CollectionEvalContext {
  /** env 映射:表达式 var.name → internal 寄存器名 */
  env: Record<string, string>
  /** 当前 state(读 internalStore) */
  state: ExecutionState
}

// ============== 求值器 ==============

/**
 * 求值入口
 */
function evaluateCollection(expr: CollectionExpr, ctx: CollectionEvalContext): Value {
  switch (expr.type) {
    case 'literal':
      return expr.value

    case 'var':
      return readVar(expr.name, ctx)

    case 'op': {
      const args = expr.args.map(a => evaluateCollection(a, ctx))
      return evalCollectionOp(expr.name, args, ctx)
    }

    case 'pipe': {
      // 管道:source 的结果作为第一个 stage 的 items,逐阶段传递
      let current = evaluateCollection(expr.source, ctx)
      for (const stage of expr.stages) {
        const stageArgs = stage.args.map(a => evaluateCollection(a, ctx))
        // stage 的 args 不含 items,items 是管道前一级的输出
        current = evalCollectionOp(stage.op, [current, ...stageArgs], ctx)
      }
      return current
    }
  }
}

/**
 * 读 var 变量(从 internalStore 或 env 映射)
 */
function readVar(name: string, ctx: CollectionEvalContext): Value {
  const registerName = ctx.env[name] ?? name
  if (!ctx.state.internalStore.has(registerName)) {
    throw createOperationError(
      'VARIABLE_NOT_FOUND',
      `Variable '${name}' (register '${registerName}') not found`,
      'evaluate_collection'
    )
  }
  return ctx.state.internalStore.get(registerName)!
}

// ============== 运算符实现 ==============

function evalCollectionOp(op: CollectionOpName, args: Value[], _ctx: CollectionEvalContext): Value {
  switch (op) {
    case 'sort': return sortOp(args)
    case 'filter': return filterOp(args)
    case 'map': return mapOp(args)
    case 'take': return takeOp(args)
    case 'slice': return sliceOp(args)
    case 'unique': return uniqueOp(args)
    case 'group_by': return groupByOp(args)
    case 'count_by': return countByOp(args)
    case 'concat': return concatOp(args)
    case 'length': return lengthOp(args)
    case 'contains': return containsOp(args)
    case 'head': return headOp(args)
    case 'flatten': return flattenOp(args)
    default:
      throw createOperationError('INVALID_INPUT', `Unknown collection op: ${op}`, 'evaluate_collection')
  }
}

// ============== 排序 ==============

function sortOp(args: Value[]): Value[] {
  if (args.length < 2 || args.length > 3) {
    throw createOperationError('INVALID_INPUT', 'sort requires (items, field, desc?)', 'evaluate_collection')
  }
  const items = args[0]
  const field = args[1] as string
  const desc = (args[2] as boolean | undefined) ?? false

  if (!Array.isArray(items)) {
    throw createOperationError('INVALID_INPUT', 'sort items must be an array', 'evaluate_collection')
  }

  return [...items].sort((a, b) => {
    const av = (a as Record<string, unknown>)[field]
    const bv = (b as Record<string, unknown>)[field]
    let cmp = 0
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv
    } else if (typeof av === 'string' && typeof bv === 'string') {
      cmp = av < bv ? -1 : av > bv ? 1 : 0
    } else {
      cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0
    }
    return desc ? -cmp : cmp
  })
}

// ============== 过滤 ==============

function filterOp(args: Value[]): Value[] {
  if (args.length !== 3) {
    throw createOperationError('INVALID_INPUT', 'filter requires (items, field, value)', 'evaluate_collection')
  }
  const items = args[0]
  const field = args[1] as string
  const value = args[2]

  if (!Array.isArray(items)) {
    throw createOperationError('INVALID_INPUT', 'filter items must be an array', 'evaluate_collection')
  }

  return items.filter(item => (item as Record<string, unknown>)[field] === value)
}

// ============== 映射(字段提取) ==============

function mapOp(args: Value[]): Value[] {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', 'map requires (items, field)', 'evaluate_collection')
  }
  const items = args[0]
  const field = args[1] as string

  if (!Array.isArray(items)) {
    throw createOperationError('INVALID_INPUT', 'map items must be an array', 'evaluate_collection')
  }

  return items.map(item => ((item as Record<string, unknown>)[field] ?? null) as Value)
}

// ============== 取前 n 个 ==============

function takeOp(args: Value[]): Value[] {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', 'take requires (items, n)', 'evaluate_collection')
  }
  const items = args[0]
  const n = args[1] as number

  if (!Array.isArray(items)) {
    throw createOperationError('INVALID_INPUT', 'take items must be an array', 'evaluate_collection')
  }

  if (n <= 0) return []
  return items.slice(0, n)
}

// ============== 切片 ==============

function sliceOp(args: Value[]): Value[] {
  if (args.length !== 3) {
    throw createOperationError('INVALID_INPUT', 'slice requires (items, start, end)', 'evaluate_collection')
  }
  const items = args[0]
  const start = args[1] as number
  const end = args[2] as number

  if (!Array.isArray(items)) {
    throw createOperationError('INVALID_INPUT', 'slice items must be an array', 'evaluate_collection')
  }

  return items.slice(start, end)
}

// ============== 去重 ==============

function uniqueOp(args: Value[]): Value[] {
  if (args.length < 1 || args.length > 2) {
    throw createOperationError('INVALID_INPUT', 'unique requires (items, field?)', 'evaluate_collection')
  }
  const items = args[0]
  const field = args[1] as string | undefined

  if (!Array.isArray(items)) {
    throw createOperationError('INVALID_INPUT', 'unique items must be an array', 'evaluate_collection')
  }

  if (field === undefined) {
    // 整体去重
    const seen = new Set<unknown>()
    return items.filter(item => {
      const key = JSON.stringify(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  // 按字段去重
  const seen = new Set<unknown>()
  return items.filter(item => {
    const v = (item as Record<string, unknown>)[field]
    if (seen.has(v)) return false
    seen.add(v)
    return true
  })
}

// ============== 分组 ==============

function groupByOp(args: Value[]): Record<string, Value[]> {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', 'group_by requires (items, field)', 'evaluate_collection')
  }
  const items = args[0]
  const field = args[1] as string

  if (!Array.isArray(items)) {
    throw createOperationError('INVALID_INPUT', 'group_by items must be an array', 'evaluate_collection')
  }

  const result: Record<string, Value[]> = {}
  for (const item of items) {
    const key = String((item as Record<string, unknown>)[field] ?? 'null')
    if (!result[key]) result[key] = []
    result[key].push(item)
  }
  return result
}

// ============== 计数 ==============

function countByOp(args: Value[]): Record<string, number> {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', 'count_by requires (items, field)', 'evaluate_collection')
  }
  const items = args[0]
  const field = args[1] as string

  if (!Array.isArray(items)) {
    throw createOperationError('INVALID_INPUT', 'count_by items must be an array', 'evaluate_collection')
  }

  const result: Record<string, number> = {}
  for (const item of items) {
    const key = String((item as Record<string, unknown>)[field] ?? 'null')
    result[key] = (result[key] ?? 0) + 1
  }
  return result
}

// ============== 拼接 ==============

function concatOp(args: Value[]): Value[] {
  if (args.length === 0) return []
  const result: Value[] = []
  for (const a of args) {
    if (!Array.isArray(a)) {
      throw createOperationError('INVALID_INPUT', 'concat args must be arrays', 'evaluate_collection')
    }
    result.push(...a)
  }
  return result
}

// ============== 长度 ==============

function lengthOp(args: Value[]): number {
  if (args.length !== 1) {
    throw createOperationError('INVALID_INPUT', 'length requires 1 arg', 'evaluate_collection')
  }
  const v = args[0]
  if (Array.isArray(v)) return v.length
  if (typeof v === 'string') return v.length
  throw createOperationError('INVALID_INPUT', 'length requires array or string', 'evaluate_collection')
}

// ============== 包含 ==============

function containsOp(args: Value[]): boolean {
  if (args.length !== 2) {
    throw createOperationError('INVALID_INPUT', 'contains requires (items, value)', 'evaluate_collection')
  }
  const items = args[0]
  const value = args[1]
  if (!Array.isArray(items)) {
    throw createOperationError('INVALID_INPUT', 'contains items must be an array', 'evaluate_collection')
  }
  return items.some(v => v === value)
}

// ============== 首元素 ==============

function headOp(args: Value[]): Value {
  if (args.length !== 1) {
    throw createOperationError('INVALID_INPUT', 'head requires 1 arg', 'evaluate_collection')
  }
  const items = args[0]
  if (!Array.isArray(items)) {
    throw createOperationError('INVALID_INPUT', 'head requires array', 'evaluate_collection')
  }
  return items[0] ?? null
}

// ============== 展平 ==============

function flattenOp(args: Value[]): Value[] {
  if (args.length !== 1) {
    throw createOperationError('INVALID_INPUT', 'flatten requires 1 arg', 'evaluate_collection')
  }
  const items = args[0]
  if (!Array.isArray(items)) {
    throw createOperationError('INVALID_INPUT', 'flatten requires array', 'evaluate_collection')
  }
  const result: Value[] = []
  for (const item of items) {
    if (Array.isArray(item)) {
      result.push(...item)
    } else {
      result.push(item)
    }
  }
  return result
}

// ============== Operation ==============

export const evaluateCollectionOp: Operation = {
  name: 'evaluate_collection',
  description: '集合表达式求值(列表/集合数据处理)',

  formalSpec: {
    inputs: {
      expr: {
        businessName: 'expr',
        register: '$r0', slotIndex: 0,
        type: 'object',
        required: true,
        description: 'JSON 集合表达式树'
      },
      env: {
        businessName: 'env',
        register: '$r1', slotIndex: 1,
        type: 'object',
        required: false,
        description: '变量名 → internal 寄存器名映射(可选)'
      }
    },
    outputs: {
      result: {
        businessName: 'result',
        register: '$r2', slotIndex: 2,
        type: 'any',
        required: true,
        description: '求值结果(列表或聚合值)'
      },
      count: {
        businessName: 'count',
        register: '$r3', slotIndex: 3,
        type: 'number',
        required: true,
        description: '结果计数(列表长度或聚合项数)'
      },
      error: {
        businessName: 'error',
        register: '$r_err', slotIndex: 99,
        type: 'object',
        required: false,
        description: '错误信息'
      }
    }
  },

  execute: async (inputs: Record<string, Value>, state?: ExecutionState): Promise<Record<string, Value>> => {
    if (!state) {
      return {
        result: null,
        count: 0,
        error: createOperationError(
          'EXECUTION_ERROR',
          'evaluate_collection requires ExecutionState (state undefined)',
          'evaluate_collection'
        ) as unknown as Value
      }
    }

    const expr = inputs.expr as unknown as CollectionExpr
    const env = (inputs.env as Record<string, string> | undefined) ?? {}

    try {
      const ctx: CollectionEvalContext = { env, state }
      const result = evaluateCollection(expr, ctx)
      // count:列表长度或聚合对象键数
      let count: number
      if (Array.isArray(result)) {
        count = result.length
      } else if (result && typeof result === 'object') {
        count = Object.keys(result as object).length
      } else {
        count = 0
      }
      return { result, count, error: null }
    } catch (err) {
      if (err && typeof err === 'object' && 'op' in (err as object)) {
        return { result: null, count: 0, error: err as unknown as Value }
      }
      return {
        result: null,
        count: 0,
        error: createOperationError(
          'EXCEPTION',
          String((err as Error)?.message ?? err),
          'evaluate_collection'
        ) as unknown as Value
      }
    }
  }
}
