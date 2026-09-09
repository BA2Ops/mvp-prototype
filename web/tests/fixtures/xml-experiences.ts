/**
 * F1.6 测试数据:9 条经验的 XML 定义
 *
 * 手工构造的 XML,对应 src/l3/experience-library.ts 中的 9 条核心经验。
 * 编译后应与原 L3 语义等价。
 *
 * @see tasks/phase-f1/README.md F1.6
 * @see src/l3/experience-library.ts
 */

import type { XmlExperience } from '../../shared/xml-schema.js'

// ============== 1. read_file — 直通(无 pre/judgment) ==============

export const readFileXml: XmlExperience = {
  id: 'read_file',
  description: '读取文件内容。文件不存在时错误写入 $r_err(数据化,不抛出)。',
  inputs: [
    { name: 'path', type: 'path', required: true }
  ],
  outputs: [
    { name: 'content', type: 'string', required: true }
  ],
  nodes: [
    {
      kind: 'op',
      id: 'read',
      opName: 'file_read',
      inputs: [
        { name: 'path', source: { kind: 'fromInput', inputName: 'path' } }
      ],
      outputs: [
        { name: 'content', as: '$r_content' },
        { name: 'error', as: '$r_err' }
      ]
    }
  ],
  order: [],
  paths: [
    {
      id: 'normal',
      description: '读取文件',
      response: '已读取 {path} 的内容',
      steps: [{ node: 'read' }]
    }
  ],
  outputBindings: [
    { name: 'content', register: '$r_content', type: 'string', persist: true }
  ],
  failureMessages: [
    { code: 'ENOENT', message: '读取失败:文件 {path} 不存在' },
    { code: 'EACCES', message: '读取失败:没有权限访问 {path}' },
    { code: '*', message: '读取失败:{err.message}' }
  ],
  handleError: false,
  metadata: { tags: ['file', 'read'], category: 'file-io', sideEffects: 'read-only', version: '1.0.0' }
}

// ============== 2. read_file_with_default — 完整三段式 ==============

export const readFileWithDefaultXml: XmlExperience = {
  id: 'read_file_with_default',
  description: '读取文件内容;文件不存在(ENOENT)时返回默认内容。意外异常也在此截获。',
  inputs: [
    { name: 'path', type: 'path', required: true },
    { name: 'default_content', type: 'string', required: true }
  ],
  outputs: [
    { name: 'content', type: 'string', required: true }
  ],
  nodes: [
    {
      kind: 'op',
      id: 'try_read',
      opName: 'file_read',
      inputs: [
        { name: 'path', source: { kind: 'fromInput', inputName: 'path' } }
      ],
      outputs: [
        { name: 'content', as: '$r_content' },
        { name: 'error', as: '$r_err' }
      ]
    },
    {
      kind: 'op',
      id: 'set_default',
      opName: 'evaluate_expr',
      inputs: [
        { name: 'expr', source: { kind: 'fromInput', inputName: 'default_content' } }
      ],
      outputs: [
        { name: 'result', as: '$r_content' },
        { name: 'error', as: '$r_err' }
      ]
    },
    {
      kind: 'condition',
      id: 'is_enoent',
      varName: '$r_err',
      condition: 'truthy',
      thenPath: 'use_default',
      elsePath: 'normal'
    }
  ],
  order: [],
  paths: [
    {
      id: 'use_default',
      description: '文件不存在 → 用默认内容',
      response: '文件 {path} 不存在,已使用默认内容',
      steps: [{ node: 'set_default' }]
    },
    {
      id: 'normal',
      description: '读取成功 → content 已在 $r_content',
      response: '已读取 {path} 的内容',
      steps: []
    }
  ],
  outputBindings: [
    { name: 'content', register: '$r_content', type: 'string', persist: true }
  ],
  failureMessages: [],
  handleError: true,
  metadata: { tags: ['file', 'read', 'default'], category: 'file-io', sideEffects: 'read-only', version: '1.0.0' }
}

// ============== 3. check_file_exists — pre + judgment ==============

