/**
 * 测试通用工具
 *
 * 提供：
 * - ID 生成（复用生产代码 src/l1/id.ts）
 * - 当前时间（复用生产代码 src/l1/id.ts）
 * - baseEntry 帮助函数
 */

export { generateId, now } from '../src/l1/id.js'

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
