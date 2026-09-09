# Phase F4 — LLM 对话驱动编辑(Web 应用,可写)

> **Phase 目标**:LLM 对话理解用户意图 → 操作指令 → XML 节点/DAG 概念节点 CRUD → 三层验证 → 人审入库
> **Gate-F4**:LLM 对话 → 操作指令 → XML CRUD → 三层验证 → 人审入库
> **计划文档**:[doc 20](../../docs/mvp/20-experience-design-tool.md) | [主任务计划](../README.md)
> **状态**:未开始

---

## 一、核心设计

### 1.1 LLM 对话驱动的编辑模式

DAG 编辑不通过 UI 拖拽,而是通过 LLM 对话理解用户意图,映射到对 XML 节点和 DAG 概念节点的 CRUD 操作:

```
用户对话输入                         LLM 理解意图
"在读取文件后加一步检查文件大小"  →   在 read_file 节点后插入 evaluate_expr 节点
"把替换节点的 find 参数改成 'foo'" →   修改 string_replace 节点的 find 参数
"删除条件判断节点"                →   删除条件节点及其分支
"加一个错误处理:文件不存在时返回默认值" → 添加条件分支 + 默认值节点
"读取 CSV 文件并统计行数"          →   从空白创建:file_read + evaluate_expr 组合
```

### 1.2 LLM 输出格式:结构化操作指令

LLM 输出的是操作指令(JSON),非直接 XML 文本:

```json
{
  "operations": [
    { "type": "add_node", "node": { "kind": "op", "opName": "evaluate_expr", "id": "calc_size" } },
    { "type": "connect", "from": "read_file.content", "to": "calc_size.input.expr" },
    { "type": "set_literal", "node": "calc_size", "param": "expr", "value": "len(content.split('\\n'))" }
  ]
}
```

后端收到操作指令 → 应用到 XML DOM → 校验 → 返回结果。

### 1.3 三层验证

操作后的验证流程(必须全部通过才能入库):

```
① R1-R6 受限子集校验(XML 架构完整性)
② compileExperience 编译(L3 合法性)
③ l1MainLoop 试执行(端到端)
```

任一层失败 → LLM 自动修正(≤3 轮)。

---

## 二、任务分解

### F4.1 — LLM 操作指令 schema 定义

**目标**:定义 LLM 可输出的全部操作指令类型。

**输入**:doc 20 §2.2(LLM 操作粒度)

**输出**:
- `web/shared/llm-operations.ts`:Zod schema + TypeScript 类型

**实现要点**:

操作指令类型:

```typescript
type LlmOperation =
  // 节点 CRUD
  | { type: 'add_node'; node: NodeSpec; afterNode?: string }     // 在某节点后插入
  | { type: 'remove_node'; nodeId: string }
  | { type: 'update_node'; nodeId: string; changes: Partial<NodeSpec> }

  // 参数连接
  | { type: 'connect'; from: PortRef; to: PortRef }             // from → to
  | { type: 'disconnect'; from: PortRef; to: PortRef }

  // 参数值
  | { type: 'set_literal'; nodeId: string; param: string; value: Value }
  | { type: 'clear_literal'; nodeId: string; param: string }

  // 顺序关系
  | { type: 'set_order'; nodeId: string; afterNode: string }

  // 分支结构
  | { type: 'add_branch'; conditionNodeId: string; varName: string; thenPath: string; elsePath: string }
  | { type: 'remove_branch'; conditionNodeId: string }

  // 路径
  | { type: 'add_path'; pathId: string; response: string }
  | { type: 'remove_path'; pathId: string }
  | { type: 'add_step_to_path'; pathId: string; nodeId: string }
  | { type: 'remove_step_from_path'; pathId: string; nodeId: string }

  // 元数据
  | { type: 'update_metadata'; changes: Partial<ExperienceMetadata> }

interface NodeSpec {
  kind: 'op' | 'experience' | 'condition'
  id: string
  opName?: string           // op 节点
  experienceId?: string     // 经验节点
  varName?: string          // 条件节点关联的变量
}

interface PortRef {
  nodeId: string
  port: string              // 输入/输出端口名
}
```

- Zod schema 校验操作指令合法性
- 操作指令是原子性的(每条指令独立可执行)