export const checkFileExistsXml: XmlExperience = {
  id: 'check_file_exists',
  description: '判断文件是否存在(可读)。返回 exists 布尔值,不抛出。',
  inputs: [
    { name: 'path', type: 'path', required: true }
  ],
  outputs: [
    { name: 'exists', type: 'boolean', required: true }
  ],
  nodes: [
    {
      kind: 'op',
      id: 'probe',
      opName: 'file_read',
      inputs: [
        { name: 'path', source: { kind: 'fromInput', inputName: 'path' } }
      ],
      outputs: [
        { name: 'content', as: '$r_probe' },
        { name: 'error', as: '$r_err' }
      ]
    },
    {
      kind: 'op',
      id: 'calc_exists',
      opName: 'evaluate_expr',
      inputs: [
        { name: 'expr', source: { kind: 'literal', value: { type: 'op', name: 'is_null', args: [{ type: 'var', name: '$r_err' }] } } }
      ],
      outputs: [
        { name: 'result', as: '$r_exists' },
        { name: 'error', as: '$r_err' }
      ]
    }
  ],
  order: [],
  paths: [
    {
      id: 'normal',
      description: 'exists = is_null($r_err)',
      response: '文件 {path} 存在检查完成:{exists}',
      steps: [{ node: 'calc_exists' }]
    }
  ],
  outputBindings: [
    { name: 'exists', register: '$r_exists', type: 'boolean', persist: true }
  ],
  failureMessages: [],
  handleError: true,
  metadata: { tags: ['file', 'exists'], category: 'file-io', sideEffects: 'read-only', version: '1.0.0' }
}

// ============== 4. write_file — 直通 ==============

export const writeFileXml: XmlExperience = {
  id: 'write_file',
  description: '把内容写入文件(覆盖)。',
  inputs: [
    { name: 'path', type: 'path', required: true },
    { name: 'content', type: 'string', required: true }
  ],
  outputs: [
    { name: 'bytes_written', type: 'number', required: true }
  ],
  nodes: [
    {
      kind: 'op',
      id: 'write',
      opName: 'file_write',
      inputs: [
        { name: 'path', source: { kind: 'fromInput', inputName: 'path' } },
        { name: 'content', source: { kind: 'fromInput', inputName: 'content' } }
      ],
      outputs: [
        { name: 'bytes_written', as: '$r_bytes' },
        { name: 'error', as: '$r_err' }
      ]
    }
  ],
  order: [],
  paths: [
    {
      id: 'normal',
      description: '写入文件',
      response: '已写入 {path}({bytes} 字节)',
      steps: [{ node: 'write' }]
    }
  ],
  outputBindings: [
    { name: 'bytes_written', register: '$r_bytes', type: 'number', persist: true }
  ],
  failureMessages: [
    { code: '*', message: '写入 {path} 失败:{err.message}' }
  ],
  handleError: false,
  metadata: { tags: ['file', 'write'], category: 'file-io', sideEffects: 'fs-write', version: '1.0.0' }
}

// ============== 5. safe_write — pre + judgment + 2 paths ==============

export const safeWriteXml: XmlExperience = {
  id: 'safe_write',
  description: '安全写入:目标文件已存在时跳过(不覆盖),否则写入。',
  inputs: [
    { name: 'path', type: 'path', required: true },
    { name: 'content', type: 'string', required: true }
  ],
  outputs: [
    { name: 'bytes_written', type: 'number', required: true }
  ],
  nodes: [
    {
      kind: 'op',
      id: 'probe_existing',
      opName: 'file_read',
      inputs: [
        { name: 'path', source: { kind: 'fromInput', inputName: 'path' } }
      ],
      outputs: [
        { name: 'content', as: '$r_existing' },
        { name: 'error', as: '$r_err' }
      ]
    },
    {
      kind: 'op',
      id: 'do_write',
      opName: 'file_write',
      inputs: [
        { name: 'path', source: { kind: 'fromInput', inputName: 'path' } },
        { name: 'content', source: { kind: 'fromInput', inputName: 'content' } }
      ],
      outputs: [
        { name: 'bytes_written', as: '$r_bytes' },
        { name: 'error', as: '$r_err' }
      ]
    },
    {
      kind: 'op',
      id: 'set_zero',
      opName: 'evaluate_expr',
      inputs: [
        { name: 'expr', source: { kind: 'literal', value: 0 } }
      ],
      outputs: [
        { name: 'result', as: '$r_bytes' },
        { name: 'error', as: '$r_err' }
      ]
    },
    {
      kind: 'condition',
      id: 'already_exists',
      varName: '$r_err',
      condition: 'falsy',
      thenPath: 'do_write',
      elsePath: 'abort'
    }
  ],
  order: [],
  paths: [
    {
      id: 'do_write',
      description: '文件不存在 → 写入',
      response: '已写入 {path}({bytes} 字节)',
      steps: [{ node: 'do_write' }]
    },
    {
      id: 'abort',
      description: '文件已存在 → 跳过(bytes=0)',
      response: '文件 {path} 已存在,按安全模式跳过写入',
      steps: [{ node: 'set_zero' }]
    }
  ],
  outputBindings: [
    { name: 'bytes_written', register: '$r_bytes', type: 'number', persist: true }
  ],
  failureMessages: [],
  handleError: true,
  metadata: { tags: ['file', 'write', 'safe'], category: 'file-io', sideEffects: 'fs-write', version: '1.0.0' }
}

