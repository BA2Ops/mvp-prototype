# Phase F1 — XML 中间定义层 + 编译器

> **Phase 目标**:实现 XML schema 定义、解析、受限子集校验、XML→L3 直接映射编译
> **Gate-F1**:XML→L3 编译器能将受限子集 XML 编译为合法 L3 Experience,并通过端到端执行
> **计划文档**:[doc 20](../../docs/mvp/20-experience-design-tool.md) | [主任务计划](../README.md)
> **状态**:未开始

---

## 一、前置知识

### 1.1 现有 L3 Experience 结构(编译目标)

```
Experience
├── id: string
├── description: string
├── inputs: Record<string, ParamSpec>
├── outputs: Record<string, ParamSpec>
├── pre_processing?: PreProcessing[]      // 前置处理(收集数据)
├── conditional_judgment?: ConditionalJudgment[]  // 条件判断(决定路径)
├── target_op: TargetOp                    // 目标操作(必有)
│   ├── base_op: string
│   ├── paths: TargetOpPath[]
│   │   ├── id / description / steps / response
│   │   └── steps: OpStep[]
│   │       ├── operation: string          // L2 op 名或经验 ID
│   │       ├── inputs: Record<string, ParamRef>
│   │       └── outputs: Record<string, ParamRef>
│   └── default_path: string
├── handleError?: boolean
├── responses?: { failure?: Record<string, string> }
└── outputs_bindings?: Record<string, OutputBinding>
```

### 1.2 ParamRef 四种来源

```typescript
type ParamRef =
  | { kind: 'literal'; value: Value }
  | { kind: 'input'; name: string }          // 来自 intent.params
  | { kind: 'register'; name: string }       // 业务变量 $r_<name>
  | { kind: 'registerOutput'; expId?: string; outKey: string }  // 引用经验输出
```

### 1.3 受限子集规则(doc 18)

| 规则 | 内容 | 校验方式 |
|------|------|----------|
| R1 | 条件节点仅允许尾部分支:分支后不得有汇合节点 | 图遍历 |
| R2 | 树形结构:每节点至多一个前驱(起点除外) | 前驱计数 |
| R3 | 多条件仅限 else-if 链 | 判断节点后继结构检查 |
| R4 | 回环仅允许指向经验入口的受控回环 | 回边目标检查 |
| R5 | 数据流单来源 + 类型兼容 | 参数端口检查 |
| R6 | 条件节点必须恰好关联一个局部变量 | 连线检查 |

### 1.4 三类节点(doc 18)

| 节点类型 | 用户用法 | 契约来源 | 映射目标 |
|----------|----------|----------|----------|
| 经验节点 | 引用现有 L3 经验 | 该经验的 inputs/outputs/responses | execute_intent 嵌套帧 |
| op 节点 | 引用 L2 op | formalSpec | execute_op |
| 条件节点 | 业务问题分支 | 分支条件引用上游输出参数 | evaluate_expr + conditional_skip |

---

## 二、任务分解

### F1.1 — XML schema 定义(Zod)

**目标**:用 Zod 定义 XML 中间定义的完整 schema。

**输入**:
- doc 15 §3(节点类型、参数端口、连接、顺序界定)
- doc 18 §一(三类节点 + L1 映射)
- 现有 `src/l3/experience.ts`(L3 结构作为编译目标)

**输出**:
- `web/shared/xml-schema.ts`:Zod schema 定义
- TypeScript 类型(从 Zod schema 推导)

**实现要点**:

XML 顶层结构(示意):
```xml
<experience id="read_file" description="读取文件内容">
  <inputs>
    <param name="path" type="path" required="true" />
  </inputs>
  <outputs>
    <param name="content" type="string" required="true" />
  </outputs>

  <!-- 节点定义 -->
  <nodes>
    <opNode id="read" opName="file_read">
      <inputs>
        <param name="path" fromInput="path" />
      </inputs>
      <outputs>
        <param name="content" as="content" />
        <param name="error" as="$r_err" />
      </outputs>
    </opNode>
  </nodes>

  <!-- 顺序界定(可选,默认按节点出现顺序) -->
  <order>
    <after node="read" />
  </order>

  <!-- 条件分支(可选) -->
  <branches>
    <branch id="is_enoent" var="$r_err" condition="truthy">
      <then path="use_default" />
      <else path="normal" />
    </branch>
  </branches>

  <!-- 路径定义 -->
  <paths>
    <path id="normal" response="已读取 {path} 的内容">
      <step node="read" />
    </path>
    <path id="use_default" response="文件不存在,使用默认值">
      <step node="set_default" />
    </path>
  </paths>

  <!-- 元数据 -->
  <metadata>
    <tags>file,read</tags>
    <category>file-io</category>
    <sideEffects>read-only</sideEffects>
  </metadata>
</experience>
```

