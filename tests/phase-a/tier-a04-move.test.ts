/**
 * Phase A Tier A4 - move primitive 执行函数测试
 *
 * @see ../../docs/mvp/11-prototype-implementation-plan.md §A4
 *
 * 验证：
 * 1. 基本 move：literal/variable/file 各种组合
 * 2. 支持各种 Value 类型（数字、布尔、null、数组、对象）
 * 3. 栈行为：成功时弹栈，失败时不弹栈
 * 4. 错误处理：source 缺失、file 不存在、write to literal
 * 5. 多次执行：链式 move、循环 move
 */

import { describe, test, expect, beforeEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import { executeMove } from '../../src/l1/primitives/move.js'
import {
  createInitialState,
  type ExecutionState
} from '../../src/l1/execution-state.js'
import { createMockL2 } from '../../src/mocks/mock-l2.js'
import { createMockL3 } from '../../src/mocks/mock-l3.js'
import { AddressError } from '../../src/l1/address-resolver.js'
import type { MoveEntry } from '../../src/l1/types.js'
import { generateId, now } from '../helpers.js'

const FIXTURES_DIR = 'tests/fixtures/a4'

describe('A4: move primitive', () => {
  let state: ExecutionState

  beforeEach(async () => {
    const { registry: l2 } = createMockL2()
    const l3 = createMockL3([])
    state = createInitialState(l2, l3)

    await fs.mkdir(FIXTURES_DIR, { recursive: true })
  })

  // ============== 基本功能 ==============
  describe('基本功能：各种 Address 组合', () => {
    test('literal → variable', async () => {
      await executeMove(createMove('hello', '$x'), state)

      expect(state.resultStore.get('$x')).toBe('hello')
    })

    test('variable → variable（source 不变）', async () => {
      state.resultStore.set('$source', 'data')

      await executeMove(
        createMoveVar('$source', '$dest'),
        state
      )

      expect(state.resultStore.get('$dest')).toBe('data')
      expect(state.resultStore.get('$source')).toBe('data')  // source 不变
    })

    test('variable → file', async () => {
      const filePath = path.join(FIXTURES_DIR, 'output.txt')
      state.resultStore.set('$content', 'to write')

      await executeMove(
        createMoveVarToFile('$content', filePath),
        state
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('to write')
    })

    test('file → variable', async () => {
      const filePath = path.join(FIXTURES_DIR, 'source.txt')
      await fs.writeFile(filePath, 'file data')

      await executeMove(
        createMoveFileToVar(filePath, '$loaded'),
        state
      )

      expect(state.resultStore.get('$loaded')).toBe('file data')
    })

    test('literal → file', async () => {
      const filePath = path.join(FIXTURES_DIR, 'literal-output.txt')

      await executeMove(
        createMoveFile('literal data', filePath),
        state
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('literal data')
    })

    test('file → file（拷贝）', async () => {
      const srcPath = path.join(FIXTURES_DIR, 'copy-src.txt')
      const destPath = path.join(FIXTURES_DIR, 'copy-dest.txt')
      await fs.writeFile(srcPath, 'copy content')

      await executeMove(
        createMoveFileToFile(srcPath, destPath),
        state
      )

      const content = await fs.readFile(destPath, 'utf-8')
      expect(content).toBe('copy content')

      // 源文件也存在（copy 而非 move）
      const srcContent = await fs.readFile(srcPath, 'utf-8')
      expect(srcContent).toBe('copy content')
    })
  })

  // ============== 值类型 ==============
  describe('支持各种 Value 类型', () => {
    test('数字', async () => {
      await executeMove(createMove(42, '$n'), state)
      expect(state.resultStore.get('$n')).toBe(42)
    })

    test('布尔值', async () => {
      await executeMove(createMove(true, '$b'), state)
      expect(state.resultStore.get('$b')).toBe(true)
    })

    test('null', async () => {
      await executeMove(createMove(null, '$n'), state)
      expect(state.resultStore.has('$n')).toBe(true)
      expect(state.resultStore.get('$n')).toBeNull()
    })

    test('数组', async () => {
      const arr = [1, 2, 3]
      await executeMove(createMove(arr, '$arr'), state)
      expect(state.resultStore.get('$arr')).toEqual([1, 2, 3])
    })

    test('对象', async () => {
      const obj = { name: 'test', count: 5 }
      await executeMove(createMove(obj, '$obj'), state)
      expect(state.resultStore.get('$obj')).toEqual({ name: 'test', count: 5 })
    })

    test('空字符串', async () => {
      await executeMove(createMove('', '$s'), state)
      expect(state.resultStore.get('$s')).toBe('')
    })

    test('0（数字零）', async () => {
      await executeMove(createMove(0, '$n'), state)
      expect(state.resultStore.get('$n')).toBe(0)
    })
  })

  // ============== 栈行为 ==============
  describe('栈行为', () => {
    test('move 成功后弹出栈顶', async () => {
      // 栈：[pre, m1]
      state.stack.push({
        id: 'pre', parentIntentId: null, createdAt: 0,
        kind: 'move',
        from: { kind: 'literal', value: 1 },
        to: { kind: 'variable', name: '$a' }
      })
      const entry = createMove('hello', '$x')
      state.stack.push(entry)

      expect(state.stack.length).toBe(2)

      await executeMove(entry, state)

      expect(state.stack.length).toBe(1)
      expect(state.stack[0].id).toBe('pre')  // 剩下 pre
    })

    test('move 失败时不弹栈（保留 entry 供调试）', async () => {
      const entry: MoveEntry = {
        id: generateId('m'),
        parentIntentId: null,
        createdAt: now(),
        kind: 'move',
        from: { kind: 'variable', name: '$missing' },  // 不存在
        to: { kind: 'variable', name: '$x' }
      }
      state.stack.push(entry)

      await expect(executeMove(entry, state)).rejects.toThrow()

      // 栈顶仍然是 entry（未弹出）
      expect(state.stack.length).toBe(1)
      expect(state.stack[0]).toBe(entry)
    })

    test('executeMove 不依赖栈（独立函数）', async () => {
      // executeMove 不依赖 state.stack，只接受 entry 参数
      await executeMove(createMove('x', '$x'), state)
      expect(state.resultStore.get('$x')).toBe('x')
      expect(state.stack.length).toBe(0)  // 不操作栈
    })
  })

  // ============== 错误处理 ==============
  describe('错误处理', () => {
    test('source variable 不存在抛 AddressError', async () => {
      const entry = createMoveVar('$missing', '$x')

      await expect(executeMove(entry, state))
        .rejects.toThrow(AddressError)

      await expect(executeMove(entry, state))
        .rejects.toThrow(/not found/)
    })

    test('source file 不存在抛 AddressError', async () => {
      const entry = createMoveFileToVar(
        path.join(FIXTURES_DIR, 'nonexistent-12345.txt'),
        '$x'
      )

      await expect(executeMove(entry, state))
        .rejects.toThrow(AddressError)
    })

    test('write to literal 抛 AddressError', async () => {
      const entry: MoveEntry = {
        id: generateId('m'),
        parentIntentId: null,
        createdAt: now(),
        kind: 'move',
        from: { kind: 'literal', value: 'x' },
        to: { kind: 'literal', value: 'y' }  // 不能写 literal
      }

      await expect(executeMove(entry, state))
        .rejects.toThrow(AddressError)

      await expect(executeMove(entry, state))
        .rejects.toThrow(/literal/)
    })

    test('错误时 resultStore 不被修改（atomic）', async () => {
      // move from $missing → $dest
      // 期望：$dest 不会被创建或修改
      state.resultStore.set('$dest', 'pre-existing')

      const entry = createMoveVar('$missing', '$dest')

      await expect(executeMove(entry, state)).rejects.toThrow()

      // $dest 保持原值（未修改）
      expect(state.resultStore.get('$dest')).toBe('pre-existing')
    })

    test('错误时不写入文件', async () => {
      const filePath = path.join(FIXTURES_DIR, 'should-not-exist.txt')

      const entry = createMoveVarToFile('$missing', filePath)

      await expect(executeMove(entry, state)).rejects.toThrow()

      // 文件不应该被创建
      await expect(fs.access(filePath)).rejects.toThrow(/ENOENT/)
    })
  })

  // ============== 多次执行场景 ==============
  describe('多次执行场景', () => {
    test('链式 move：literal → A → B → file', async () => {
      const filePath = path.join(FIXTURES_DIR, 'chain.txt')

      await executeMove(createMove('chain data', '$A'), state)
      await executeMove(createMoveVar('$A', '$B'), state)
      await executeMove(createMoveVarToFile('$B', filePath), state)

      expect(state.resultStore.get('$A')).toBe('chain data')
      expect(state.resultStore.get('$B')).toBe('chain data')
      expect(await fs.readFile(filePath, 'utf-8')).toBe('chain data')
    })

    test('覆盖场景：B → A 覆盖 A 原值', async () => {
      state.resultStore.set('$A', 'original_A')
      state.resultStore.set('$B', 'original_B')

      await executeMove(createMoveVar('$B', '$A'), state)

      // $A 被 $B 覆盖
      expect(state.resultStore.get('$A')).toBe('original_B')
      // $B 不变
      expect(state.resultStore.get('$B')).toBe('original_B')
    })

    test('同一 source 被多次读取（不消耗）', async () => {
      state.resultStore.set('$shared', 'shared value')

      await executeMove(createMoveVar('$shared', '$x'), state)
      await executeMove(createMoveVar('$shared', '$y'), state)
      await executeMove(createMoveVar('$shared', '$z'), state)

      // $shared 不变（不是消耗性的）
      expect(state.resultStore.get('$shared')).toBe('shared value')
      expect(state.resultStore.get('$x')).toBe('shared value')
      expect(state.resultStore.get('$y')).toBe('shared value')
      expect(state.resultStore.get('$z')).toBe('shared value')
    })
  })

  // ============== entry 标识 ==============
  describe('entry 标识保持不变', () => {
    test('不修改 entry.id、parentIntentId、createdAt', async () => {
      const entry: MoveEntry = {
        id: 'm1',
        parentIntentId: 'parent-1',
        createdAt: 100,
        kind: 'move',
        from: { kind: 'literal', value: 'data' },
        to: { kind: 'variable', name: '$x' }
      }

      await executeMove(entry, state)

      expect(entry.id).toBe('m1')
      expect(entry.parentIntentId).toBe('parent-1')
      expect(entry.createdAt).toBe(100)
      expect(entry.kind).toBe('move')
    })
  })
})

// ============== Helper 函数 ==============
function createMove(value: string | number | boolean | null, varName: string): MoveEntry {
  return {
    id: generateId('m'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'move',
    from: { kind: 'literal', value },
    to: { kind: 'variable', name: varName }
  }
}

function createMoveVar(fromVar: string, toVar: string): MoveEntry {
  return {
    id: generateId('m'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'move',
    from: { kind: 'variable', name: fromVar },
    to: { kind: 'variable', name: toVar }
  }
}

function createMoveVarToFile(fromVar: string, filePath: string): MoveEntry {
  return {
    id: generateId('m'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'move',
    from: { kind: 'variable', name: fromVar },
    to: { kind: 'file', path: filePath }
  }
}

function createMoveFileToVar(filePath: string, toVar: string): MoveEntry {
  return {
    id: generateId('m'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'move',
    from: { kind: 'file', path: filePath },
    to: { kind: 'variable', name: toVar }
  }
}

function createMoveFile(value: string, filePath: string): MoveEntry {
  return {
    id: generateId('m'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'move',
    from: { kind: 'literal', value },
    to: { kind: 'file', path: filePath }
  }
}

function createMoveFileToFile(srcPath: string, destPath: string): MoveEntry {
  return {
    id: generateId('m'),
    parentIntentId: null,
    createdAt: now(),
    kind: 'move',
    from: { kind: 'file', path: srcPath },
    to: { kind: 'file', path: destPath }
  }
}