// ============== 6. find_files — 直通 ==============

export const findFilesXml: XmlExperience = {
  id: 'find_files',
  description: '按 glob 模式查找文件,返回路径列表。',
  inputs: [
    { name: 'pattern', type: 'string', required: true },
    { name: 'cwd', type: 'path', required: false, default: '.' }
  ],
  outputs: [
    { name: 'matches', type: 'object', required: true },
    { name: 'count', type: 'number', required: true }
  ],
  nodes: [
    {
      kind: 'op',
      id: 'glob',
      opName: 'glob_match',
      inputs: [
        { name: 'pattern', source: { kind: 'fromInput', inputName: 'pattern' } },
        { name: 'cwd', source: { kind: 'fromInput', inputName: 'cwd' } }
      ],
      outputs: [
        { name: 'matches', as: '$r_matches' },
        { name: 'count', as: '$r_count' },
        { name: 'error', as: '$r_err' }
      ]
    }
  ],
  order: [],
  paths: [
    {
      id: 'normal',
      description: 'glob 匹配',
      response: '共找到 {count} 个匹配 {pattern} 的文件',
      steps: [{ node: 'glob' }]
    }
  ],
  outputBindings: [
    { name: 'matches', register: '$r_matches', type: 'object', persist: true }
  ],
  failureMessages: [],
  handleError: false,
  metadata: { tags: ['file', 'search', 'glob'], category: 'search', sideEffects: 'read-only', version: '1.0.0' }
}

// ============== 7. search_in_files — 直通 ==============

export const searchInFilesXml: XmlExperience = {
  id: 'search_in_files',
  description: '在文件/目录中搜索内容(字面量或正则),返回匹配列表。',
  inputs: [
    { name: 'pattern', type: 'string', required: true },
    { name: 'path', type: 'path', required: true }
  ],
  outputs: [
    { name: 'matches', type: 'object', required: true },
    { name: 'count', type: 'number', required: true }
  ],
  nodes: [
    {
      kind: 'op',
      id: 'grep',
      opName: 'grep_search',
      inputs: [
        { name: 'pattern', source: { kind: 'fromInput', inputName: 'pattern' } },
        { name: 'path', source: { kind: 'fromInput', inputName: 'path' } }
      ],
      outputs: [
        { name: 'matches', as: '$r_matches' },
        { name: 'count', as: '$r_count' },
        { name: 'error', as: '$r_err' }
      ]
    }
  ],
  order: [],
  paths: [
    {
      id: 'normal',
      description: 'grep 搜索',
      response: '搜索完成:{pattern} 在 {path} 中共 {count} 处匹配',
      steps: [{ node: 'grep' }]
    }
  ],
  outputBindings: [
    { name: 'matches', register: '$r_matches', type: 'object', persist: true }
  ],
  failureMessages: [],
  handleError: false,
  metadata: { tags: ['file', 'search', 'grep'], category: 'search', sideEffects: 'read-only', version: '1.0.0' }
}

// ============== 8. run_shell — 直通 ==============

