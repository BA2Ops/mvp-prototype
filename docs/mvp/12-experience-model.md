# L3 经验（Experience）模型设计响应

**日期**：2026-08-20
**作者**：与 pi coding agent 协同
**触发**：基于用户对 L3 设计哲学的澄清（"经验"模型 vs 原"DAG 节点"模型）

---

## 一、设计动机

### 原设计的不足

原 doc 07 / doc 10 / doc 11 的 L3 设计基于 **DAG 节点模型**：

```typescript
interface StandardIntent {
  name: string
  implementation:
    | { kind: 'composite', children: ChildNode[] }
    | { kind: 'sequence', operations: L2Ref[] }
}
```

这种设计的隐含假设：
- DAG 节点类型有限（sequence / op / if / self_reference）
- 意图的"结构"是固定的、可枚举的
- L3 是"翻译器"（DAG → L1 指令）

但**这种模型无法表达用户提出的核心需求**：
- 经验需要**成长**（前置判断/条件决策随用户反馈累积）
- "跳过某些前置"的灵活度（不同成本类型）
- 经验内部"多路径处理正常/异常数据"

### 新设计：经验（Experience）模型

L3 持有大量"经验"，每个经验对应一个**业务意义**（如"读取文件"）。用户的"经验"模型有三个核心部分：

```
┌────────────────────────────────────────────────────┐
│ Pre-processing（前置处理）                       │
│ - 收集后续条件判断所需的数据                       │
│ - 不做"判断"本身                                  │
│ - 输出写入 internal 寄存器                          │
└────────────────────────────────────────────────────┘ ↓ 数据
┌────────────────────────────────────────────────────┐
│ Conditional-Judgment（条件判断）                   │
│ - 基于前置处理的数据 + skip-cost 参数                │
│ - 决定 DAG 路径结构                                  │
│ - 逻辑规则链                                       │
└────────────────────────────────────────────────────┘ ↓ 路径
┌────────────────────────────────────────────────────┐
│ Target-Op（目标操作）                              │
│ - 必有，至少一个核心 op                              │
│ - 一个目标基础 op（最小化原则）                       │
│ - 多个路径处理正常/异常数据                          │
└────────────────────────────────────────────────────┘
```

---

## 二、设计决策

### D-XP-1：L3 不持有 LLM 能力

**决策**：业务意义识别在 L3 之前完成。L3 是纯执行引擎（编译 + 运行）。

**理由**：
- L3 关注"编译与执行"，LLM 关注"理解与生成"
- LLM 推理成本高、不可控，不适合放在核心执行层
- 业务意义的输出是"标准化 ID"（如 `read_file`），由 L4 LLM 输出

**接口影响**：`L3Service.compile(intent)` 接收的 `RecognizedIntent` 已包含标准化的 `type`（如 `read_file`），无需 LLM 再处理。

### D-XP-2：经验是预定义 + 动态学习（MVP 仅预定义）

**决策**：MVP 阶段只实现预定义部分，**动态学习作为未来扩展**。

**预定义部分**（MVP）：
- 内置 `< 50` 条经验
- 每个经验有固定结构（pre-processing + conditional-judgment + target-op）
- 用户反馈可被记录但**不影响运行时行为**

**动态学习**（未来）：
- 用户反馈触发经验结构调整
- 前置处理 / 条件判断累积
- 目标 op 的错误分支后续 op 累积

**MVP 简化**：
- 反馈记录保留数据结构（`feedback_history`）但**不实现自动演化**
- 演化依赖人工 review 或后续 Phase

### D-XP-3：skip-cost 参数（0-100 浮点）

**决策**：使用浮点型 0-100 描述"跳过必要性"。

**当前 MVP**：单个 `skip_cost: number` 参数（0-100）。

**未来扩展**：可能多个参数：
```typescript
interface SkipCosts {
  skip_cost_execution?: number  // 执行成本
  skip_cost_time?: number       // 时间成本
  skip_cost_resource?: number    // 资源成本
}
```

**语义**：
- `0` = 必须执行（不能跳过）
- `100` = 完全可忽略（永远跳过）
- 中间值 = 平衡决策

**参数来源**：由 L3 之上的层决定，**不是经验内部**：
- L4 LLM 根据用户意图判断（"快速预览" vs "严谨处理"）
- 用户显式参数（`strict: true`）
- 配置文件 / 环境变量

