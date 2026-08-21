/**
 * L1 ID 生成工具
 *
 * @see ../../docs/mvp/09-l1-implementation.md
 *
 * 用于：
 * - l1MainLoop 创建根意图 entry
 * - L3 编译时生成 children id（Phase C）
 * - A11 enterIntent/exitIntent 生成 entry id
 *
 * 格式：`${prefix}_${counter}_${timestamp(base36)}`
 * 保证单进程内唯一。
 */

let counter = 0

/**
 * 生成唯一 ID
 *
 * @param prefix 前缀（如 'intent', 'op', 'move'）
 * @returns 唯一 ID 字符串
 */
export function generateId(prefix: string = 'e'): string {
  return `${prefix}_${++counter}_${Date.now().toString(36)}`
}

/**
 * 当前时间戳（毫秒）
 */
export function now(): number {
  return Date.now()
}
