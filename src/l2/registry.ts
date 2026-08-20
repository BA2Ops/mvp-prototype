/**
 * L2 Operation Registry
 *
 * @see ../../docs/mvp/09-l1-implementation.md §3, §6
 *
 * 用于注册和管理所有 L2 operations。
 * L1 通过 get() 获取 operation 实例。
 */

import type { Operation } from './operation.js'

export class L2Registry {
  private ops = new Map<string, Operation>()

  /**
   * 注册一个 operation
   * @throws 如果同名 operation 已注册
   */
  register(op: Operation): void {
    if (this.ops.has(op.name)) {
      throw new Error(`Operation '${op.name}' already registered`)
    }
    this.ops.set(op.name, op)
  }

  /**
   * 获取一个已注册的 operation
   * @returns Operation 实例，如果未注册则返回 undefined
   */
  get(name: string): Operation | undefined {
    return this.ops.get(name)
  }

  /**
   * 检查 operation 是否已注册
   */
  has(name: string): boolean {
    return this.ops.has(name)
  }

  /**
   * 获取所有已注册 operation 的名称（用于调试）
   */
  list(): string[] {
    return Array.from(this.ops.keys())
  }

  /**
   * 清空所有 registration（仅用于测试）
   */
  clear(): void {
    this.ops.clear()
  }
}