### D-XP-4：前置处理（Pre-processing）的语义修正

**原表述**：前置判断（precheck）—— 失败时 skip 或 fallback。

**新表述**：前置处理（pre-processing）—— **收集数据**为后续条件判断做准备。

**关键区别**：
- **不**做"判断"本身（判断是 conditional-judgment 的职责）
- **不**做"fail-fast"拦截
- 仅收集数据（写入 internal 寄存器）

**示例**：
```
读 README.md 的前置处理：
  - shell_exec('wc -l README.md') → 收集行数到 $r_line_count
  - file_read('README.md') → 收集内容到 $r_content
  - glob_match('README.md') → 收集元数据到 $r_meta

条件判断（基于前置处理的数据）：
  - if $r_line_count > 1000 then "使用分块读取" else "直接读取"
  - if $r_err exists then "走 fallback 路径"
```

### D-XP-5：条件判断（Conditional-Judgment）的语义

**实质**：一系列逻辑规则，**决定自身所属的有向图的逻辑路径结构**。

**关键洞察**：条件判断不是"判断后做事"，而是"决定 DAG 走哪条边"。

**结构**：
```typescript
interface ConditionalJudgment {
  // 触发条件（基于前置处理的数据）
  trigger: Expr  // JSON 树形表达式（由 L3 编译器生成，不是 LLM 输入）
  // 触发的路径（正常 or 异常）
  then: TargetOpPath
}
```

**与原 conditional（conditional_skip）的区别**：
- 原 conditional_skip 是 **L1 运行时指令**（弹栈控制流）
- 条件判断是 **L3 编译时结构**（决定 DAG 路径）
- 编译时把条件判断翻译为 L1 指令序列

### D-XP-6：目标 op（Target-Op）的最小化原则

**决策**：每个经验**只针对一个目标基础 op**，可有多路径处理。

**理由**：
- 一个函数一个目标（Single Responsibility）
- 简化测试和维护
- 易于演化（新增路径不影响核心 op）

**结构**：
```typescript
interface TargetOp {
  // 核心基础 op（一个函数一个目标）
  base_op: string  // L2 op 名称
  
  // 多路径处理（正常 + 异常）
  paths: TargetOpPath[]
  
  // 当前路径选择（编译时或运行时）
  default_path?: string  // 默认路径 ID
}

interface TargetOpPath {
  id: string           // 路径 ID（如 'normal', 'enoent', 'permission_denied'）
  trigger?: TriggerRef // 什么条件下走此路径
  steps: OpStep[]      // 此路径的执行步骤
}
```

### D-XP-7：经验之间的调用关系形成 DAG

**决策**：L3 中每个经验是**平等的**，**通过调用关系形成 DAG**。

**约束**：
- 经验 A 可以调用经验 B（嵌套）
- 调用深度有限制（防递归无限循环）
- 每个经验保持最小化（一个目标）

**示例**：
```
read_file (经验)
  ↓ 调用
check_file_exists (经验) ← 简单，不嵌套
  ↓ 调用
get_metadata (经验) ← 更简单，只做 stat
```

**DAG vs 嵌套的语义差异**：
- 嵌套 = 父子关系（一个经验内部包含另一个）
- DAG = 调用关系图（更松散）
- 当前设计选 DAG（更灵活）

### D-XP-8：Phase C 的实施顺序

**决策**：从最简单开始，逐步扩展支持更多预期行为。

**建议的 Phase C tier 划分**：

```
C1: Experience 数据结构定义
    - types/experience.ts 定义 Experience / PreProcessing / ConditionalJudgment / TargetOp
    - 测试 Experience 数据结构正确性

C2: Target-Op 简单执行（无 pre-processing、无 conditional）
    - compile(exp) → 直接展开 target_op.base_op 为 execute_op entry
    - 测试 1-2 个简单经验（read_file, shell_exec）

C3: Pre-Processing
    - compile(exp) → 生成 pre-processing 的 execute_op entries + 结果写入寄存器
    - skip_cost 参数控制是否跳过某些前置
    - 测试 pre-processing 收集数据的能力

C4: Conditional-Judgment 编译
    - compile(exp) → 生成条件判断的 L1 指令（execute_op + conditional_skip + skip_n）
    - 编译时把条件判断翻译为 DAG 路径选择
    - 测试多路径选择

C5: 经验调用（DAG 嵌套）
    - 经验 A 内部调用经验 B
    - execute_intent 嵌套 + allocator 单调递增
    - 测试嵌套调用

C6: 反馈记录（不实现自动演化）
    - feedback_history 数据结构
    - 用户反馈记录接口
    - MVP 阶段不改变经验行为

C7: 标准经验库
    - 内置 5-10 条核心经验（read_file, shell_exec, search_in_files 等）
    - 测试覆盖各种结构
```