export const runShellXml: XmlExperience = {
  id: 'run_shell',
  description: '执行外部命令(execFile 语义),返回 stdout/stderr/exit_code。',
  inputs: [
    { name: 'command', type: 'string', required: true },
    { name: 'args', type: 'object', required: false, default: [] }
  ],
  outputs: [
    { name: 'stdout', type: 'string', required: true },
    { name: 'exit_code', type: 'number', required: true }
  ],
  nodes: [
    {
      kind: 'op',
      id: 'exec',
      opName: 'shell_exec',
      inputs: [
        { name: 'command', source: { kind: 'fromInput', inputName: 'command' } },
        { name: 'args', source: { kind: 'fromInput', inputName: 'args' } }
      ],
      outputs: [
        { name: 'stdout', as: '$r_stdout' },
        { name: 'stderr', as: '$r_stderr' },
        { name: 'exit_code', as: '$r_exit' },
        { name: 'error', as: '$r_err' }
      ]
    }
  ],
  order: [],
  paths: [
    {
      id: 'normal',
      description: '执行命令',
      response: '命令执行完成(退出码 {exit}),stdout 见 stdout 字段',
      steps: [{ node: 'exec' }]
    }
  ],
  outputBindings: [
    { name: 'stdout', register: '$r_stdout', type: 'string', persist: true }
  ],
  failureMessages: [],
  handleError: false,
  metadata: { tags: ['shell', 'exec'], category: 'shell', sideEffects: 'exec', version: '1.0.0' }
}

// ============== 9. replace_in_file — 多步链式 ==============

export const replaceInFileXml: XmlExperience = {
  id: 'replace_in_file',
  description: '读取文件、替换内容、写回(文件编辑 MVP)。',
  inputs: [
    { name: 'path', type: 'path', required: true },
    { name: 'find', type: 'string', required: true },
    { name: 'replace', type: 'string', required: true }
  ],
  outputs: [
    { name: 'count', type: 'number', required: true }
  ],
  nodes: [
    {
      kind: 'op',
      id: 'read',
      opName: 'file_read',
      inputs: [
        { name: 'path', source: { kind: 'fromInput', inputName: 'path' } }
      ],
      outputs: [
        { name: 'content', as: '$r_content' },
        { name: 'error', as: '$r_err' }
      ]
    },
    {
      kind: 'op',
      id: 'replace',
      opName: 'string_replace',
      inputs: [
        { name: 'text', source: { kind: 'fromNode', nodeId: 'read', outputName: 'content' } },
        { name: 'find', source: { kind: 'fromInput', inputName: 'find' } },
        { name: 'replace', source: { kind: 'fromInput', inputName: 'replace' } },
        { name: 'replace_all', source: { kind: 'literal', value: true } }
      ],
      outputs: [
        { name: 'result', as: '$r_replaced' },
        { name: 'count', as: '$r_count' },
        { name: 'error', as: '$r_err' }
      ]
    },
    {
      kind: 'op',
      id: 'write',
      opName: 'file_write',
      inputs: [
        { name: 'path', source: { kind: 'fromInput', inputName: 'path' } },
        { name: 'content', source: { kind: 'fromNode', nodeId: 'replace', outputName: 'result' } }
      ],
      outputs: [
        { name: 'bytes_written', as: '$r_bytes' },
        { name: 'error', as: '$r_err' }
      ]
    }
  ],
  order: [],
  paths: [
    {
      id: 'normal',
      description: '读 → 替换 → 写',
      response: '替换完成:{path} 中共替换 {count} 处并已保存',
      steps: [
        { node: 'read' },
        { node: 'replace' },
        { node: 'write' }
      ]
    }
  ],
  outputBindings: [
    { name: 'count', register: '$r_count', type: 'number', persist: true }
  ],
  failureMessages: [
    { code: 'ENOENT', message: '替换失败:文件 {path} 不存在' },
    { code: '*', message: '替换失败:{err.message}' }
  ],
  handleError: true,
  metadata: { tags: ['file', 'replace'], category: 'file-io', sideEffects: 'fs-write', version: '1.0.0' }
}

// ============== 全部 9 条经验 ==============

export const ALL_XML_EXPERIENCES: XmlExperience[] = [
  readFileXml,
  readFileWithDefaultXml,
  checkFileExistsXml,
  writeFileXml,
  safeWriteXml,
  findFilesXml,
  searchInFilesXml,
  runShellXml,
  replaceInFileXml
]

/** 经验 ID → XmlExperience 映射 */
export const XML_EXPERIENCES_MAP: Map<string, XmlExperience> = new Map(
  ALL_XML_EXPERIENCES.map(e => [e.id, e])
)