**验收标准**:
- schema 能校验全部操作指令类型
- 非法操作(未知类型/缺失字段)被拒绝

**依赖**:无(可早开工)
**估算**:M(3-4h)

---

### F4.2 — LLM 客户端(LiteLLM 代理)

**目标**:实现 LLM API 客户端,连接 LiteLLM 代理服务。

**输入**:doc 20 §8.4(LLM 接入配置)

**输出**:
- `web/server/services/llm-client.ts`
- `web/server/llm-config.json`:配置文件

**实现要点**:

配置文件:
```json
{
  "llm": {
    "baseUrl": "http://127.0.0.1:4000",
    "apiKeyEnv": "LITELLM_MASTER_KEY",
    "model": "gpt-4o-mini",
    "temperature": 0.2,
    "maxTokens": 4096
  }
}
```

客户端接口:
```typescript
interface LlmClient {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<LlmResponse>
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatOptions {
  responseFormat?: 'text' | 'json'    // structured output
  temperature?: number
}

interface LlmResponse {
  content: string
  parsedJson?: unknown               // responseFormat='json' 时解析
  usage: { promptTokens: number; completionTokens: number }
}
```

实现:
- HTTP 客户端调用 `http://127.0.0.1:4000/v1/chat/completions`
- API Key 从 `process.env.LITELLM_MASTER_KEY` 读取
- 支持 JSON mode(structured output)
- 错误处理:连接失败/超时/非 200 状态码

**验收标准**:
- 能连接 LiteLLM 代理并发送 chat 请求
- 能解析 JSON mode 响应
- 配置文件可调整模型/参数

**依赖**:无(可早开工)
**估算**:M(3-4h)

---

### F4.3 — Prompt 设计

**目标**:设计 system prompt,让 LLM 理解经验设计任务并输出操作指令。

**输入**:F4.1(操作指令 schema)、F4.2(LLM 客户端)、F1.1(XML schema)

**输出**:
- `web/server/services/llm-prompt.ts`:prompt 构造函数

**实现要点**:

System prompt 组成:

```
你是一个经验设计助手。你的职责是理解用户对经验设计的描述,
输出结构化操作指令来修改经验的 XML 定义。

## 当前经验状态
<当前 XML 文本或结构化摘要>

## 可用 L2 op 清单
<op 名 + formalSpec inputs/outputs>

## 可用经验清单(作为经验节点引用)
<经验 ID + description + inputs/outputs>

## 操作指令格式
你必须输出 JSON,格式为 { "operations": [...] }
操作指令类型:
- add_node: 添加节点
- remove_node: 删除节点
- connect: 连接参数
- set_literal: 设置字面量
...

## 规则
1. 每次输出 1-3 个操作指令(小步修改)
2. 操作指令必须引用当前 XML 中存在的节点 ID
3. 新节点需要指定唯一 ID
4. 参数连接必须类型兼容
```

- prompt 包含当前 XML 状态(完整或摘要)
- prompt 包含可用 op/经验清单(从 L2Registry + ExperienceStore 获取)
- few-shot 示例(2-3 个对话→操作指令示例)

**验收标准**:
- prompt 包含完整上下文(当前状态 + 可用清单 + 指令格式)
- LLM 能理解简单指令("加一步检查文件大小")

**依赖**:F4.1, F4.2, F1.1
**估算**:M(3-4h)

---

### F4.4 — LLM 对话 → 操作指令

**目标**:用户对话 → LLM 理解意图 → 输出结构化操作指令(JSON)。

**输入**:F4.3(prompt)

**输出**:
- `web/server/services/llm-agent.ts`
- 函数:`processUserMessage(message: string, context: ConversationContext): Promise<LlmOperation[]>`

**实现要点**:

对话流程:
1. 构造 system prompt(F4.3)
2. 拼接对话历史(最近 10 轮)
3. 调用 LLM(JSON mode)
4. 解析响应为 `LlmOperation[]`
5. Zod 校验操作指令合法性

```typescript
interface ConversationContext {
  experienceId: string | null         // null = 新建经验
  currentXml: string                  // 当前 XML 状态
  history: ChatMessage[]               // 对话历史
  availableOps: OpInfo[]               // 可用 L2 op
  availableExperiences: ExperienceInfo[]  // 可用经验
}
```

