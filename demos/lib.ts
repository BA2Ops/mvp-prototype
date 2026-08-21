/**
 * Demo 共享工具库
 *
 * 为所有 demo 脚本提供统一结构：
 * - 环境确认（setupDemo）：Node 版本 / tmpdir 可写 / 依赖可用
 * - 步骤标记（step）：演示步骤编号与说明
 * - 观察输出（observe）：打印中间状态供人工确认
 * - 验证收集（verify）：程序化断言，失败不中断（继续演示），最后汇总
 * - 收尾（teardownDemo）：清理 + 验证清单汇总 + 退出码
 *
 * 运行方式（mvp-prototype 目录下）：npx tsx demos/demo-01-xxx.ts
 */

import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ============== 类型 ==============

export interface DemoCtx {
  /** demo 名称 */
  name: string
  /** 本次演示的独立工作目录（tmpdir 下，结束自动清理）*/
  dir: string
  /** 验证结果收集 */
  checks: Array<{ name: string; ok: boolean; detail: string }>
}

// ============== 环境确认 + 准备 ==============

/**
 * 环境确认 + 演示目录准备。
 *
 * 确认项：
 * 1. Node >= 22.5（fs.promises.glob 需要）
 * 2. os.tmpdir() 可写（演示数据落盘位置）
 * 3. 演示工作目录创建成功
 *
 * 任一失败直接终止（环境不满足无法演示）。
 */
export async function setupDemo(name: string): Promise<DemoCtx> {
  console.log('='.repeat(64))
  console.log(`DEMO: ${name}`)
  console.log('='.repeat(64))

  // ---- 环境确认 1: Node 版本 ----
  const [major, minor] = process.versions.node.split('.').map(Number)
  const nodeOk = major > 22 || (major === 22 && minor >= 5)
  console.log(`\n[环境确认]`)
  console.log(`  Node 版本: ${process.versions.node} ${nodeOk ? '✓ (>= 22.5)' : '✗ 需要 >= 22.5（fs.promises.glob）'}`)
  if (!nodeOk) {
    console.error('\n环境不满足，演示终止。')
    process.exit(1)
  }

  // ---- 环境确认 2: tmpdir 可写 ----
  let dir: string
  try {
    dir = await fs.mkdtemp(join(tmpdir(), 'mvp-demo-'))
    await fs.access(dir)
    console.log(`  tmpdir 可写: ✓`)
    console.log(`  演示工作目录: ${dir}`)
  } catch (e) {
    console.error(`  tmpdir 不可写: ✗ ${(e as Error).message}`)
    process.exit(1)
  }

  // ---- 环境确认 3: 当前工作目录（信息性）----
  console.log(`  进程 cwd: ${process.cwd()}`)

  return { name, dir, checks: [] }
}

// ============== 演示步骤 ==============

/** 标记一个演示步骤 */
export function step(n: string, title: string): void {
  console.log(`\n── 步骤 ${n}: ${title} ${'─'.repeat(Math.max(0, 46 - title.length))}`)
}

/** 打印观察点（人工确认用）*/
export function observe(label: string, value: unknown): void {
  const display =
    typeof value === 'string' ? JSON.stringify(value)
      : value === null || value === undefined ? String(value)
        : JSON.stringify(value)
  const truncated = display.length > 100 ? display.slice(0, 100) + '…' : display
  console.log(`  👁 ${label} = ${truncated}`)
}

/** 打印说明信息 */
export function note(text: string): void {
  console.log(`  💡 ${text}`)
}

// ============== 验证收集 ==============

/**
 * 程序化验证一项预期。
 *
 * 失败不抛出（演示继续），结果汇总在 teardownDemo。
 * @param ctx 演示上下文
 * @param name 验证项名称（出现在最终清单）
 * @param fn 返回 true（或抛错视为失败）
 */
export function verify(ctx: DemoCtx, name: string, fn: () => boolean): void {
  try {
    const ok = fn()
    ctx.checks.push({ name, ok: ok === true, detail: ok === true ? '' : '返回非 true' })
    console.log(`  ${ok === true ? '✓' : '✗'} 验证: ${name}`)
  } catch (e) {
    ctx.checks.push({ name, ok: false, detail: (e as Error).message })
    console.log(`  ✗ 验证: ${name} → ${(e as Error).message}`)
  }
}

/** 异步版 verify */
export async function verifyAsync(ctx: DemoCtx, name: string, fn: () => Promise<boolean>): Promise<void> {
  try {
    const ok = await fn()
    ctx.checks.push({ name, ok: ok === true, detail: ok === true ? '' : '返回非 true' })
    console.log(`  ${ok === true ? '✓' : '✗'} 验证: ${name}`)
  } catch (e) {
    ctx.checks.push({ name, ok: false, detail: (e as Error).message })
    console.log(`  ✗ 验证: ${name} → ${(e as Error).message}`)
  }
}

// ============== 收尾 ==============

/**
 * 清理工作目录 + 打印最终验证清单。
 *
 * 演示结束的验证内容：
 * - 全部通过 → 打印汇总并正常退出（exit 0）
 * - 任一失败 → 列出失败项并以非零码退出（便于 CI 感知）
 */
export async function teardownDemo(ctx: DemoCtx): Promise<void> {
  await fs.rm(ctx.dir, { recursive: true, force: true })

  const passed = ctx.checks.filter(c => c.ok)
  const failed = ctx.checks.filter(c => !c.ok)

  console.log('\n' + '='.repeat(64))
  console.log(`演示结束验证清单: ${passed.length}/${ctx.checks.length} 通过`)
  console.log('='.repeat(64))
  for (const c of ctx.checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : ` — ${c.detail}`}`)
  }
  console.log('='.repeat(64))

  if (failed.length > 0) {
    console.error(`\n${failed.length} 项验证失败，演示未达到预期。`)
    process.exit(1)
  }
  console.log(`\n✅ "${ctx.name}" 全部验证通过。`)
}
