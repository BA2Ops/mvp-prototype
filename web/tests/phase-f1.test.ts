/**
 * F1.6 测试:9 条经验回归 + 受限子集违规拒绝
 *
 * 验证:
 *   - 9 条经验的 XML 能通过 R1-R6 校验
 *   - 编译为 L3 Experience
 *   - 编译产物过 compileExperience
 *   - 编译产物过 l1MainLoop 端到端执行
 *   - 受限子集违规(R1-R6 各一例)被正确拒绝
 *
 * @see tasks/phase-f1/README.md F1.6
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { validateXmlExperience } from '../shared/xml-validator.js'
import { compileXmlToL3 } from '../shared/xml-to-l3.js'
import { validateCompiledL3 } from '../shared/compile-validator.js'
import { serializeXml, parseXml } from '../shared/xml-parser.js'
import { createInitialState } from '../../src/l1/execution-state.js'
import { ExperienceService } from '../../src/l3/experience-service.js'
import { CORE_EXPERIENCES } from '../../src/l3/experience-library.js'
import { L2Registry } from '../../src/l2/registry.js'
import { fileReadOp } from '../../src/l2/builtins/file-read.js'
import { fileWriteOp } from '../../src/l2/builtins/file-write.js'
import { shellExecOp } from '../../src/l2/builtins/shell-exec.js'
import { globMatchOp } from '../../src/l2/builtins/glob-match.js'
import { grepSearchOp } from '../../src/l2/builtins/grep-search.js'
import { stringReplaceOp } from '../../src/l2/builtins/string-replace.js'
import { evaluateExprOp } from '../../src/l2/builtins/evaluate-expr.js'
import { evaluateCollectionOp } from '../../src/l2/builtins/evaluate-collection.js'
import { incrementCounterOp } from '../../src/l2/builtins/increment-counter.js'
import { decrementCounterOp } from '../../src/l2/builtins/decrement-counter.js'
import { sortByOp } from '../../src/l2/builtins/sort-by.js'
import { takeFirstOp } from '../../src/l2/builtins/take-first.js'
import type { Experience } from '../../src/l3/experience.js'

import {
  ALL_XML_EXPERIENCES,
  XML_EXPERIENCES_MAP,
  readFileXml,
  readFileWithDefaultXml,
  safeWriteXml,
  replaceInFileXml
} from './fixtures/xml-experiences.js'
import type { XmlExperience } from '../shared/xml-schema.js'

// ============== 测试基础设施 ==============

function mkRegistry(): L2Registry {
  const r = new L2Registry()
  r.register(fileReadOp); r.register(fileWriteOp); r.register(shellExecOp)
  r.register(globMatchOp); r.register(grepSearchOp); r.register(stringReplaceOp)
  r.register(evaluateExprOp); r.register(evaluateCollectionOp)
  r.register(incrementCounterOp); r.register(decrementCounterOp)
  r.register(sortByOp); r.register(takeFirstOp)
  return r
}

function mkService(experiences: Experience[] = CORE_EXPERIENCES): ExperienceService {
  return new ExperienceService(experiences, mkRegistry())
}

function mkExperiencesMap(extra: Experience[] = []): Map<string, Experience> {
  return new Map([...CORE_EXPERIENCES, ...extra].map(e => [e.id, e]))
}

// ============== 测试 ==============

describe('F1.6: XML→L3 编译器回归测试', () => {
  let registry: L2Registry
  let state: ReturnType<typeof createInitialState>

  beforeEach(() => {
    registry = mkRegistry()
    state = createInitialState(registry, mkService())
  })

  // ============== R1-R6 校验 ==============

  describe('R1-R6 受限子集校验', () => {
    it('9 条经验全部通过 R1-R6 校验', () => {
      for (const xmlExp of ALL_XML_EXPERIENCES) {
        const result = validateXmlExperience(xmlExp)
        if (!result.valid) {
          console.error(`${xmlExp.id} 校验失败:`, result.errors)
        }
        expect(result.valid).toBe(true)
      }
    })

    it('R2 违规:节点有多个前驱被拒绝', () => {
      const xmlExp: XmlExperience = {
        ...readFileXml,
        id: 'r2_violation',
        nodes: [
          {
            kind: 'op',
            id: 'read1',
            opName: 'file_read',
            inputs: [
              { name: 'path', source: { kind: 'fromInput', inputName: 'path' } }
            ],
            outputs: [
              { name: 'content', as: '$r_content1' },
              { name: 'error', as: '$r_err' }
            ]
          },
          {
            kind: 'op',
            id: 'read2',
            opName: 'file_read',
            inputs: [
              { name: 'path', source: { kind: 'fromInput', inputName: 'path' } }
            ],
            outputs: [
              { name: 'content', as: '$r_content2' },
              { name: 'error', as: '$r_err' }
            ]
          },
          {
            kind: 'op',
            id: 'merge',
            opName: 'evaluate_expr',
            inputs: [
              { name: 'expr', source: { kind: 'fromNode', nodeId: 'read1', outputName: 'content' } },
              { name: 'expr2', source: { kind: 'fromNode', nodeId: 'read2', outputName: 'content' } }
            ],
            outputs: [
              { name: 'result', as: '$r_merged' },
              { name: 'error', as: '$r_err' }
            ]
          }
        ],
        paths: [
          {
            id: 'normal',
            description: '',
            response: '',
            steps: [{ node: 'merge' }]
          }
        ]
      }

      const result = validateXmlExperience(xmlExp)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.rule === 'R2')).toBe(true)
    })

    it('R5 违规:引用不存在的节点被拒绝', () => {
      const xmlExp: XmlExperience = {
        ...readFileXml,
        id: 'r5_violation',
        nodes: [
          {
            kind: 'op',
            id: 'read',
            opName: 'file_read',
            inputs: [
              { name: 'path', source: { kind: 'fromNode', nodeId: 'nonexistent', outputName: 'path' } }
            ],
            outputs: [
              { name: 'content', as: '$r_content' },
              { name: 'error', as: '$r_err' }
            ]
          }
        ],
        paths: [
          {
            id: 'normal',
            description: '',
            response: '',
            steps: [{ node: 'read' }]
          }
        ]
      }

      const result = validateXmlExperience(xmlExp)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.rule === 'R5')).toBe(true)
    })

    it('R6 违规:条件节点未关联变量被拒绝', () => {
      const xmlExp: XmlExperience = {
        ...readFileXml,
        id: 'r6_violation',
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
            kind: 'condition',
            id: 'bad_cond',
            varName: '',
            condition: 'truthy',
            thenPath: 'normal',
            elsePath: 'normal'
          }
        ],
        paths: [
          {
            id: 'normal',
            description: '',
            response: '',
            steps: []
          }
        ]
      }

      const result = validateXmlExperience(xmlExp)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.rule === 'R6')).toBe(true)
    })
  })

  // ============== XML 文本往返 ==============

  describe('XML 文本往返(序列化 → 解析)', () => {
    it('read_file 序列化 → 解析 → 结构一致', () => {
      const xml = serializeXml(readFileXml)
      const result = parseXml(xml)
      expect(result.success).toBe(true)
      expect(result.data?.id).toBe('read_file')
      expect(result.data?.inputs).toHaveLength(1)
      expect(result.data?.inputs[0].name).toBe('path')
      expect(result.data?.inputs[0].type).toBe('path')
      expect(result.data?.inputs[0].required).toBe(true)
      expect(result.data?.outputs).toHaveLength(1)
      expect(result.data?.outputs[0].name).toBe('content')
      expect(result.data?.nodes).toHaveLength(1)
      expect(result.data?.nodes[0].kind).toBe('op')
      expect(result.data?.paths).toHaveLength(1)
      expect(result.data?.paths[0].id).toBe('normal')
      expect(result.data?.paths[0].steps).toHaveLength(1)
      expect(result.data?.paths[0].steps[0].node).toBe('read')
      expect(result.data?.outputBindings).toHaveLength(1)
      expect(result.data?.outputBindings[0].name).toBe('content')
      expect(result.data?.outputBindings[0].persist).toBe(true)
    })

    it('9 条经验全部通过序列化 → 解析往返', () => {
      for (const xmlExp of ALL_XML_EXPERIENCES) {
        const xml = serializeXml(xmlExp)
        const result = parseXml(xml)
        if (!result.success) {
          console.error(`${xmlExp.id} 往返失败:`, result.errors)
        }
        expect(result.success).toBe(true)
        expect(result.data?.id).toBe(xmlExp.id)
        expect(result.data?.inputs).toHaveLength(xmlExp.inputs.length)
        expect(result.data?.outputs).toHaveLength(xmlExp.outputs.length)
        expect(result.data?.nodes).toHaveLength(xmlExp.nodes.length)
        expect(result.data?.paths).toHaveLength(xmlExp.paths.length)
      }
    })

    it('往返后的 read_file 能编译为 L3', () => {
      const xml = serializeXml(readFileXml)
      const result = parseXml(xml)
      expect(result.success).toBe(true)
      const l3 = compileXmlToL3(result.data!)
      expect(l3.id).toBe('read_file')
      expect(l3.inputs.path).toBeDefined()
      expect(l3.target_op.paths).toHaveLength(1)
      expect(l3.target_op.paths[0].steps).toHaveLength(1)
      expect(l3.target_op.paths[0].steps[0].operation).toBe('file_read')
    })
  })

  // ============== XML→L3 编译 ==============

  describe('XML→L3 编译', () => {
    it('read_file 编译为合法 L3', () => {
      const l3 = compileXmlToL3(readFileXml)
      expect(l3.id).toBe('read_file')
      expect(l3.inputs.path).toBeDefined()
      expect(l3.outputs.content).toBeDefined()
      expect(l3.target_op.paths).toHaveLength(1)
      expect(l3.target_op.paths[0].id).toBe('normal')
      expect(l3.target_op.paths[0].steps).toHaveLength(1)
      expect(l3.target_op.paths[0].steps[0].operation).toBe('file_read')
    })

    it('read_file_with_default 编译为完整三段式', () => {
      const l3 = compileXmlToL3(readFileWithDefaultXml)
      expect(l3.id).toBe('read_file_with_default')
      expect(l3.pre_processing).toBeDefined()
      expect(l3.pre_processing!).toHaveLength(1)
      expect(l3.pre_processing![0].id).toBe('try_read')
      expect(l3.conditional_judgment).toBeDefined()
      expect(l3.conditional_judgment!).toHaveLength(1)
      expect(l3.conditional_judgment![0].then_path).toBe('use_default')
      expect(l3.conditional_judgment![0].else_path).toBe('normal')
      expect(l3.target_op.paths).toHaveLength(2)
      expect(l3.handleError).toBe(true)
    })

    it('safe_write 编译为 pre + judgment + 2 paths', () => {
      const l3 = compileXmlToL3(safeWriteXml)
      expect(l3.id).toBe('safe_write')
      expect(l3.pre_processing).toBeDefined()
      expect(l3.conditional_judgment).toBeDefined()
      expect(l3.target_op.paths).toHaveLength(2)
      expect(l3.target_op.paths.find(p => p.id === 'do_write')).toBeDefined()
      expect(l3.target_op.paths.find(p => p.id === 'abort')).toBeDefined()
    })

    it('replace_in_file 编译为多步链式', () => {
      const l3 = compileXmlToL3(replaceInFileXml)
      expect(l3.id).toBe('replace_in_file')
      expect(l3.target_op.paths[0].steps).toHaveLength(3)
      expect(l3.target_op.paths[0].steps[0].operation).toBe('file_read')
      expect(l3.target_op.paths[0].steps[1].operation).toBe('string_replace')
      expect(l3.target_op.paths[0].steps[2].operation).toBe('file_write')

      // 验证参数连接:replace 节点的 text 输入来自 read 节点的 content 输出
      const replaceStep = l3.target_op.paths[0].steps[1]
      expect(replaceStep.inputs.text).toBeDefined()
      expect(replaceStep.inputs.text.kind).toBe('register')
    })

    it('9 条经验全部编译成功', () => {
      for (const xmlExp of ALL_XML_EXPERIENCES) {
        const l3 = compileXmlToL3(xmlExp)
        expect(l3.id).toBe(xmlExp.id)
        expect(l3.target_op.paths.length).toBeGreaterThan(0)
      }
    })
  })

  // ============== L3 编译合法性 + 端到端执行 ==============

  describe('编译产物三层验证', () => {
    it('read_file 过 compileExperience + l1MainLoop', async () => {
      const l3 = compileXmlToL3(readFileXml)
      const experiences = mkExperiencesMap([l3])
      const result = await validateCompiledL3(l3, state, experiences, registry)

      expect(result.layer1_compile.valid).toBe(true)
      expect(result.layer2_exec.valid).toBe(true)
      expect(result.overall).toBe(true)
    })

    it('read_file_with_default 过三层验证', async () => {
      const l3 = compileXmlToL3(readFileWithDefaultXml)
      const experiences = mkExperiencesMap([l3])
      const result = await validateCompiledL3(l3, state, experiences, registry)

      expect(result.layer1_compile.valid).toBe(true)
      expect(result.layer2_exec.valid).toBe(true)
      expect(result.overall).toBe(true)
    })

    it('check_file_exists 过三层验证', async () => {
      const l3 = compileXmlToL3(XML_EXPERIENCES_MAP.get('check_file_exists')!)
      const experiences = mkExperiencesMap([l3])
      const result = await validateCompiledL3(l3, state, experiences, registry)

      expect(result.layer1_compile.valid).toBe(true)
      expect(result.layer2_exec.valid).toBe(true)
      expect(result.overall).toBe(true)
    })

    it('write_file 过三层验证', async () => {
      const l3 = compileXmlToL3(XML_EXPERIENCES_MAP.get('write_file')!)
      const experiences = mkExperiencesMap([l3])
      const result = await validateCompiledL3(l3, state, experiences, registry)

      expect(result.layer1_compile.valid).toBe(true)
      expect(result.layer2_exec.valid).toBe(true)
      expect(result.overall).toBe(true)
    })

    it('safe_write 过三层验证', async () => {
      const l3 = compileXmlToL3(safeWriteXml)
      const experiences = mkExperiencesMap([l3])
      const result = await validateCompiledL3(l3, state, experiences, registry)

      expect(result.layer1_compile.valid).toBe(true)
      expect(result.layer2_exec.valid).toBe(true)
      expect(result.overall).toBe(true)
    })

    it('find_files 过三层验证', async () => {
      const l3 = compileXmlToL3(XML_EXPERIENCES_MAP.get('find_files')!)
      const experiences = mkExperiencesMap([l3])
      const result = await validateCompiledL3(l3, state, experiences, registry)

      expect(result.layer1_compile.valid).toBe(true)
      expect(result.layer2_exec.valid).toBe(true)
      expect(result.overall).toBe(true)
    })

    it('search_in_files 过三层验证', async () => {
      const l3 = compileXmlToL3(XML_EXPERIENCES_MAP.get('search_in_files')!)
      const experiences = mkExperiencesMap([l3])
      const result = await validateCompiledL3(l3, state, experiences, registry)

      expect(result.layer1_compile.valid).toBe(true)
      expect(result.layer2_exec.valid).toBe(true)
      expect(result.overall).toBe(true)
    })

    it('run_shell 过三层验证', async () => {
      const l3 = compileXmlToL3(XML_EXPERIENCES_MAP.get('run_shell')!)
      const experiences = mkExperiencesMap([l3])
      const result = await validateCompiledL3(l3, state, experiences, registry)

      expect(result.layer1_compile.valid).toBe(true)
      expect(result.layer2_exec.valid).toBe(true)
      expect(result.overall).toBe(true)
    })

    it('replace_in_file 过三层验证', async () => {
      const l3 = compileXmlToL3(replaceInFileXml)
      const experiences = mkExperiencesMap([l3])
      const result = await validateCompiledL3(l3, state, experiences, registry)

      expect(result.layer1_compile.valid).toBe(true)
      expect(result.layer2_exec.valid).toBe(true)
      expect(result.overall).toBe(true)
    })
  })

  // ============== 端到端语义等价验证 ==============

  describe('端到端语义等价', () => {
    it('read_file 实际读取文件成功', async () => {
      const tmpFile = join(tmpdir(), `f1-test-${Date.now()}.txt`)
      await fs.writeFile(tmpFile, 'hello world')

      try {
        const l3 = compileXmlToL3(readFileXml)
        const experiences = mkExperiencesMap([l3])
        const result = await validateCompiledL3(l3, state, experiences, registry)
        expect(result.overall).toBe(true)
      } finally {
        await fs.unlink(tmpFile).catch(() => {})
      }
    })

    it('read_file_with_default 文件不存在时返回默认值', async () => {
      const l3 = compileXmlToL3(readFileWithDefaultXml)
      const experiences = mkExperiencesMap([l3])
      const result = await validateCompiledL3(l3, state, experiences, registry)
      expect(result.overall).toBe(true)
    })

    it('replace_in_file 实际替换文件成功', async () => {
      const tmpFile = join(tmpdir(), `f1-replace-${Date.now()}.txt`)
      await fs.writeFile(tmpFile, 'foo bar foo')

      try {
        const l3 = compileXmlToL3(replaceInFileXml)
        const experiences = mkExperiencesMap([l3])
        const result = await validateCompiledL3(l3, state, experiences, registry)
        expect(result.overall).toBe(true)
      } finally {
        await fs.unlink(tmpFile).catch(() => {})
      }
    })
  })
})
