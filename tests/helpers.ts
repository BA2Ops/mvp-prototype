/**
 * 测试通用工具
 *
 * 提供：
 * - ID 生成（用于 StackEntry）
 * - 当前时间（用于 createdAt）
 */

/**
 * 生成唯一 ID
 *
 * 格式：`${prefix}_${counter}_${timestamp}`
 * 保证在单进程内唯一。
 */
let counter = 0
export function generateId(prefix: string = 'e'): string {
  return `${prefix}_${++counter}_${Date.now().toString(36)}`
}

/**
 * 当前时间戳（毫秒）
 */
export function now(): number {
  return Date.now()
}

/**
 * 创建最小 StackEntry 基础字段
 *
 * 用于测试 helper，减少样板代码。
 */
export function baseEntry(prefix: string = 'e') {
  return {
    id: generateId(prefix),
    parentIntentId: null,
    createdAt: now()
  }
}