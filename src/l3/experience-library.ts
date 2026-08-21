/**
 * L3 核心经验库（Phase C5 + E2 结果消息增强）
 *
 * @see ../../docs/mvp/12-experience-model.md §7（经验库设计）
 * @see ./response.ts（D-E2-1 消息解析）
 *
 * 设计原则（D-FB-1）：
 * - 每条经验必须有真实使用方（L4 LLM 识别 intent.type → 查此库）
 * - 每条经验的三段式结构直接对应一个真实业务场景
 * - MVP 规模：< 50 条；本库 9 条核心
 *
 * D-E2-1（信息返回权在 L3）：
 * - TargetOpPath.response：每条路径的人类可读结果消息模板
 *   （分支语义 → 分支消息，如 safe_write 的 do_write/abort 各有文案）
 * - Experience.responses.failure：按 $r_err.code 映射失败消息（'*' 兜底）
 * - L4 只做插值渲染，不做业务判断——与「错误处置权在 L3」同构：
 *   信息返回权也在 L3
 *
 * 寄存器约定：
 * - $r_input_<name>  : 输入绑定（编译器 Step 0 生成）
 * - $r_err           : 全局错误寄存器（ERROR_REGISTER）
 * - $r_path          : 实际走过的路径 ID 标记（编译器分支构造生成）
 * - $r_<semantic>    : 经验内中间结果
 */

import type { Experience, Expr } from './experience.js'
import type { Value } from '../l1/types.js'
import { ERROR_REGISTER } from '../l2/errors.js'

// ============== Expr 构造辅助 ===============

/** 字面量节点 */
const lit = (value: Value): Expr => ({ type: 'literal', value: value as never })
/** 寄存器引用节点 */
const reg = (name: string): Expr => ({ type: 'var', name })
/** op 节点 */
const op = (name: string, ...args: Expr[]): Expr =>
  ({ type: 'op', name: name as never, args })

/** error_code($r_err) == code */
const errCodeIs = (code: string): Expr =>
  op('==', op('error_code', reg(ERROR_REGISTER)), lit(code))

/** is_null($r_err) — 上一步无错误 */
const noError = (): Expr => op('is_null', reg(ERROR_REGISTER))

// ============== 经验定义 ===============

/** 通用输出声明：error 寄存器 */
const errOut = { error: { kind: 'register' as const, name: ERROR_REGISTER } }

/**
 * 1. read_file — 读文件（直通）
 *
 * 最简单的经验：无前置无判断，单步 file_read。
 */
const readFile: Experience = {
  id: 'read_file',
  description: '读取文件内容。文件不存在时错误写入 $r_err（数据化，不抛出）。',
  inputs: { path: { type: 'path', required: true } },
  outputs: { content: { type: 'string', required: true } },
  responses: {
    failure: {
      ENOENT: `读取失败：文件 {path} 不存在`,
      EACCES: `读取失败：没有权限访问 {path}`,
      '*': `读取失败：{err.message}`
    }
  },
  target_op: {
    base_op: 'file_read',
    default_path: 'normal',
    paths: [{
      id: 'normal',
      description: '读取文件',
      response: `已读取 {path} 的内容`,
      steps: [{
        operation: 'file_read',
        inputs: { path: { kind: 'input', name: 'path' } },
        outputs: {
          content: { kind: 'register', name: '$r_content' },
          ...errOut
        }
      }]
    }]
  }
}

/**
 * 2. read_file_with_default — 读文件，不存在时用默认值
 *
 * 三段式完整示例：
 * - pre: file_read → $r_content / $r_err
 * - judgment: error_code($r_err) == 'ENOENT' → use_default : normal
 * - target: use_default = evaluate_expr(default)；normal = 空（content 已就位）
 *
 * handleError=true：非 ENOENT 的意外异常也在此截获（业务上"总有默认值兜底"）。
 */
const readFileWithDefault: Experience = {
  id: 'read_file_with_default',
  description: '读取文件内容；文件不存在（ENOENT）时返回默认内容。意外异常也在此截获。',
  handleError: true,
  inputs: {
    path: { type: 'path', required: true },
    default_content: { type: 'string', required: true }
  },
  outputs: { content: { type: 'string', required: true } },
  pre_processing: [{
    id: 'try_read',
    operation: 'file_read',
    inputs: { path: { kind: 'input', name: 'path' } },
    outputs: {
      content: { kind: 'register', name: '$r_content' },
      ...errOut
    },
    skip_threshold: 0
  }],
  conditional_judgment: [{
    id: 'is_enoent',
    trigger: { condition_expr: errCodeIs('ENOENT') },
    then_path: 'use_default',
    else_path: 'normal'
  }],
  target_op: {
    base_op: 'file_read',
    default_path: 'normal',
    paths: [
      {
        id: 'use_default',
        description: '文件不存在 → 用默认内容',
        response: `文件 {path} 不存在，已使用默认内容`,
        steps: [{
          operation: 'evaluate_expr',
          inputs: { expr: { kind: 'literal', value: reg('$r_input_default_content') as unknown as Value } },
          outputs: {
            result: { kind: 'register', name: '$r_content' },
            ...errOut
          }
        }]
      },
      {
        id: 'normal',
        description: '读取成功 → content 已在 $r_content',
        response: `已读取 {path} 的内容`,
        steps: []
      }
    ]
  }
}

