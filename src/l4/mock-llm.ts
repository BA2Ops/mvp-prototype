/**
 * L4 Mock — 自然语言 → RecognizedIntent（Phase E1）
 *
 * @see ../../docs/mvp/10-reactive-execution-model.md §五（L4 定位）
 *
 * 架构边界（本模块的存在意义）：
 * - L4 LLM 是唯一能把「自然语言」翻译成「结构化 intent」的层
 * - L4 **不能**直接调 L2 op、不能生成指令栈条目——只能发 intent 给 L3
 * - 本模块用**规则模板**模拟真 LLM（MVP 边界：不做真正的 NL 推理），
 *   但接口形状与真 LLM 一致：text in → RecognizedIntent out
 *
 * 识别策略：有序规则表（具体模式在前，通用模式在后，先命中先用）。
 */

import type { RecognizedIntent } from '../l1/types.js'

/** 单条识别规则 */
export interface IntentRule {
  /** 规则名（调试用）*/
  name: string

  /** 话语匹配模式 */
  pattern: RegExp

  /** 从匹配结果构造 intent；返回 null 表示不采纳（继续尝试后续规则）*/
  build: (m: RegExpMatchArray) => RecognizedIntent | null
}

/** 无法识别的输入 */
export class UnrecognizedInputError extends Error {
  constructor(public utterance: string) {
    super(`L4 mock: cannot recognize utterance: "${utterance}"`)
    this.name = 'UnrecognizedInputError'
  }
}

/**
 * 有序规则表。
 *
 * ⚠️ 顺序即优先级：具体的经验模式必须排在通用的前面
 *    （read_file_with_default 先于 read_file，safe_write 先于 write_file）。
 */
export const INTENT_RULES: IntentRule[] = [
  // ---------- 具体（先）----------

  {
    name: 'replace_in_file',
    // 「把 note.txt 里的 foo 替换为 bar」/「将 a.txt 中的 "x" 改成 y」
    pattern: /(?:把|将)\s*(\S+)\s*(?:中的?|里(?:面)?的?)\s*[「"'']?(.+?)["'』”]?\s*(?:替换成|替换为|改成|改为)\s*[「"'']?(.+?)["'』”]?(?:。|$)/,
    build: m => ({
      type: 'replace_in_file',
      params: { path: m[1], find: m[2], replace: m[3] }
    })
  },

  {
    name: 'read_file_with_default',
    // 「读取 config.ini，如果不存在就用 default」
    pattern: /读取\s*(\S+)\s*[，,]\s*(?:如果)?(?:文件)?不存在.*?(?:默认|就用|使用|返回)\s*[「"'']?(.+?)["'』”]?(?:。|$)/,
    build: m => ({
      type: 'read_file_with_default',
      params: { path: m[1], default_content: m[2] }
    })
  },

  {
    name: 'check_file_exists',
    // 「note.txt 是否存在」/「检查 note.txt 是否存在」
    pattern: /(?:检查\s*)?(\S+)\s*(?:文件)?是否存在[??。]?/,
    build: m => ({
      type: 'check_file_exists',
      params: { path: m[1] }
    })
  },

  {
    name: 'safe_write',
    // 「安全地把 'content' 写入 path」（已存在则跳过）
    // 注：不能用 .*? —— 懒惰回溯会把「地把」吞进 content
    pattern: /安全(?:地)?(?:把|将)?\s*["'「']?(.+?)["'」']?\s*写入\s*(\S+)(?:。|$)/,
    build: m => ({
      type: 'safe_write',
      params: { content: m[1], path: m[2] }
    })
  },

  {
    name: 'search_in_files',
    // 「在 logs 目录中搜索 ERROR」/「搜索 timeout」
    pattern: /(?:在\s*(\S+)\s*(?:中|里)\s*)?搜索\s*[「"'']?(.+?)["'』”]?(?:。|$)/,
    build: m => m[1]
      ? { type: 'search_in_files', params: { path: m[1], pattern: m[2] } }
      : null // 无目标路径时信息不足，不采纳
  },

  {
    name: 'find_files',
    // 「查找 *.txt 文件」/「列出 *.log 在 logs 目录」
    pattern: /(?:查找|列出|找)(?:一下)?\s*(?:所有)?\s*([^\s]+)\s*(?:文件)?\s*(?:在\s*(\S+))?(?:。|$)/,
    build: m => ({
      type: 'find_files',
      params: { pattern: m[1], ...(m[2] ? { cwd: m[2] } : {}) }
    })
  },

  {
    name: 'run_shell',
    // 「执行 node --version」/「运行 npm test」→ 首词 command，其余 args
    pattern: /(?:执行|运行)(?:命令|脚本)?\s+(\S+)(?:\s+(.+?))?(?:。|$)/,
    build: m => {
      const words = (m[2] ?? '').trim()
      return {
        type: 'run_shell',
        params: {
          command: m[1],
          ...(words ? { args: words.split(/\s+/) } : {})
        }
      }
    }
  },

  // ---------- 通用（后）----------

  {
    name: 'write_file',
    // 「把 'hello' 写入 note.txt」
    pattern: /(?:把|将)\s*[「"'']?(.+?)["'』”]?\s*写入\s*(\S+)(?:。|$)/,
    build: m => ({
      type: 'write_file',
      params: { content: m[1], path: m[2] }
    })
  },

  {
    name: 'read_file',
    // 「读取 note.txt 的内容」/「读 note.txt」
    pattern: /(?:读取|读一下|读)\s*(\S+?)\s*(?:的)?(?:文件)?(?:内容)?(?:。|$)/,
    build: m => ({
      type: 'read_file',
      params: { path: m[1] }
    })
  }
]

/**
 * L4 Mock：把自然语言识别为结构化 intent。
 *
 * 接口形状与真 LLM 一致（text in → intent out），
 * 替换为真 LLM 时只需换掉 recognize 实现。
 */
export class MockL4 {
  constructor(private readonly rules: IntentRule[] = INTENT_RULES) {}

  recognize(utterance: string): RecognizedIntent {
    for (const rule of this.rules) {
      const m = utterance.match(rule.pattern)
      if (!m) continue
      const intent = rule.build(m)
      if (intent) return intent
    }
    throw new UnrecognizedInputError(utterance)
  }
}