**schema 需覆盖**:
- 经验顶层:id, description, inputs, outputs
- 三类节点:opNode / experienceNode / conditionNode
- 参数来源:fromInput / fromNodeOutput / literal
- 顺序界定:order/after
- 条件分支:branches/branch(then/else)
- 路径:paths/path/steps
- 元数据:metadata(tags/category/sideEffects)

**验收标准**:
- Zod schema 能解析上述 XML 示例
- 类型推导产生 TypeScript 类型
- 非法 XML(未知节点类型/缺失必填属性)被 Zod 拒绝

**依赖**:doc 15 §3
**估算**:M(4-6h)

---

### F1.2 — XML 解析器

**目标**:使用 fast-xml-parser 解析 XML 文本,通过 Zod 校验,输出结构化对象。

**输入**:F1.1 的 Zod schema

**输出**:
- `web/shared/xml-parser.ts`
- 函数:`parseXml(xmlText: string): XmlExperience`
- 函数:`serializeXml(exp: XmlExperience): string`(反向序列化,用于保存)

**实现要点**:
- fast-xml-parser 配置:忽略注释空白、属性区分大小写
- 解析后过 Zod schema 校验,失败时返回结构化错误(行号+字段)
- 反向序列化保持可读性(缩进、属性顺序)

**验收标准**:
- 能解析 F1.1 示例 XML
- 非法 XML 返回结构化错误(含字段路径)
- serializeXml(parseXml(x)) 语义等价

**依赖**:F1.1
**估算**:S(2-3h)

---

### F1.3 — 受限子集校验器(R1-R6)

**目标**:对解析后的 XmlExperience 跑 R1-R6 图结构校验。

**输入**:F1.1 的 schema、F1.2 的解析结果

**输出**:
- `web/shared/xml-validator.ts`
- 函数:`validateXmlExperience(exp: XmlExperience): ValidationResult`
- `ValidationResult = { valid: boolean; errors: ValidationError[] }`
- `ValidationError = { rule: string; message: string; nodeIds?: string[] }`

**实现要点**:

| 规则 | 实现方式 |
|------|----------|
| R1 尾部分支 | 遍历条件节点所有后继到终点路径,检查不得交汇 |
| R2 树形 | 统计每个节点前驱数,>1 则违规(起点除外) |
| R3 else-if 链 | 检查条件节点后继结构:then/else 不得再分叉条件 |
| R4 受控回环 | 回边目标必须是经验入口节点 |
| R5 单来源+类型 | 每个输入参数至多一个连接来源;类型兼容检查 |
| R6 单变量判断 | 条件节点恰好关联一个局部变量(连线检查) |

**验收标准**:
- 合法 XML(对应现有 9 条经验)通过全部 R1-R6
- 6 类违规各有一个测试用例被正确拒绝
- 错误信息含具体节点 ID 和规则说明

**依赖**:F1.1
**估算**:M(4-6h)

---

### F1.4 — XML→L3 编译器(直接映射)

**目标**:将受限子集 XML 编译为 L3 Experience 对象。

**输入**:F1.1 schema、F1.3 校验通过的 XmlExperience

**输出**:
- `web/shared/xml-to-l3.ts`
- 函数:`compileXmlToL3(xmlExp: XmlExperience): Experience`
- 函数:`compileXmlTextToL3(xmlText: string): { experience?: Experience; errors: ValidationError[] }`

**实现要点**:

编译映射规则(doc 18 §二):

| XML 用户定义 | L3 编译推导 |
|--------------|-------------|
| 节点 = 对现有经验的引用 + 参数来源 | 经验内 steps 的实例化 + sidecar 装载 |
| 顺序界定 | pre_processing 归属 / target steps 依赖序 |
| 参数连接(A.x → B.y) | 寄存器分配、inputs/outputs 地址绑定 |
| 字面量参数值 | sidecar move 装载 |
| 分支条件 = 上游输出参数 | 条件表达式构造 + 分支骨架(cskip/skip) |
| 汇聚参数意图 | 各分支落点与收尾绑定 |
| 受控回环 | 递归自嵌套结构 + 终止 judgment |

**编译流程**:
1. 节点分类:无上游依赖的获取类节点 → pre_processing 候选;其余按依赖序进入 target paths
2. 参数连接 → ParamRef 映射:
   - fromInput → `{ kind: 'input', name }`
   - fromNodeOutput → `{ kind: 'register', name: '$r_<as>' }`
   - literal → `{ kind: 'literal', value }`
3. 条件节点 → ConditionalJudgment(condition_expr 构造)
4. 路径 → TargetOpPath(steps + response)
5. 输出绑定 → outputs_bindings(从 metadata 推导)

**验收标准**:
- 手工构造的 XML(对应 safe_write / read_file_with_default)编译为合法 L3
- 编译出的 Experience 结构与现有 experience-library.ts 中的定义语义等价
- 编译失败时返回结构化错误