- LLM 响应解析失败 → 返回错误,前端提示用户换说法
- 操作指令校验失败 → 进入 F4.7 反馈循环

**验收标准**:
- "加一步检查文件大小" → 输出 add_node + connect 操作指令
- "删除条件节点" → 输出 remove_node 操作指令
- 对话历史保持上下文(多轮修改)

**依赖**:F4.3
**估算**:M(3-4h)

---

### F4.5 — 操作指令执行器

**目标**:接收操作指令 → 应用到 XML DOM → 生成新 XML。

**输入**:F4.1(操作指令 schema)、F1.2(XML 解析器)

**输出**:
- `web/server/services/operation-executor.ts`
- 函数:`applyOperations(xml: XmlExperience, ops: LlmOperation[]): { result: XmlExperience; changes: Change[] }`

**实现要点**:

执行器逻辑:
1. 解析当前 XML 为 XmlExperience 对象
2. 逐条应用操作指令(原子操作)
3. 每条操作生成 Change 记录(用于 DAG 高亮)
4. 序列化回 XML 文本

操作执行规则:
- `add_node`:在 nodes 数组中添加节点;若指定 afterNode,调整顺序
- `remove_node`:从 nodes 移除;清理相关连接和路径步骤
- `connect`:建立参数连接(from → to)
- `disconnect`:移除参数连接
- `set_literal`:设置节点参数的字面量值
- `add_branch`:添加条件分支节点
- `remove_branch`:移除条件分支节点
- `add_path`/`remove_path`:路径 CRUD
- `update_metadata`:更新元数据

错误处理:
- 引用不存在的节点 ID → 返回错误
- 类型不兼容 → 返回错误
- 操作冲突 → 返回错误

**验收标准**:
- add_node + connect 能正确添加节点和连接
- remove_node 能正确删除节点和相关连接
- 操作失败时返回结构化错误

**依赖**:F4.1, F1.2
**估算**:M(4-5h)

---

### F4.6 — 三层验证

**目标**:操作后自动跑三层验证(XML 架构 + L3 编译 + 端到端执行)。

**输入**:F4.5(操作执行器)、F1.3(受限子集校验)、F1.4(编译器)、F1.5(编译产物校验)

**输出**:
- `web/server/services/validation-pipeline.ts`
- 函数:`validateExperience(xml: XmlExperience, registry: L2RegistryLike): ValidationResult`

**实现要点**:

三层验证流水线:
```typescript
interface ValidationResult {
  layer1_xml: { valid: boolean; errors: ValidationError[] }      // R1-R6
  layer2_l3: { valid: boolean; errors: string[] }                // compileExperience
  layer3_exec: { valid: boolean; errors: string[] }             // l1MainLoop
  overall: boolean
}

async function validateExperience(
  xml: XmlExperience,
  registry: L2RegistryLike
): Promise<ValidationResult> {
  // Layer 1: XML 架构完整性(R1-R6)
  const layer1 = validateXmlExperience(xml)

  // Layer 2: L3 编译合法性
  const l3 = compileXmlToL3(xml)
  const layer2 = validateCompiledL3(l3, registry)

  // Layer 3: 端到端执行
  const layer3 = await runEndToEnd(l3, registry)

  return { layer1, layer2, layer3, overall: layer1.valid && layer2.valid && layer3.valid }
}
```

- 三层独立执行,任一层失败不影响其他层结果
- 返回全部三层的错误信息(供 LLM 修正参考)

**验收标准**:
- 合法 XML 全部三层通过
- R1-R6 违规 → Layer 1 失败
- 编译非法 → Layer 2 失败
- 执行异常 → Layer 3 失败

**依赖**:F4.5, F1.3, F1.4, F1.5
**估算**:S(2-3h)

---

### F4.7 — 校验反馈循环

**目标**:任一层验证失败 → 反馈 LLM → 修正操作 → 再校验(自动迭代 ≤3 轮)。

**输入**:F4.6(三层验证)

**输出**:
- 集成到 `web/server/services/llm-agent.ts`

**实现要点**:

反馈循环流程:
```
1. LLM 输出操作指令
2. 执行操作 → 生成新 XML
3. 三层验证
4. 若失败:
   a. 构造反馈消息(含失败层 + 错误详情)
   b. 追加到对话历史
   c. 调用 LLM 生成修正操作
   d. 回到步骤 2
5. 若成功:返回最终 XML
6. 若 3 轮仍失败:返回错误,交人工处理
```

反馈消息格式:
```
上一步操作失败,验证结果:
- Layer 1 (XML 架构): 失败 — R2 树形结构违规:节点 "calc_size" 有 2 个前驱
- Layer 2 (L3 编译): 未执行(Layer 1 失败)
- Layer 3 (端到端): 未执行

请修正操作指令。
```

**验收标准**:
- 验证失败时自动反馈 LLM
- 3 轮内修正成功
- 3 轮仍失败返回错误

**依赖**:F4.6
**估算**:M(3-4h)

---

### F4.8 — DAG 可视化刷新

**目标**:操作后 DAG 实时刷新,高亮变更节点/边。

**输入**:F4.5(操作执行器)、F3.6(DAG 可视化)

**输出**:
- 更新 `web/client/src/components/DagViewer.tsx`
- 新增 `web/client/src/components/LlmChat.tsx`

**实现要点**:

- 操作执行后返回 Change 记录
- DAG 刷新时高亮变更的节点/边(闪烁或变色)
- 3 秒后高亮消失

Change 记录:
```typescript
interface Change {
  type: 'add' | 'remove' | 'update'
  targetType: 'node' | 'edge' | 'metadata'
  targetId: string
}
```

**验收标准**:
- 操作后 DAG 实时刷新
- 变更节点/边高亮
- 高亮 3 秒后消失

**依赖**:F4.5, F3.6
**估算**:S(2-3h)

---

### F4.9 — 从空白创建

**目标**:自然语言描述场景 → LLM 生成完整 XML 草稿(新建经验)。

**输入**:F4.4(LLM 对话)

**输出**:
- 集成到 `web/server/services/llm-agent.ts`
- 前端"新建经验"入口

**实现要点**:

新建经验流程:
1. 用户提供经验描述("读取 CSV 文件并统计行数")
2. LLM 生成初始 XML 草稿(完整结构)
3. 三层验证
4. 若失败 → F4.7 反馈循环
5. 若成功 → 进入人审预览

与修改现有经验的区别:
- context.experienceId = null
- currentXml = 空模板
- LLM 需要生成完整结构(而非增量操作)

**验收标准**:
- "读取 CSV 文件并统计行数" → 生成 file_read + evaluate_expr 组合
- 草稿通过三层验证
- 进入人审预览

**依赖**:F4.4
**估算**:M(3-4h)

---

### F4.10 — 查重提示

**目标**:生成前模糊搜索相似经验,提示"已有类似经验,是否仍新建"。

**输入**:F4.9(从空白创建)、F2.6(搜索 API)

**输出**:
- 集成到前端新建流程

**实现要点**:
- 用户输入描述后,调用搜索 API 查相似经验
- 若有相似经验(score > 0.5),提示用户
- 用户可选择:仍新建 / 查看现有 / 修改现有

**验收标准**:
- 输入"读取文件"时提示已有 read_file
- 用户可选择仍新建或查看现有

**依赖**:F4.9, F2.6
**估算**:S(1-2h)

---

### F4.11 — 人审入库

**目标**:预览确认 → 保存 XML + 编译 L3 + 写入文件系统。

**输入**:F4.6(三层验证)、F2.2(文件系统存储)

**输出**:
- 前端"入库"按钮 + 后端保存 API

**实现要点**:

入库流程:
1. 三层验证全部通过
2. 前端展示最终预览(DAG + XML + L3 JSON)
3. 用户点击"入库"
4. 后端保存 XML + metadata.json 到文件系统
5. 编译 L3 Experience 保存(可选,运行时编译)
6. 刷新经验列表

API:
```
POST /api/experiences
Body: { id, xml, metadata }
→ 200 { success: true, id }
→ 400 { error: "validation failed", details: ValidationResult }
```

- 入库前再次跑三层验证(防止前端绕过)
- id 冲突检查

**验收标准**:
- 入库后经验出现在列表中
- 文件系统含新经验的 XML + metadata.json
- 新经验可通过 l1MainLoop 执行

**依赖**:F4.6, F2.2
**估算**:S(2-3h)