---

## 三、完整数据结构定义

```typescript
// ============== Experience（经验）=======================

/**
 * L3 经验：有业务意义的可执行单元
 *
 * 业务意义由 L3 之上的层识别（通常是 L4 LLM），L3 接收标准化的 type 查找经验。
 */
interface Experience {
  /** 业务意义 ID（与 L4 LLM 识别的 type 对应） */
  id: string
  
  /** 业务描述（自然语言，用于匹配和文档） */
  description: string
  
  /** 输入参数 schema */
  inputs: Record<string, ParamSpec>
  
  /** 输出参数 schema */
  outputs: Record<string, ParamSpec>
  
  /** 前置处理（可选）—— 收集数据 */
  pre_processing?: PreProcessing[]
  
  /** 条件判断（可选）—— 决定路径 */
  conditional_judgment?: ConditionalJudgment[]
  
  /** 目标操作（必有）—— 至少一个 base_op */
  target_op: TargetOp
  
  /** 用户反馈历史（MVP 仅记录，不演化） */
  feedback_history?: FeedbackRecord[]
  
  /** 元数据 */
  metadata?: ExperienceMetadata
}

interface ExperienceMetadata {
  /** 经验的 skip-cost 敏感性（用于优化跳过决策） */
  skip_cost_sensitivity?: 'low' | 'medium' | 'high'
  
  /** 估计的执行成本 */
  estimated_cost?: number
}

// ============== Pre-Processing（前置处理）=============

/**
 * 前置处理：收集数据，不做判断
 *
 * 收集结果写入 internal 寄存器，供后续 conditional_judgment 使用。
 */
interface PreProcessing {
  /** 处理 ID（在经验内唯一） */
  id: string
  
  /** L2 op 名称 */
  operation: string
  
  /** 输入参数（来自 experience.inputs 或字面量） */
  inputs: Record<string, ParamRef>
  
  /** 输出参数（写入 internal 寄存器） */
  outputs: Record<string, ParamRef>
  
  /**
   * 跳过阈值（0-100 浮点）
   *
   * 当外部传入的 skip_cost >= skip_threshold 时，此前置被跳过。
   * skip_threshold = 0 意味着"必须执行"
   * skip_threshold = 100 意味着"永远可跳过"
   */
  skip_threshold: number
}

// ============== Conditional-Judgment（条件判断）=======

/**
 * 条件判断：基于前置处理的数据，决定 target_op 走哪条路径
 *
 * 编译时翻译为 L1 指令序列：
 * - execute_op(evaluate_expr) （2026-08-20 重构后：单 op 替代原多 op 链）
 * - conditional_skip + skip_n（DAG 路径选择）
 */
/**
 * 判断触发器：表达式树
 *
 * **重要变更**（2026-08-20 重构）：原 design 用 condition_op + compare_value 描述条件。
 * 现重构为 Expr JSON 树（与 [doc 06 §7.2.1 evaluate_expr](./06-execution-layer.md#721-表达式求值-opevaluate_expr-2026-08-20-重构) 一致）。
 *
 * - 编译产物单一：`execute_op(evaluate_expr, { expr: trigger }, { result: $r_cond })` + conditional_skip
 * - 表达式由 L3 编译器生成，**不来自 LLM**
 * - 支持任意嵌套逻辑、比较、位运算、错误码提取等
 */
interface ConditionalJudgment {
  /** 判断 ID（在经验内唯一） */
  id: string

  /** 触发条件：JSON 表达式树 */
  trigger: Expr

  /** 条件为真时走的目标路径 ID */
  then_path: string

  /** 条件为假时走的目标路径 ID（可选，默认 normal） */
  else_path?: string
}

/**
 * Expr：表达式 AST（与 evaluate_expr op 输入一致）
 */
type Expr =
  | { type: 'literal'; value: Value }
  | { type: 'var'; name: string }                       // 读 internal 寄存器
  | { type: 'op'; name: OpName; args: Expr[] }          // 操作符调用
  | { type: 'if'; cond: Expr; then: Expr; else: Expr }  // 三元（短路）

// ============== Target-Op（目标操作）===================

/**
 * 目标操作：核心 + 多路径
 *
 * 一个 target_op 对应一个目标基础 op，但可有多个路径（正常 + 异常）。
 */
interface TargetOp {
  /** 核心基础 op（L2 op 名称） */
  base_op: string
  
  /** 路径列表（必有，至少一个 'normal' 路径） */
  paths: TargetOpPath[]
  
  /** 默认路径 ID（默认 'normal'） */
  default_path: string
}

interface TargetOpPath {
  /** 路径 ID（唯一） */
  id: string
  
  /** 此路径的描述 */
  description: string
  
  /** 执行步骤 */
  steps: OpStep[]
}

interface OpStep {
  /** L2 op 名称 */
  operation: string
  
  /** 输入参数 */
  inputs: Record<string, ParamRef>
  
  /** 输出参数（写入 internal 寄存器） */
  outputs: Record<string, ParamRef>
}

// ============== ParamRef（参数引用）====================

/**
 * 参数引用：如何获取参数值
 *
 * 三种来源：
 * - literal: 字面量
 * - input: 来自 experience.inputs
 * - preprocessing / register: 来自前置处理输出或寄存器
 */
type ParamRef =
  | { kind: 'literal'; value: Value }
  | { kind: 'input'; name: string }
  | { kind: 'register'; name: string }
  | { kind: 'preprocessing'; preproc_id: string; output: string }

// ============== FeedbackRecord（反馈记录）==============

/**
 * 用户反馈记录（MVP 仅存储，不自动演化）
 */
interface FeedbackRecord {
  timestamp: number
  feedback_type: 'precheck_added' | 'conditional_added' | 'path_added' | 'other'
  target: string  // 影响的元素 ID
  suggestion: string
  detail?: unknown
}

// ============== L3Service 扩展接口 ======================

/**
 * L3 Service 接口（Phase C 扩展）
 */
interface L3Service {
  /**
   * 编译经验为 L1 指令序列
   */
  compile(
    intent: RecognizedIntent,
    state: ExecutionState
  ): Promise<StackEntry[]>
  
  /**
   * 获取经验定义（by id）
   */
  getExperience(id: string): Experience | null
  
  /**
   * 记录用户反馈（MVP 仅存储）
   */
  recordFeedback(id: string, feedback: FeedbackRecord): Promise<void>
  
  /**
   * 列出所有经验
   */
  listExperiences(): Experience[]
}
```