/**
 * 3. check_file_exists — 判断文件是否存在
 *
 * file_read 的 error 为 null ⟺ 文件存在（且可读）。
 */
const checkFileExists: Experience = {
  id: 'check_file_exists',
  description: '判断文件是否存在（可读）。返回 exists 布尔值，不抛出。',
  handleError: true,
  inputs: { path: { type: 'path', required: true } },
  outputs: { exists: { type: 'boolean', required: true } },
  pre_processing: [{
    id: 'probe',
    operation: 'file_read',
    inputs: { path: { kind: 'input', name: 'path' } },
    outputs: {
      content: { kind: 'register', name: '$r_probe' },
      ...errOut
    },
    skip_threshold: 0
  }],
  target_op: {
    base_op: 'evaluate_expr',
    default_path: 'normal',
    paths: [{
      id: 'normal',
      description: 'exists = is_null($r_err)',
      response: `文件 {path} 存在检查完成：{exists}`,
      steps: [{
        operation: 'evaluate_expr',
        inputs: { expr: { kind: 'literal', value: noError() as unknown as Value } },
        outputs: {
          result: { kind: 'register', name: '$r_exists' },
          ...errOut
        }
      }]
    }]
  }
}

/**
 * 4. write_file — 写文件（直通）
 */
const writeFile: Experience = {
  id: 'write_file',
  description: '把内容写入文件（覆盖）。',
  inputs: {
    path: { type: 'path', required: true },
    content: { type: 'string', required: true }
  },
  outputs: { bytes_written: { type: 'number', required: true } },
  responses: {
    failure: { '*': `写入 {path} 失败：{err.message}` }
  },
  target_op: {
    base_op: 'file_write',
    default_path: 'normal',
    paths: [{
      id: 'normal',
      description: '写入文件',
      response: `已写入 {path}（{bytes} 字节）`,
      steps: [{
        operation: 'file_write',
        inputs: {
          path: { kind: 'input', name: 'path' },
          content: { kind: 'input', name: 'content' }
        },
        outputs: {
          bytes_written: { kind: 'register', name: '$r_bytes' },
          ...errOut
        }
      }]
    }]
  }
}

/**
 * 5. safe_write — 仅当目标不存在时写入
 *
 * judgment: is_null($r_err)（探测读取无错误 = 文件已存在）→ abort；否则 write。
 */
const safeWrite: Experience = {
  id: 'safe_write',
  description: '安全写入：目标文件已存在时跳过（不覆盖），否则写入。',
  handleError: true,
  inputs: {
    path: { type: 'path', required: true },
    content: { type: 'string', required: true }
  },
  outputs: { bytes_written: { type: 'number', required: true } },
  pre_processing: [{
    id: 'probe_existing',
    operation: 'file_read',
    inputs: { path: { kind: 'input', name: 'path' } },
    outputs: {
      content: { kind: 'register', name: '$r_existing' },
      ...errOut
    },
    skip_threshold: 0
  }],
  conditional_judgment: [{
    id: 'already_exists',
    trigger: { condition_expr: noError() },
    then_path: 'abort',
    else_path: 'do_write'
  }],
  target_op: {
    base_op: 'file_write',
    default_path: 'do_write',
    paths: [
      {
        id: 'do_write',
        description: '文件不存在 → 写入',
        response: `已写入 {path}（{bytes} 字节）`,
        steps: [{
          operation: 'file_write',
          inputs: {
            path: { kind: 'input', name: 'path' },
            content: { kind: 'input', name: 'content' }
          },
          outputs: {
            bytes_written: { kind: 'register', name: '$r_bytes' },
            ...errOut
          }
        }]
      },
      {
        id: 'abort',
        description: '文件已存在 → 跳过（bytes=0）',
        response: `文件 {path} 已存在，按安全模式跳过写入`,
        steps: [{
          operation: 'evaluate_expr',
          inputs: { expr: { kind: 'literal', value: lit(0) as unknown as Value } },
          outputs: {
            result: { kind: 'register', name: '$r_bytes' },
            ...errOut
          }
        }]
      }
    ]
  }
}

/**
 * 6. find_files — glob 查找
 */