**依赖**:F1.1, F1.2, F1.3
**估算**:L(6-8h)

---

### F1.5 — 编译产物校验(L3 合法性 + 端到端执行)

**目标**:验证 XML→L3 编译产物是合法 L3 Experience,且能端到端执行。

**输入**:F1.4 编译产物

**输出**:
- `web/shared/compile-validator.ts`
- 函数:`validateCompiledL3(exp: Experience, registry: L2RegistryLike): { valid: boolean; errors: string[] }`

**实现要点**:

三层验证:
1. **L3 编译合法性**:调用现有 `compileExperience(exp, state, options)` 验证能编译为 StackEntry[]
2. **端到端试执行**:用 `l1MainLoop` 在临时 state 上执行,验证不抛异常
3. **结果完整性**:验证 outputs_bindings 声明的输出确实产生

**验收标准**:
- 编译产物过 `compileExperience` 无异常
- 编译产物过 `l1MainLoop` 端到端执行无异常
- 验证失败返回具体错误信息

**依赖**:F1.4
**估算**:S(2-3h)

---

### F1.6 — 测试(9 条经验回归)

**目标**:用现有 9 条经验反推 XML,编译后与原 L3 语义等价。

**输入**:F1.1-F1.5 全部完成

**输出**:
- `web/tests/phase-f1.test.ts`
- 9 条经验的手工 XML 构造(作为测试数据)
- 回归测试套件

**实现要点**:

为 9 条经验手工构造 XML:
1. read_file — 直通(无 pre/judgment)
2. read_file_with_default — 完整三段式(pre + judgment + 2 paths)
3. check_file_exists — pre + judgment
4. write_file — 直通
5. safe_write — pre + judgment + 2 paths
6. find_files — 直通
7. search_in_files — 直通
8. run_shell — 直通
9. replace_in_file — 多步链式

每条测试:
- XML 解析通过
- R1-R6 校验通过
- 编译为 L3 Experience
- 编译产物过 compileExperience
- 编译产物过 l1MainLoop 端到端执行
- 执行结果与原经验语义等价(输出值一致)

**验收标准**:
- 9 条经验全部通过 XML→L3→执行 回归
- 受限子集违规(R1-R6 各一例)被正确拒绝

**依赖**:F1.4, F1.5
**估算**:M(4-6h)

---

## 三、任务依赖图

```
F1.1 ──→ F1.2 ──→ F1.3 ──→ F1.4 ──→ F1.5
                    │                  │
                    └──→ F1.6 ←────────┘
```

**关键路径**:F1.1 → F1.2 → F1.3 → F1.4 → F1.5 → F1.6

**并行窗口**:F1.3(校验)开发时可同步准备 F1.6 测试数据(手工构造 XML)

---

## 四、Gate-F1 验收标准

| 验收项 | 标准 |
|--------|------|
| XML schema | 能表达现有 9 条经验的全部结构 |
| 解析器 | XML 文本 ↔ 结构化对象双向转换 |
| 校验器 | R1-R6 全部实现,合法/非法正确区分 |
| 编译器 | XML → L3 Experience 直接映射 |
| L3 合法性 | 编译产物过 compileExperience |
| 端到端执行 | 编译产物过 l1MainLoop |
| 9 条回归 | 全部通过 XML→L3→执行 回归 |

---

## 五、风险与对策

| 风险 | 严重度 | 对策 |
|------|--------|------|
| XML schema 无法表达现有 9 条经验的全部结构 | 🟡中 | F1.6 用 9 条经验做回归,发现缺口即调整 schema |
| 直接映射编译需要复杂结构变换 | 🟡中 | 确认是否在受限子集范围内;必要时放宽子集规则 |
| Expr AST 构造复杂(条件表达式) | 🟡中 | 参考 experience-library.ts 中的 errCodeIs/noError 辅助函数 |

---

## 六、进度追踪

| 任务 | 状态 | 开始时间 | 完成时间 | 备注 |
|------|------|----------|----------|------|
| F1.1 | ✅ 完成 | 2026-09-09 | 2026-09-09 | Zod schema,覆盖三类节点+参数来源+路径+元数据 |
| F1.2 | ✅ 完成 | 2026-09-09 | 2026-09-09 | fast-xml-parser,双向转换 |
| F1.3 | ✅ 完成 | 2026-09-09 | 2026-09-09 | R1-R6 全部实现,含违规测试用例 |
| F1.4 | ✅ 完成 | 2026-09-09 | 2026-09-09 | 直接映射编译,节点分类基于路径引用 |
| F1.5 | ✅ 完成 | 2026-09-09 | 2026-09-09 | 三层验证:XML架构+L3编译+端到端执行 |
| F1.6 | ✅ 完成 | 2026-09-09 | 2026-09-09 | 21 个测试全部通过,9 条经验回归 |
