/**
 * L2 操作 API 路由
 *
 * 提供系统所有已注册 L2 操作的只读列表和详情。
 *
 * 端点:
 *   GET /api/ops           列表(名称 + 描述 + 形参摘要)
 *   GET /api/ops/:name     详情(完整 formalSpec)
 */

import type { FastifyInstance } from 'fastify'
import { L2Registry } from '../../../src/l2/registry.js'
import { fileReadOp } from '../../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../../src/l2/builtins/file-write.js'
import { shellExecOp } from '../../../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../../../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../../../src/l2/builtins/evaluate-expr.js'
import { evaluateCollectionOp } from '../../../src/l2/builtins/evaluate-collection.js'
import { incrementCounterOp } from '../../../src/l2/builtins/increment-counter.js'
import { decrementCounterOp } from '../../../src/l2/builtins/decrement-counter.js'
import type { FormalParam } from '../../../src/l2/operation.js'

// ============== 构建全局 L2 Registry ==============

function createL2Registry(): L2Registry {
  const registry = new L2Registry()
  registry.register(fileReadOp)
  registry.register(fileWriteOp)
  registry.register(shellExecOp)
  registry.register(globMatchOp)
  registry.register(grepSearchOp)
  registry.register(stringReplaceOp)
  registry.register(evaluateExprOp)
  registry.register(evaluateCollectionOp)
  registry.register(incrementCounterOp)
  registry.register(decrementCounterOp)
  return registry
}

// ============== 序列化辅助 ==============

interface ParamSummary {
  businessName: string
  type: string
  required: boolean
  description?: string
}

interface OpSummary {
  name: string
  description: string
  inputs: ParamSummary[]
  outputs: ParamSummary[]
}

interface OpDetail {
  name: string
  description: string
  inputs: Record<string, FormalParam>
  outputs: Record<string, FormalParam>
}

function toParamSummary(param: FormalParam): ParamSummary {
  return {
    businessName: param.businessName,
    type: param.type,
    required: param.required,
    description: param.description
  }
}

// ============== 路由注册 ==============

export async function registerOpRoutes(app: FastifyInstance): Promise<void> {
  const registry = createL2Registry()

  // ============== 列表 ==============

  app.get('/api/ops', async (_req, reply) => {
    const names = registry.list()
    const ops: OpSummary[] = names.map(name => {
      const op = registry.get(name)!
      return {
        name: op.name,
        description: op.description,
        inputs: Object.values(op.formalSpec.inputs).map(toParamSummary),
        outputs: Object.values(op.formalSpec.outputs).map(toParamSummary)
      }
    })
    return reply.send({ ops, total: ops.length })
  })

  // ============== 详情 ==============

  app.get<{ Params: { name: string } }>('/api/ops/:name', async (req, reply) => {
    const op = registry.get(req.params.name)
    if (!op) {
      return reply.code(404).send({ error: `操作 '${req.params.name}' 不存在` })
    }
    const detail: OpDetail = {
      name: op.name,
      description: op.description,
      inputs: op.formalSpec.inputs,
      outputs: op.formalSpec.outputs
    }
    return reply.send(detail)
  })
}