---

## 四、调用示例：读取 README.md

### 4.1 经验定义

```typescript
const readFileExp: Experience = {
  id: 'read_file',
  description: '读取指定文件的内容',
  
  inputs: {
    path: { type: 'path', required: true }
  },
  outputs: {
    content: { type: 'string', required: true }
  },
  
  // 前置处理：收集文件元数据
  pre_processing: [
    {
      id: 'check_exists',
      operation: 'file_read',  // 用于触发 ENOENT 错误以判断文件是否存在
      inputs: {
        path: { kind: 'input', name: 'path' }
      },
      outputs: {
        content: { kind: 'register', name: '$r_content' },
        error: { kind: 'register', name: '$r_err' }
      },
      // skip_cost >= 50 时跳过（"严格验证" 模式下才检查）
      skip_threshold: 50
    }
  ],
  
  // 条件判断：基于错误决定路径
  conditional_judgment: [
    {
      id: 'check_enoent',
      trigger: {
        // 表达式：error_code($r_err) == 'ENOENT'
        type: 'op',
        name: '==',
        args: [
          { type: 'op', name: 'error_code', args: [{ type: 'var', name: '$r_err' }] },
          { type: 'literal', value: 'ENOENT' }
        ]
      },
      then_path: 'file_not_found',  // 错误时走 fallback 路径
      else_path: 'normal'
    }
  ],
  
  // 目标操作：一个 base_op，多路径
  target_op: {
    base_op: 'file_read',
    default_path: 'normal',
    paths: [
      {
        id: 'normal',
        description: '文件存在，直接使用前置处理收集的内容',
        steps: [
          {
            operation: 'move',  // 简化：直接把前置处理结果移到输出
            inputs: { content: { kind: 'preprocessing', preproc_id: 'check_exists', output: 'content' } },
            outputs: { content: { kind: 'register', name: '$r_content' } }
          }
        ]
      },
      {
        id: 'file_not_found',
        description: '文件不存在，抛出业务错误',
        steps: [
          {
            operation: 'shell_exec',
            inputs: {
              command: { kind: 'literal', value: 'echo "File not found"' }
            },
            outputs: {}
          }
        ]
      }
    ]
  }
}
```

