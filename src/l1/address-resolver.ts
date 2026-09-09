/**
 * L1 Address 解析器（双区架构版）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §二
 * @see ../../docs/mvp/06-execution-layer.md §3
 *
 * 完整设计：
 * - 3 种 Address kind 的解析（原第 4 种 'file' 已移除，IO 一律由 L2 op 承担）
 * - literal：仅作为源
 * - public：从 publicStore 读/写
 * - internal：从 internalStore 读/写
 *
 * 错误处理：
 * - 已知错误（缺失 variable、文件不存在）：抛 AddressError
 * - 调用方（A9 main loop 或 A10 propagateHardError）决定如何处理
 *
 * 错误码保留（2026-08-20 设计反馈）：
 * - AddressError 现在保留原始 err.code（如 'ENOENT', 'EACCES'）
 * - DAG 条件分支可通过 $error.code 决策（如 file_read 不存在 vs 权限拒绝）
 */

import type { Address, Value } from './types.js'
import type { ExecutionState } from './execution-state.js'

/**
 * 穷举守卫：switch 未命中任何已知 kind 分支时（例如遗留的 `{kind:'file'}`、拼写错误，
 * 或未来新增但尚未在此处理的 kind），显式抛硬错误而不是静默返回 undefined。
 *
 * 用运行时字符串比较而非依赖 TypeScript `never` 收窄是因为本函数参数类型已是完整的 Address union，
 * switch 把三种合法分支都 return/throw 掉之后剩余代码在类型层面已经"逻辑不可达"，直接在这里引用
 * addr.kind 做进一步判断时 TS 有时会推断为 never 从而对新写法产生额外的类型噪音；用一个独立的局部变量
 * 承接原始判别值并做纯字符串判定可以完全绕开这种拉扯，也让这段防御性代码对读者意图更直白。
 */
function assertKnownKind(kind: Address['kind']): void {
  if (kind !== 'literal' && kind !== 'public' && kind !== 'internal') {
    throw new AddressError(
      `Unsupported Address kind at runtime: '${String(kind)}'（当前仅支持 literal / public / internal）`,
      'UNSUPPORTED_KIND'
    )
  }
}

/**
 * Address 解析错误
 *
 * 抛出场景：
 * - 读取不存在的 public variable
 * - 读取不存在的 internal register
 * - 读取不存在的 file
 * - 写入 literal（不允许）
 * - 文件系统 IO 错误
 *
 * code 字段语义：
 * - 'LITERAL_WRITE'：尝试写入 literal（编程错误）
 * - 'VARIABLE_NOT_FOUND'：public/internal 不存在
 * - 'FILE_NOT_FOUND'：文件不存在（ENOENT）
 * - 'FILE_PERMISSION_DENIED'：权限拒绝（EACCES）
 * - 'FILE_IO_ERROR'：其他文件系统错误
 * - 原始 fs 错误码（如 'ENOENT'）会透传
 * - undefined：编程错误或不可分类
 */
export class AddressError extends Error {
  /** 错误分类（用于 DAG 条件分支决策） */
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'AddressError'
    this.code = code
  }
}

/**
 * 解析 Address 到 Value
 *
 * @param addr Address（literal/public/internal 三种 kind）
 * @param state ExecutionState
 * @returns Value
 *
 * @throws AddressError（包含原始错误码如果有）
 */
export async function resolveAddress(
  addr: Address,
  state: ExecutionState
): Promise<Value> {
  const kind = addr.kind
  switch (kind) {
    case 'literal':
      return addr.value

    case 'public':
      if (!state.publicStore.has(addr.name)) {
        throw new AddressError(
          `Public variable not found: ${addr.name}`,
          'VARIABLE_NOT_FOUND'
        )
      }
      return state.publicStore.get(addr.name)!

    case 'internal':
      if (!state.internalStore.has(addr.name)) {
        throw new AddressError(
          `Internal register not found: ${addr.name}`,
          'VARIABLE_NOT_FOUND'
        )
      }
      return state.internalStore.get(addr.name)!
  }
  // TS 认为上面三个分支已穷尽所有合法 kind，理论上走不到这里；显式守卫用于应对运行时传入超出类型契约的输入
  assertKnownKind(kind)
}

/**
 * 写入 Value 到 Address
 *
 * @param addr Address
 * @param value 要写入的 Value
 * @param state ExecutionState
 *
 * @throws AddressError（包含原始错误码如果有）
 */
export async function writeAddress(
  addr: Address,
  value: Value,
  state: ExecutionState
): Promise<void> {
  const kind = addr.kind
  switch (kind) {
    case 'literal':
      throw new AddressError(
        'Cannot write to literal address (literal is read-only)',
        'LITERAL_WRITE'
      )

    case 'public':
      state.publicStore.set(addr.name, value)
      break

    case 'internal':
      state.internalStore.set(addr.name, value)
      break
  }
  assertKnownKind(kind)
}