const findFiles: Experience = {
  id: 'find_files',
  description: '按 glob 模式查找文件，返回路径列表。',
  inputs: {
    pattern: { type: 'string', required: true },
    cwd: { type: 'path', required: false, default: '.' }
  },
  outputs: {
    matches: { type: 'object', required: true },
    count: { type: 'number', required: true }
  },
  target_op: {
    base_op: 'glob_match',
    default_path: 'normal',
    paths: [{
      id: 'normal',
      description: 'glob 匹配',
      response: `共找到 {count} 个匹配 {pattern} 的文件`,
      steps: [{
        operation: 'glob_match',
        inputs: {
          pattern: { kind: 'input', name: 'pattern' },
          cwd: { kind: 'input', name: 'cwd' }
        },
        outputs: {
          matches: { kind: 'register', name: '$r_matches' },
          count: { kind: 'register', name: '$r_count' },
          ...errOut
        }
      }]
    }]
  }
}

/**
 * 7. search_in_files — grep 内容搜索
 */
const searchInFiles: Experience = {
  id: 'search_in_files',
  description: '在文件/目录中搜索内容（字面量或正则），返回匹配列表。',
  inputs: {
    pattern: { type: 'string', required: true },
    path: { type: 'path', required: true }
  },
  outputs: {
    matches: { type: 'object', required: true },
    count: { type: 'number', required: true }
  },
  target_op: {
    base_op: 'grep_search',
    default_path: 'normal',
    paths: [{
      id: 'normal',
      description: 'grep 搜索',
      response: `搜索完成：{pattern} 在 {path} 中共 {count} 处匹配`,
      steps: [{
        operation: 'grep_search',
        inputs: {
          pattern: { kind: 'input', name: 'pattern' },
          path: { kind: 'input', name: 'path' }
        },
        outputs: {
          matches: { kind: 'register', name: '$r_matches' },
          count: { kind: 'register', name: '$r_count' },
          ...errOut
        }
      }]
    }]
  }
}

/**
 * 8. run_shell — 执行外部命令
 */
const runShell: Experience = {
  id: 'run_shell',
  description: '执行外部命令（execFile 语义），返回 stdout/stderr/exit_code。',
  inputs: {
    command: { type: 'string', required: true },
    args: { type: 'object', required: false, default: [] }
  },
  outputs: {
    stdout: { type: 'string', required: true },
    exit_code: { type: 'number', required: true }
  },
  target_op: {
    base_op: 'shell_exec',
    default_path: 'normal',
    paths: [{
      id: 'normal',
      description: '执行命令',
      response: `命令执行完成（退出码 {exit}），stdout 见 stdout 字段`,
      steps: [{
        operation: 'shell_exec',
        inputs: {
          command: { kind: 'input', name: 'command' },
          args: { kind: 'input', name: 'args' }
        },
        outputs: {
          stdout: { kind: 'register', name: '$r_stdout' },
          stderr: { kind: 'register', name: '$r_stderr' },
          exit_code: { kind: 'register', name: '$r_exit' },
          ...errOut
        }
      }]
    }]
  }
}

/**
 * 9. replace_in_file — 文件内替换（三步链）
 *
 * read → string_replace → write，演示多步寄存器传递。
 */
const replaceInFile: Experience = {
  id: 'replace_in_file',
  description: '读取文件、替换内容、写回（文件编辑 MVP）。',
  inputs: {
    path: { type: 'path', required: true },
    find: { type: 'string', required: true },
    replace: { type: 'string', required: true }
  },
  outputs: {
    count: { type: 'number', required: true }
  },
  handleError: true,
  responses: {
    failure: {
      ENOENT: `替换失败：文件 {path} 不存在`,
      '*': `替换失败：{err.message}`
    }
  },
  target_op: {
    base_op: 'string_replace',
    default_path: 'normal',
    paths: [{
      id: 'normal',
      description: '读 → 替换 → 写',
      response: `替换完成：{path} 中共替换 {count} 处并已保存`,
      steps: [
        {
          operation: 'file_read',
          inputs: { path: { kind: 'input', name: 'path' } },
          outputs: {
            content: { kind: 'register', name: '$r_content' },
            ...errOut
          }
        },
        {
          operation: 'string_replace',
          inputs: {
            text: { kind: 'register', name: '$r_content' },
            find: { kind: 'input', name: 'find' },
            replace: { kind: 'input', name: 'replace' },
            replace_all: { kind: 'literal', value: true }
          },
          outputs: {
            result: { kind: 'register', name: '$r_replaced' },
            count: { kind: 'register', name: '$r_count' },
            ...errOut
          }
        },
        {
          operation: 'file_write',
          inputs: {
            path: { kind: 'input', name: 'path' },
            content: { kind: 'register', name: '$r_replaced' }
          },
          outputs: {
            bytes_written: { kind: 'register', name: '$r_bytes' },
            ...errOut
          }
        }
      ]
    }]
  }
}

// ============== 导出 ===============

/** 9 条核心经验 */
export const CORE_EXPERIENCES: Experience[] = [
  readFile,
  readFileWithDefault,
  checkFileExists,
  writeFile,
  safeWrite,
  findFiles,
  searchInFiles,
  runShell,
  replaceInFile
]

/** 构建经验库 Map（供 ExperienceService 使用）*/
export function createCoreLibrary(): Map<string, Experience> {
  return new Map(CORE_EXPERIENCES.map(e => [e.id, e]))
}