### 4.2 编译产物（执行 user "读 README.md"，skip_cost = 30）

```typescript
// skip_cost = 30 < skip_threshold = 50，前置处理执行
// skip_cost = 30，条件判断也执行（用于决定路径）

const entries = [
  // 1. 前置处理：file_read（可能 ENOENT）
  { kind: 'execute_op', operation: 'file_read', ... },
  
  // 2. 条件判断：检查 $r_err.code === 'ENOENT'
  // 原 design（多 op 链）：
  //   execute_op(extract_error_code) → execute_op(string_equals)
  // 现重构（单 op 表达式求值）：
  { kind: 'execute_op', operation: 'evaluate_expr',
    inputs: { expr: { type: 'op', name: '==', args: [
      { type: 'op', name: 'error_code', args: [{ type: 'var', name: '$r_err' }] },
      { type: 'literal', value: 'ENOENT' }
    ]}},
    outputs: { result: '$r_is_enoent', error: '$r_err2' } },
  
  // 3. 条件判断：DAG 路径选择
  // 如果 $r_is_enoent 为真，跳过 normal 路径
  { kind: 'conditional_skip', conditionAddr: '$r_is_enoent', n: 2 },
  
  // 4. normal 路径：move 前置处理结果
  { kind: 'execute_op', operation: 'move', ... },
  { kind: 'skip_n', n: 1 },
  
  // 5. file_not_found 路径：echo
  { kind: 'execute_op', operation: 'shell_exec', ... }
]
```

### 4.3 编译产物（skip_cost = 80，跳过所有前置）

```typescript
// skip_cost = 80 >= 50，前置处理被跳过
// $r_content 未设置 → 文件不存在的语义由 file_read ENOENT 反映

const entries = [
  // 跳过前置处理
  
  // 条件判断仍然执行？还是也跳过？
  // 设计选择：条件判断必执行（它是 DAG 结构决策，不是 fail-fast 检查）
  
  // 1. 直接 file_read
  { kind: 'execute_op', operation: 'file_read', inputs: { path: '$r0' }, outputs: { content: '$r_content', error: '$r_err' } },
  
  // 2. 条件判断
  ...
]
```

---

## 五、关键设计对比

### 5.1 与原 StandardIntent 模型对比

| 维度 | 原 StandardIntent | 新 Experience |
|---|---|---|
| **核心结构** | DAG（sequence / composite） | 三段式（pre-processing + conditional + target-op）|
| **业务意义** | 隐含（name 字段） | 显式（id 字段 + description） |
| **成长性** | 静态（改 StandardIntent 定义）| 半动态（feedback_history 累积，MVP 不演化）|
| **跳过机制** | 无 | skip_cost 参数控制 |
| **最小化** | 不强制 | 一个函数一个目标原则 |
| **DAG 形成** | 内部 DAG 节点 | 经验之间的调用关系 |
| **错误处理** | conditional_judgment + skip_n | target_op 多路径 + conditional_judgment |

### 5.2 与 doc 07 原 §3 的差异

| 原 §3 | 新 §3 |
|---|---|
| §3.1 StandardIntent 概念 | Experience 概念（含三段式结构）|
| §3.2 与"原子意图"的区别 | 保留 |
| §3.3 MVP 标准意图库示例 | 重写为 MVP 标准经验库示例 |
| §3.4 有界性原则 | 保留，补充 MVP < 10 条经验起步 |

### 5.3 与 doc 07 原 §5 的差异

