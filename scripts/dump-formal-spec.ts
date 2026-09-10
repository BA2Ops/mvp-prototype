/**
 * CRR P0 / T-0.1: L2Registry formalSpec dump
 *
 * 用途:作为 doc 19 P0 checklist ②/⑤ 的客观证据。
 * 运行:npx tsx scripts/dump-formal-spec.ts (或 via node --import tsx)
 *
 * 输出格式:
 *   op_name | in_count | in_registers | out_count | out_registers | has_error_alias
 *
 * 验收:
 *   - M_max=4 是否覆盖所有 op 的 inputs 计数?
 *   - P_max=3 是否覆盖所有 op 的 outputs 计数(排除 error alias 后)?
 *   - shell_exec 的 output slots 是否需要拆分(stdout/stderr/exit_code vs $r_err)?
 *   - 是否需要 U_max≈76 估算值调整?
 */

import { L2Registry } from '../src/l2/registry.js'
import { fileReadOp } from '../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../src/l2/builtins/file-write.js'
import { globMatchOp } from '../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../src/l2/builtins/grep-search.js'
import { shellExecOp } from '../src/l2/builtins/shell-exec.js'
import { stringReplaceOp } from '../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../src/l2/builtins/evaluate-expr.js'
import { evaluateCollectionOp } from '../src/l2/builtins/evaluate-collection.js'
import { incrementCounterOp } from '../src/l2/builtins/increment-counter.js'
import { decrementCounterOp } from '../src/l2/builtins/decrement-counter.js'
import { sortByOp } from '../src/l2/builtins/sort-by.js'
import { takeFirstOp } from '../src/l2/builtins/take-first.js'

const registry = new L2Registry()
registry.register(fileReadOp)
registry.register(fileWriteOp)
registry.register(globMatchOp)
registry.register(grepSearchOp)
registry.register(shellExecOp)
registry.register(stringReplaceOp)
registry.register(evaluateExprOp)
registry.register(evaluateCollectionOp)
registry.register(incrementCounterOp)
registry.register(decrementCounterOp)
registry.register(sortByOp)
registry.register(takeFirstOp)

interface Row {
  name: string
  inCount: number
  inRegs: string[]
  inBizNames: string[]
  outCount: number
  outRegs: string[]
  outBizNames: string[]
  hasErrorAlias: boolean
  errorRegister: string | null
}

const rows: Row[] = registry.list().map(name => {
  const op = registry.get(name)!
  const inRegs = Object.values(op.formalSpec.inputs).map(p => p.register)
  const inBizNames = Object.keys(op.formalSpec.inputs)
  const outRegs = Object.values(op.formalSpec.outputs).map(p => p.register)
  const outBizNames = Object.keys(op.formalSpec.outputs)
  const errParam = Object.values(op.formalSpec.outputs).find(p => p.register === '$r_err')
  return {
    name,
    inCount: inRegs.length,
    inRegs,
    inBizNames,
    outCount: outRegs.length,
    outRegs,
    outBizNames,
    hasErrorAlias: !!errParam,
    errorRegister: errParam?.register ?? null
  }
})

// 计算最大值（用于 U_max 核算口径的客观依据）
const maxInCount = Math.max(...rows.map(r => r.inCount))
const maxOutCount = Math.max(...rows.map(r => r.outCount))
const maxOutCountExclError = Math.max(
  ...rows.map(r => r.outCount - (r.hasErrorAlias ? 1 : 0))
)

// 表格输出
console.log('='.repeat(110))
console.log('L2Registry formalSpec Dump — CRR P0/T-0.1')
console.log('='.repeat(110))
console.log(
  'op'.padEnd(20),
  '|in#'.padEnd(4),
  'in_regs'.padEnd(20),
  'in_biz'.padEnd(30),
  '|out#'.padEnd(5),
  'out_regs'.padEnd(20),
  'out_biz'.padEnd(30),
  'err?'.padEnd(5)
)
console.log('-'.repeat(110))
for (const r of rows) {
  console.log(
    r.name.padEnd(20),
    '|' + String(r.inCount).padEnd(3),
    r.inRegs.join(',').padEnd(20),
    r.inBizNames.join(',').padEnd(30),
    '|' + String(r.outCount).padEnd(4),
    r.outRegs.join(',').padEnd(20),
    r.outBizNames.join(',').padEnd(30),
    (r.hasErrorAlias ? 'Y' : 'N').padEnd(5)
  )
}
console.log('-'.repeat(110))
console.log('')
console.log('STATS:')
console.log(`  max_in_count                = ${maxInCount}    → M_max must be ≥ ${maxInCount}`)
console.log(`  max_out_count               = ${maxOutCount}    (includes error alias if any)`)
console.log(`  max_out_count_excl_error    = ${maxOutCountExclError}    → P_max must be ≥ ${maxOutCountExclError}`)
console.log('')
console.log('CRR P0/CHECKLIST ② ⑤ 决策依据:')
if (maxInCount <= 4) console.log(`  ✅ M_max=4 覆盖所有 op 的 inputs (actual max=${maxInCount})`)
else console.log(`  ⚠️ M_max=4 不够，需上调至 ${maxInCount}（更新 doc 19 / 19b §三）`)
if (maxOutCountExclError <= 3) console.log(`  ✅ P_max=3 覆盖所有 op 的非 error outputs (actual max=${maxOutCountExclError})`)
else console.log(`  ⚠️ P_max=3 不够，需上调至 ${maxOutCountExclError}（更新 doc 19 / 19b §三）`)
console.log('')
console.log('每 op 详细 output slot 检查(error alias 是否复用 global $err 或独立 slot):')
for (const r of rows) {
  console.log(
    `  ${r.name.padEnd(20)} error?=${r.hasErrorAlias ? 'Y' : 'N'} err_reg=${r.errorRegister ?? '-'} out_total=${r.outCount}`
  )
}