---

### F4.12 — 测试

**目标**:LLM 对话生成/修改经验 → 过三层验证全部通过。

**输入**:F4.1-F4.11 全部完成

**输出**:
- `web/tests/phase-f4.test.ts`

**测试用例**:

| 测试 | 场景 | 预期 |
|------|------|------|
| 修改现有经验 | "在 read_file 后加一步检查文件大小" | 操作指令 → XML 更新 → 三层验证通过 |
| 从空白创建 | "读取 CSV 文件并统计行数" | 生成 XML 草稿 → 三层验证通过 |
| 查重提示 | 输入"读取文件" | 提示已有 read_file |
| 反馈循环 | 故意输入导致 R2 违规的操作 | LLM 自动修正(≤3 轮) |
| 入库 | 修改后入库 | 文件系统更新 + 列表刷新 |
| 三层验证 | 合法 XML | 全部通过 |
| 三层验证 | R1-R6 违规 | Layer 1 失败 |
| 三层验证 | 编译非法 | Layer 2 失败 |
| 三层验证 | 执行异常 | Layer 3 失败 |

**验收标准**:全部测试通过

**依赖**:F4.7
**估算**:M(3-4h)

---

## 三、任务依赖图

```
F4.1 ──→ F4.3 ──→ F4.4 ──→ F4.5 ──→ F4.6 ──→ F4.7
         ↑         ↑         ↑         ↑
F4.2 ─────┘         │         │         ├──→ F4.8
F1.1 ───────────────┘         │         ├──→ F4.9 ──→ F4.10
F1.2 ──────────────────────────┘         ├──→ F4.11
F1.3 ──────────────────────────────────────┘
F1.4 ──────────────────────────────────────┘
F1.5 ──────────────────────────────────────┘
                                          └──→ F4.12
```

**关键路径**:F1.1 → F1.2 → F1.3 → F1.4 → F4.6 → F4.7 → F4.12

**并行窗口**:
- F4.1(操作指令 schema)∥ F4.2(LLM 客户端)可早开工
- F4.8(DAG 刷新)∥ F4.9(从空白创建)∥ F4.10(查重)∥ F4.11(入库)

---

## 四、Gate-F4 验收标准

| 验收项 | 标准 |
|--------|------|
| LLM 对话 | 用户对话 → LLM 输出操作指令 |
| 操作执行 | 操作指令 → XML CRUD → DAG 刷新 |
| 三层验证 | XML 架构 + L3 编译 + 端到端 全部通过 |
| 反馈循环 | 验证失败 → LLM 自动修正(≤3 轮) |
| 从空白创建 | 自然语言 → 完整 XML 草稿 |
| 查重提示 | 相似经验提示 |
| 人审入库 | 预览确认 → 文件系统保存 |
| 端到端 | 入库的新经验可通过 l1MainLoop 执行 |

---

## 五、风险与对策

| 风险 | 严重度 | 对策 |
|------|--------|------|
| LLM 输出的操作指令经常非法 | 🟡中 | F4.3 prompt 提供完整当前 XML 状态 + 可用清单;F4.7 自动迭代 |
| LLM 对复杂 DAG 修改的理解准确率低 | 🟡中 | F4.4 拆分多轮对话,每轮聚焦一个操作 |
| 本地模型 structured output 效果差 | 🟡中 | F4.2 改为 JSON mode + 后处理解析;增加 few-shot |
| 三层验证耗时过长 | 🟢低 | Layer 3 端到端执行设超时(5s) |

---

## 六、进度追踪

| 任务 | 状态 | 开始时间 | 完成时间 | 备注 |
|------|------|----------|----------|------|
| F4.1 | 未开始 | — | — | — |
| F4.2 | 未开始 | — | — | — |
| F4.3 | 未开始 | — | — | — |
| F4.4 | 未开始 | — | — | — |
| F4.5 | 未开始 | — | — | — |
| F4.6 | 未开始 | — | — | — |
| F4.7 | 未开始 | — | — | — |
| F4.8 | 未开始 | — | — | — |
| F4.9 | 未开始 | — | — | — |
| F4.10 | 未开始 | — | — | — |
| F4.11 | 未开始 | — | — | — |
| F4.12 | 未开始 | — | — | — |