| 原 §5（DAG 结构与解析） | 新 §5（Experience 结构与编译） |
|---|---|
| §5.1 DAG 概念 | Experience 结构与调用关系 |
| §5.2 为什么是 DAG 而非树 | 为什么是调用关系而非嵌套 |
| §5.3 DAG 模板与按需分解 | Experience 编译：pre-processing + conditional + target-op |
| §5.4 解析示例 | 重写：read_file 编译示例 |
| §5.5 DAG 可视化 | Experience 可视化（三段式图）|

---

## 六、文档更新计划

### 6.1 doc 07 重写

| 章节 | 操作 |
|---|---|
| §3 L3 标准意图库 → L3 经验库 | 完全重写（三段式 + skip_cost + 反馈） |
| §5 DAG 结构与解析 → Experience 结构与编译 | 完全重写 |
| §4 意图匹配（保留识别在 L3 之前）| 小幅更新：标准化 type |
| §6 到 L2/L1 的映射 | 小幅更新：formalSpec + register 映射 |

### 6.2 doc 11 Phase C 重写

| Tier | 内容（建议） |
|---|---|
| C1 | Experience 数据结构定义 |
| C2 | Target-Op 简单执行（无 pre-processing、无 conditional）|
| C3 | Pre-Processing + skip_cost 参数 |
| C4 | Conditional-Judgment 编译（多路径选择）|
| C5 | 经验调用（DAG 嵌套）|
| C6 | 反馈记录（MVP 不演化）|
| C7 | 标准经验库（5-10 条核心经验）|

### 6.3 doc 10 §四 L3 服务契约更新

| 内容 | 操作 |
|---|---|
| L3Service.compile(intent, state) | 保留 + 添加 state 参数 |
| getExperience(id) | 新增 |
| recordFeedback(id, feedback) | 新增 |
| listExperiences() | 新增 |
| compileExperience(exp, state) | 新增（内部 API）|

### 6.4 doc 06 §十一 §3 Operation

| 内容 | 操作 |
|---|---|
| Operation 形参元数据 | 保留 |
| §11.3 错误恢复 | 关联：target_op 多路径处理 |

---

## 七、MVP 边界（不做的事）

| 不做 | 理由 |
|---|---|
| **动态学习/自动调整经验结构** | MVP 仅记录反馈，不改变运行时行为 |
| **skip-cost 多维化** | MVP 单参数（`skip_cost: number`），未来扩展 |
| **LLM 调用（业务意义识别）** | 由 L3 之前的层处理 |
| **并行执行** | MVP 单线程顺序，未来扩展 |
| **经验版本管理** | MVP 内置 < 10 条，预定义 |
| **跨经验状态共享** | 每个经验通过 internal 寄存器 + publicStore 通信 |

---

## 八、影响的下游

### 8.1 A8 (execute_intent primitive)

A8 将使用新的 `L3Service.compile(intent, state)` 接口：
- **state 参数**必须（用于 allocator 访问）
- 返回的 StackEntry[] 包含 pre-processing + conditional + target-op 编译结果

### 8.2 Phase B（真实 L2 ops）

Phase B 实现的 L2 ops 应支持 Experience 模型的引用：
- 每个 op 应有 `formalSpec` 声明其输入/输出
- pre-processing / conditional / target-op 通过 formalSpec 引用 op

### 8.3 用户反馈接口

MVP 阶段提供 `recordFeedback` 接口：
- L3 之上的层（UI / L4 LLM）可调用
- 不触发经验结构调整
- 仅存储到数据结构

---

## 九、总结

新 Experience 模型的核心价值：
1. **更接近人类认知**：业务意义 + 成长性，符合"经验积累"心智
2. **明确三段式**：pre-processing / conditional / target-op 职责清晰
3. **灵活跳过**：skip_cost 0-100 多维成本适应未来
4. **最小化原则**：一个函数一个目标，便于测试和维护
5. **DAG 形成**：通过调用关系而非内部嵌套，更灵活
6. **演化路径**：feedback_history 为未来动态学习铺路

下一步：
1. 更新 doc 07 §3、§5（最大变更）
2. 更新 doc 11 Phase C 计划
3. 更新 doc 10 §四 L3 服务契约
4. 进入 A8（execute_intent），使用新接口实现 L1 → L3 集成点