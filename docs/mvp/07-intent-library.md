# 07 - 经验库与编译：从自然语言到 L1 的完整路径

> 自顶向下的完整架构：NL → LLM 业务意义识别 → 经验库匹配 → Experience 编译 → L2 微指令 → L1 原语。

本文档是 `06-execution-layer.md`（自底向上视角）的**互补文档**：从用户自然语言出发，描述到达硬件原语的完整路径。

> ⚠️ **本文档与 [10-reactive-execution-model.md](./10-reactive-execution-model.md) 的关系**：本文档定义 L3 的**词汇**（Experience / 三段式结构），doc 10 定义 L3 的**调用方式**（被 L1 按需调用，每次编译一层）。**关于"L3 如何被调用"，以 doc 10 为准**；本文档描述的是"L3 返回什么"。

> **2026-08-20 重写**：原"标准意图库（StandardIntent）+ DAG 节点"模型已重写为"经验库（Experience）+ 三段式"模型。
> 详见 [doc 12-experience-model.md](./12-experience-model.md) 完整设计响应。
> 主要变更：
> - 从"DAG 节点"改为"Experience 三段式"（pre-processing + conditional-judgment + target-op）
> - 从"内部嵌套 DAG"改为"经验间调用关系"
> - 从"统一 parameters"改为"skip-cost 参数（0-100 浮点）"
> - L3 不持有 LLM 能力（业务意义识别在 L3 之前完成）

---

## 决策摘要

从用户自然语言到 L1 原语的执行路径是一个**五层结构**：

| 层级 | 组件 | 输出 | 性质 |
|---|---|---|---|
| **L5** | 自然语言输入 | 文本 | 用户意图表达 |
| **L4** | LLM 语义理解 + 业务意义识别（**在 L3 之外完成**） | Intent（含 type + params） | **概率性** |
| **L3** | **经验库**（Experience）+ 三段式编译 | L2 操作序列 + 控制流 | **确定性** |
| **L2** | 业务微指令（operations） | 数据移动 / 计算结果 | **确定性** |
| **L1** | 5-Primitive RISC | 物理执行 | **确定性** |

**核心特征**：

1. **L4 是唯一概率性层**：LLM 负责"猜业务意义"，但只猜一次
2. **L3 是从概率性到确定性的桥梁**：匹配到经验后，路径完全确定
3. **L3 是经验结构**：每个 Experience = pre-processing + conditional-judgment + target-op
4. **叶节点一定是 L2**：Experience 内部最终都调用 L2 operations
5. **L2 → L1 是精确映射**：每个 L2 operation 都能精确展开为 L1 原语序列
6. **Conditional-Judgment → 控制流 primitive**：条件判断编译为 `execute_op` + `conditional_skip` + `skip_n` 组合
7. **skip-cost 参数控制跳过**：pre-processing 可由 skip-cost 跳过（0-100 浮点）

> **执行模型补充**：本文档描述 L3 的"形态"（Experience 结构、经验库）。具体如何被调用、何时分层编译、由 [doc 10](./10-reactive-execution-model.md) 定义：
> - L3 **不是**一次编完的 phase，而是被 L1 按需调用的 service
> - 每次调用只编译**一层**（返回 immediate children）
> - 递归编译由 L1 通过指令栈自然驱动
> - **DAG 条件分支编译**：if-then-else → `conditional_skip` + `skip_n` 组合
> - **错误处理走 DAG 条件分支**（错误作为数据 + DAG 条件处理）+ **L1 异常冒泡**（处置权在 L3 handleError）

### 与 doc 06 的关系

- **doc 06（自底向上）**：定义 L1 + L2 + L3（执行层视角的"指令序列"）
- **doc 07（自顶向下）**：定义 L4 + L3 + L2 + L1（系统视角的"完整路径"）
- 两个文档的 **L3 是同一概念的两种视图**：
  - doc 06 中 L3 = "L1/L2 序列"（已经展开的执行计划）
  - doc 07 中 L3 = "标准意图库 + DAG"（未展开的意图实现）

---

## 一、整体路径

```
用户自然语言输入
   │
   ▼
┌──────────────────────────────────────────────────────┐
│ L4: LLM 语义理解 + 意图识别 │
│ - 抽取意图类型、参数、修饰词 │
│ - 标注置信度与歧义点 │
└────────────────────────┬─────────────────────────────────┘
                         │ Intent { type, params, confidence }
                         ▼
┌──────────────────────────────────────────────────────┐
│ L3: 标准意图库匹配 │
│ - 在标准意图库中查找最匹配的条目 │
│ - 计算匹配置信度 │
│ - 未匹配 → 兜底走 bash │
└────────────────────────┬─────────────────────────────────┘
                         │ StandardIntent { name, params }
                         ▼
┌──────────────────────────────────────────────────────┐
│ L3: Experience 编译（一层）                  │
│ - Experience = pre-processing + conditional-judgment + target-op │
│ - 编译一层，返回 immediate children（StackEntry[]） │
│ - 递归编译由 L1 通过指令栈自然驱动                    │
└────────────────────────┬─────────────────────────────────┘
                         │ L2 operation 序列
                         ▼
┌──────────────────────────────────────────────────────┐
│ L2: 业务微指令执行 │
│ - 调用每个 L2 operation │
│ - 通过 L1 primitives 实现（精确映射） │
└────────────────────────┬─────────────────────────────────┘
                         │ 物理执行结果
                         ▼
                       结果
```

**关键观察**：L4 是唯一有"模糊性"的层。L3 一旦匹配成功，整条路径就是**图遍历**问题——确定性的。

---

## 二、L4：LLM 语义理解与意图识别

### 2.1 输入与输出

```typescript
// 输入
interface NaturalLanguageInput {
  text: string
  context?: {
    project_root?: string
    recent_intents?: string[]  // Experience ID 列表
    history?: Turn[]
  }
}

// 输出（LLM 生成的结构化意图）
interface RecognizedIntent {
  type: IntentType                    // 'read_file' | 'find_files' | ...
  semantic_params: {
    target?: string                    // 目标（文件、对象、命令）
    modifiers?: string[]              // 修饰词（"latest", "all", "today"）
    constraints?: string[]            // 约束（类型、范围）
  }
  confidence: number                  // 0-1，< 0.7 应触发澄清
  ambiguity_notes?: string[]          // 歧义点标注
  reasoning?: string                  // LLM 的推理说明（用于审计）
}

type IntentType =
  | 'read_file' | 'write_file' | 'edit_file'
  | 'find_files' | 'search_content'
  | 'execute_command' | 'git_operation'
  | 'install_dependencies' | 'run_tests'
  | 'unknown'                          // 兜底走 bash
```

### 2.2 LLM 的职责边界

| LLM 负责 | LLM 不负责 |
|---|---|
| 理解 NL 的字面意思 | 选择**具体**的实现路径 |
| 抽取意图类型与参数 | 决定**哪个子意图**被调用 |
| 标注歧义点 | 保证执行正确性 |
| 推断缺失的常识 | 处理**业务逻辑细节** |

**关键原则**：LLM 输出的"猜测"必须经过 L3 的**确定性验证**才能进入执行路径。

### 2.3 置信度处理

```typescript
function handleRecognition(result: RecognizedIntent): Action {
  if (result.confidence >= 0.85) {
    return { action: 'match', intent: result }
  } else if (result.confidence >= 0.5) {
    return { action: 'clarify', intent: result }
  } else {
    return { action: 'fallback', reason: 'low_confidence' }
    // → 走 bash，让 LLM 直连工具
  }
}
```

---

## 三、L3：经验库（Experience Library）

> **2026-08-20 重写**：原 §3 "标准意图库（Intent Library）"已重写为"经验库（Experience Library）"。
> 详见 [doc 12-experience-model.md](./12-experience-model.md) 完整设计响应。
>
> **设计哲学变更**：
> - 从"DAG 节点"模型改为"经验（Experience）"模型
> - 三段式结构：pre-processing + conditional-judgment + target-op
> - skip-cost 参数（0-100 浮点）控制跳过必要性
> - 经验之间通过调用关系形成 DAG（而非内部嵌套）
> - MVP 仅预定义，动态学习作为未来扩展

### 3.1 经验的概念

**经验**是 L3 持有的、有**业务意义**的可执行单元。每个经验对应一类用户可表达的任务，并有**确定性的执行结构**。

```typescript
// 经验定义（Experience）
interface Experience {
  /** 业务意义 ID（与 L4 LLM 识别的 type 对应） */
  id: string
  
  /** 业务描述（自然语言，用于匹配和文档） */
  description: string
  
  /** 输入参数 schema */
  inputs: Record<string, ParamSpec>
  
  /** 输出参数 schema */
  outputs: Record<string, ParamSpec>
  
  /** 前置处理（可选）—— 收集数据为条件判断做准备 */
  pre_processing?: PreProcessing[]
  
  /** 条件判断（可选）—— 决定 target-op 走哪条路径 */
  conditional_judgment?: ConditionalJudgment[]
  
  /** 目标操作（必有）—— 至少一个 base_op，可有多路径 */
  target_op: TargetOp
  
  /** 用户反馈历史（MVP 仅存储，不自动演化）*/
  feedback_history?: FeedbackRecord[]
}

// 三段式结构：
// ┌────────────────────────────────────────┐
// │ Pre-processing（前置处理）             │
// │ - 收集数据，不做判断                      │
// │ - 输出写入 internal 寄存器                │
// └────────────────────────────────────────┘ ↓
// ┌────────────────────────────────────────┐
// │ Conditional-Judgment（条件判断）        │
// │ - 基于前置数据 + skip-cost               │
// │ - 决定 target-op 路径                    │
// └────────────────────────────────────────┘ ↓
// ┌────────────────────────────────────────┐
// │ Target-Op（目标操作）                    │
// │ - 一个 base_op + 多路径                  │
// │ - 最小化原则：一个函数一个目标             │
// └────────────────────────────────────────┘
```

### 3.2 与"原子意图"的区别

| 维度 | 经验（Experience）| 原子意图（LLM 直连） |
|---|---|---|
| 数量 | **有穷**（MVP < 10） | 开放 |
| 实现 | **三段式结构**（确定） | LLM 选择工具（概率） |
| 保证 | 匹配成功 → 确定结果 | 无保证 |
| 适用 | 高频、明确的任务 | 探索性、创造性任务 |
| 演化 | feedback_history 累积（MVP 存储） | 无演化 |

**关键**：经验**不试图覆盖所有可能**。它只覆盖"高频 + 明确"的那部分。剩下的交给 LLM 直连（兜底）。

### 3.3 MVP 经验库（示例）

> **重要变更**：MVP 经验库起步**5-10 条**，**逐步添加**，避免一次性设计过多。

```typescript
// ────── 示例 1：read_file（简单经验，无前置处理）──

const readFileExp: Experience = {
  id: 'read_file',
  description: '读取指定文件的内容',
  
  inputs: {
    path: { type: 'path', required: true }
  },
  outputs: {
    content: { type: 'string', required: true }
  },
  
  // 无前置处理（直接执行目标 op）
  pre_processing: undefined,
  conditional_judgment: undefined,
  
  target_op: {
    base_op: 'file_read',
    default_path: 'normal',
    paths: [
      {
        id: 'normal',
        description: '正常读取',
        steps: [
          {
            operation: 'file_read',
            inputs: { path: { kind: 'input', name: 'path' } },
            outputs: { content: '$r_content' }
          }
        ]
      }
    ]
  }
}

// ────── 示例 2：read_file_with_default（带错误处理）──

const readFileWithDefaultExp: Experience = {
  id: 'read_file_with_default',
  description: '读取文件，不存在则使用默认内容',
  
  inputs: {
    path: { type: 'path', required: true },
    default_content: { type: 'string', required: false, default: '' }
  },
  outputs: {
    content: { type: 'string', required: true }
  },
  
  // 前置处理：尝试读取（用于错误检测）
  pre_processing: [
    {
      id: 'try_read',
      operation: 'file_read',
      inputs: {
        path: { kind: 'input', name: 'path' }
      },
      outputs: {
        content: { kind: 'register', name: '$r_content' },
        error: { kind: 'register', name: '$r_err' }
      },
      // skip_cost >= 50 时跳过此检查（调用方信任后续 op 会处理）
      skip_threshold: 50
    }
  ],
  
  // 条件判断：基于错误决定路径
  conditional_judgment: [
    {
      id: 'check_error',
      trigger: {
        source: 'preprocessing',
        source_id: 'try_read',
        condition_op: 'is_truthy',  // $r_err 是否为非空
        compare_value: true
      },
      then_path: 'file_not_found',
      else_path: 'normal'
    }
  ],
  
  // 目标操作：一个 base_op，两条路径
  target_op: {
    base_op: 'file_read',
    default_path: 'normal',
    paths: [
      {
        id: 'normal',
        description: '文件存在，使用读取结果",
        steps: [] // 前置处理已读取，直接直接用 $r_content
      },
      {
        id: 'file_not_found',
        description: '文件不存在，使用默认内容",
        steps: [
          {
            operation: 'move',  // 把 default_content 写入 $r_content
            inputs: {
              source: { kind: 'input', name: 'default_content' }
            },
            outputs: { content: '$r_content' }
          }
        ]
      }
    ]
  }
}

// ────── 示例 3：search_in_files（带跳过逻辑的前置处理）──

const searchInFilesExp: Experience = {
  id: 'search_in_files',
  description: '在匹配文件中搜索内容',
  
  inputs: {
    pattern: { type: 'string', required: true },
    file_pattern: { type: 'pattern', required: false, default: '*' }
  },
  outputs: {
    matches: { type: 'list<struct>', required: true }
  },
  
  // 前置处理：获取匹配文件列表
  pre_processing: [
    {
      id: 'find_files',
      operation: 'glob_match',
      inputs: {
        pattern: { kind: 'input', name: 'file_pattern' }
      },
      outputs: {
        matches: { kind: 'register', name: '$r_files' }
      },
      // 这个前置是必要的，不能跳过
      skip_threshold: 0
    }
  ],
  
  conditional_judgment: undefined, // 无条件走正常路径
  
  target_op: {
    base_op: 'grep_search',
    default_path: 'normal',
    paths: [
      {
        id: 'normal',
        description: '在文件列表中搜索",
        steps: [
          {
            operation: 'grep_search',
            inputs: {
              pattern: { kind: 'input', name: 'pattern' },
              path: { kind: 'preprocessing', preproc_id: 'find_files', output: 'matches' }
            },
            outputs: {
              matches: '$r_matches'
            }
          }
        ]
      }
    ]
  }
}
```

### 3.4 关键设计原则：经验库的有界性 + 最小化

**承诺 1**：MVP 阶段经验库条目数 **< 10**（起步），逐步添加。

理由：

- 多了说明业务边界划分有问题
- 维护成本指数级增长
- 应该用"调用关系"而非"增加条目"来扩展能力

**承诺 2**：每个经验**最小化**——一个函数一个目标。

理由：

- 简化测试和维护
- 易于演化（新增路径不影响核心 op）
- 复用通过"调用其他经验"实现，不增加内部复杂度

**调用关系**形成 DAG：

```
read_file_with_default
  ↓ 调用
  read_file (简单经验)

search_in_files
  ↓ 调用
  glob_match_files (简单经验)

run_project_tests
  ↓ 调用
  detect_project_type (智能选择)
    ↓ 调用
    check_node_project
    check_python_project
    check_rust_project
```

### 3.5 skip-cost 参数（0-100 浮点）

**目的**：描述"跳过此处理的必要性"，由 L3 之上的层决定。

**当前 MVP**：单个 `skip_cost: number`（0-100）。

```typescript
// 示例：传入 skip_cost = 80（高度宽松）
compile(readFileWithDefaultExp, {
  skip_cost: 80,
  intent: { type: 'read_file_with_default', params: {...} },
  state
})

// 编译时：
// skip_cost (80) >= pre_processing[0].skip_threshold (50)
// → 跳过前置处理 try_read
// → target_op 直接执行（如果没有前置，file_read ENOENT 会被处理）
```

**未来扩展**（MVP 不实现）：
```typescript
interface SkipCosts {
  skip_cost_execution?: number  // 执行成本（CPU/MEM）
  skip_cost_time?: number       // 时间成本（等待/IO）
  skip_cost_resource?: number    // 资源成本（磁盘/网络）
}
```

### 3.6 MVP 不实现：动态学习

**决策**：MVP 仅记录 `feedback_history`，**不实现自动调整经验结构**。

**理由**：
- 动态学习需要更复杂的反馈机制
- 人工 review 更可靠
- MVP 阶段专注于架构验证

**预留接口**：
```typescript
interface FeedbackRecord {
  timestamp: number
  feedback_type: 'precheck_added' | 'conditional_added' | 'path_added' | 'other'
  target: string  // 影响的元素 ID
  suggestion: string
  detail?: unknown
}
```

记录但不自动演化，未来 Phase 可实现。

---

## 四、经验匹配（Recognition → Matching）

> **2026-08-20 更新**：基于"业务意义识别在 L3 之前完成"的设计决策，L3 不引入 LLM 能力。
> 匹配阶段被重新设计为**简单查找**（based on 标准化 type），而非 LLM 语义相似度。

### 4.1 概念区分

| 步骤 | 输入 | 输出 | 性质 |
|---|---|---|---|
| **业务意义识别**（Recognition） | NL 文本 | RecognizedIntent（含 type + params） | 概率性（由 L4 LLM 完成） |
| **经验查找**（Lookup） | type 字符串 | Experience（库条目） | 确定性查找 |

**关键**：业务意义识别由 L4 LLM 完成（L3 之外）。L3 接收标准化 type（如 `read_file_with_default`），**直接查找**经验库。

### 4.2 查找算法

```typescript
function lookupExperience(
  type: string,
  library: Map<string, Experience>
): Experience | null {
  // MVP 简化：直接按 type 查找
  const exp = library.get(type)
  return exp ?? null

  // 未来扩展：模糊匹配（如果 L4 LLM 输出的 type 不在库中）
  // return findBestMatch(type, library)
}
```

### 4.3 查找的几种结果

| 查找结果 | 后续动作 |
|---|---|
| **找到经验** | 进入编译（详见 §5）|
| **找不到** | 返回错误或询问用户是否新增经验 |
| **多个匹配**（理论不发生，因为 type 是唯一标识）| 选择第一个；报告冲突 |

---

## 五、Experience 结构与编译

> **2026-08-20 重写**：原 §5 "DAG 结构与解析" 已重写为"Experience 结构与编译"。
> 详见 [doc 12-experience-model.md](./12-experience-model.md) 完整设计响应。
>
> **关键变更**：
> - 从"DAG 节点类型"（sequence / op / if / self_reference）改为"三段式"（pre-processing + conditional-judgment + target-op）
> - 经验之间通过**调用关系**形成 DAG（而非内部嵌套）
> - skip-cost 参数（0-100 浮点）控制跳过处理
> - MVP 仅预定义经验，动态学习作为未来扩展

### 5.1 Experience 的三段式结构

每个 Experience 由三个核心部分组成：

```
┌─────────────────────────────────────────┐
│ Pre-processing（前置处理）              │
│ - 收集后续条件判断所需的数据                │
│ - 不做"判断"本身                          │
│ - 输出写入 internal 寄存器                 │
│ - 可由 skip-cost 跳过                     │
└─────────────────────────────────────────┘
              ↓ (收集的数据)
┌─────────────────────────────────────────┐
│ Conditional-Judgment（条件判断）        │
│ - 基于前置处理的数据 + skip-cost         │
│ - 决定 target-op 走哪条路径              │
│ - 编译时翻译为 conditional_skip + skip_n │
└─────────────────────────────────────────┘
              ↓ (路径选择)
┌─────────────────────────────────────────┐
│ Target-Op（目标操作）                    │
│ - 必有，至少一个 base_op                  │
│ - 可有多路径（正常 + 异常）                │
│ - 最小化原则：一个函数一个目标              │
└─────────────────────────────────────────┘
```

### 5.2 Experience 与调用关系 DAG

**Experience 是平等的**，**通过调用关系形成 DAG**：

```
read_file_with_default (Experience)
  ↓ 调用
read_file (Experience)
  ↓ 调用
  (内部直接用 file_read op)

search_in_files (Experience)
  ↓ 调用
find_files_by_glob (Experience)
  ↓ 调用
  (内部直接用 glob_match op)
```

**为什么用调用关系而非内部嵌套**：

| 维度 | 调用关系（DAG） | 内部嵌套 |
|---|---|---|
| **复用性** | 多个调用者共享子经验 | 每处复制 |
| **测试性** | 子经验独立测试 | 需要父经验上下文 |
| **演化性** | 子经验升级 → 所有调用者受益 | 需要多处修改 |
| **最小化** | 每个经验保持最小 | 复杂经验难拆 |

### 5.3 按需编译与 L1 驱动递归

**关键**：L3 的 `compile(experience)` 只返回**一层 children**（immediate 子节点）。深度递归由 L1 调度器通过指令栈自然驱动。

```
compile(experience) → StackEntry[]
  ↓ L1 把 children 压入指令栈
  ↓ 执行每条 entry
  ├─ move → 执行 move primitive
  ├─ execute_op → 调用 L2 operation
  ├─ execute_intent → 再次调 compile(sub_experience)（递归）
  ├─ skip_n → 弹栈
  └─ conditional_skip → 条件弹栈
```

**L3 是 stateless service**：每次 compile 返回新 entries（带新 ID），不持有执行状态。L1 拥有完整的执行控制权（错误恢复、栈大小、allocator 等）。

### 5.4 编译算法（伪代码）

```typescript
function compileExperience(
  exp: Experience,
  intent: RecognizedIntent,
  options: { skip_cost: number },
  state: ExecutionState
): StackEntry[] {
  const entries: StackEntry[] = []
  
  // 1. 绑定输入参数：intent.params → internal 寄存器
  const inputBindings = bindInputs(exp.inputs, intent.params, state)
  entries.push(...inputBindings)
  
  // 2. 编译前置处理
  const preprocOutputs = new Map<string, Record<string, string>>()
  for (const preproc of exp.pre_processing ?? []) {
    if (options.skip_cost >= preproc.skip_threshold) {
      // 跳过此前置处理
      continue
    }
    // 生成 execute_op entry，输出写入 internal 寄存器
    const procEntries = compileOpStep(preproc, preproc.outputs, state)
    entries.push(...procEntries)
    // 记录前置处理输出映射（用于条件判断）
    preprocOutputs.set(preproc.id, preproc.outputs)
  }
  
  // 3. 编译条件判断 → 决定 target-op 路径
  const pathId = compileConditionalJudgment(
    exp.conditional_judgment ?? [],
    preprocOutputs,
    state
  )
  
  // 4. 编译 target-op 选定路径
  const path = exp.target_op.paths.find(p => p.id === pathId)
    ?? exp.target_op.paths.find(p => p.id === exp.target_op.default_path)!
  for (const step of path.steps) {
    entries.push(...compileOpStep(step, step.outputs, state))
  }
  
  return entries
}

// 条件判断编译：基于条件结果选择路径 ID
function compileConditionalJudgment(
  judgments: ConditionalJudgment[],
  preprocOutputs: Map<string, Record<string, string>>,
  state: ExecutionState
): string {
  // MVP：返回 default_path（或第一个匹配的 then_path）
  // 完整实现：根据 trigger 条件编译为 execute_op + conditional_skip
  for (const judgment of judgments) {
    // 编译条件 op（如 string_equals）
    const condReg = state.allocator.allocate()
    const condOpEntry = compileConditionOp(judgment.trigger, condReg, preprocOutputs, state)
    // TODO: 完整的 conditional_skip + skip_n 逻辑
    // MVP 简化：返回 default_path
    return judgment.else_path ?? 'normal'
  }
  return 'normal'
}
```

### 5.5 编译示例："读 README.md，不存在则用默认内容"

**输入**：
```typescript
const intent: RecognizedIntent = {
  type: 'read_file_with_default',
  params: { path: '/README.md', default_content: 'No README' }
}
const skip_cost = 30  // 中等跳过（小于前置 skip_threshold=50，所以执行前置）
```

**经验定义**（参考 §3.3 示例 2）：
- 前置处理：`try_read`（file_read，跳过阈值 50）
- 条件判断：`check_error`（基于 $r_err 决定路径）
- target-op：base_op='file_read'，路径 normal / file_not_found

**编译产物**（按 L1 调度顺序）：

```typescript
[
  // 1. 绑定输入参数
  { kind: 'move', from: literal('/README.md'), to: internal('$r0') },
  { kind: 'move', from: literal('No README'), to: internal('$r1') },
  
  // 2. 前置处理：file_read（写入 $r_content, $r_err）
  // skip_cost (30) < skip_threshold (50) → 执行
  { kind: 'execute_op', operation: 'file_read',
    inputs: { path: '$r0' },
    outputs: { content: '$r_content', error: '$r_err' } },
  
  // 3. 条件判断：检查 $r_err
  { kind: 'execute_op', operation: 'extract_error_code',
    inputs: { error: '$r_err' }, outputs: { code: '$r_err_code' } },
  { kind: 'execute_op', operation: 'string_equals',
    inputs: { a: '$r_err_code', b: literal('ENOENT') },
    outputs: { result: '$r_is_enoent' } },
  
  // 4. 条件判断：DAG 路径选择
  { kind: 'conditional_skip', conditionAddr: '$r_is_enoent', n: 2 },
  
  // 5. normal 路径：move $r_content → public "content" (如果走此路径)
  { kind: 'move', from: '$r_content', to: 'public(content)' },
  { kind: 'skip_n', n: 1 },
  
  // 6. file_not_found 路径：使用 default_content（如果走此路径）
  { kind: 'move', from: '$r1', to: 'public(content)' }
]
```

### 5.6 MVP 编译的简化路径

由于 MVP 阶段经验结构简单，C2 起步时仅实现：

```
完整 MVP:
  Pre-processing (完整) → Conditional-Judgment (完整) → Target-Op (完整)

起步 MVP (C2):
  Target-Op only (跳过 Pre-processing 和 Conditional-Judgment)
```

逐步扩展：
- **C2**: target_op 简单执行（无 pre-processing、无 conditional）
- **C3**: 加 pre-processing（collect 数据）
- **C4**: 加 conditional_judgment（多路径选择）
- **C5**: 加经验调用（DAG 嵌套）
- **C6**: 加 feedback 记录

### 5.7 Experience 可视化约定

```
┌────────────────────────────┐
│ Experience: read_file_with_default     │
│ in: path, default_content                │
│ skip_cost_sensitivity: medium             │
└─────┬────────────────────────┬───────────┘
      │ pre-processing          │ target-op
      ▼                          ▼
┌──────────────┐         ┌────────────────┐
│ try_read     │         │ paths:           │
│ op: file_read│         │ - normal         │
│ threshold:50 │         │   steps: []      │
│ → $r_content │         │ - file_not_found │
│ → $r_err     │         │   steps: [move] │
└──────┬───────┘         └────────────────┘
       │ data
       ▼
┌──────────────────┐
│ check_error       │
│ trigger: $r_err   │
│   is_truthy=true  │
│ then: not_found    │
│ else: normal       │
└──────────────────┘
```

每个组件可标注：**已编译**（绿色）、**跳过**（灰色）、**默认**（黄色）。

---

## 六、到 L2/L1 的映射

> ⚠️ **L1 角色重定义**：在本旧文档中，L1 被描述为"执行 Primitive 序列的执行器"。在响应式执行模型中（[doc 10](./10-reactive-execution-model.md)），L1 是**调度器**——维护异构指令栈，按 type 字段分发到 L2（op 执行）或 L3（intent 分解）。本节描述 L2/L1 接口的词汇级映射；具体执行模型以 doc 10 为准。

### 6.1 L2 的双重身份

L2 operations 在本系统中扮演**双重角色**：

1. **DAG 的叶节点**（本视角）：被标准意图作为"原子操作"调用
2. **可执行单元**（doc 06 视角）：每个 L2 operation 由 L1 primitives 实现

**关键洞察**：L2 的"原子性"是**从 L3 视角**看的。从 L1 视角看，L2 可以：
- 直接对应一个原生函数调用（**A 原子实现**）
- 展开为多个 L1 primitives（**B 微代码实现**）

L3 不关心这些实现细节，只把 L2 当作不可分的执行单元。

### 6.2 L1 映射的精确性

每个 L2 operation 必须能**精确映射**到 L1 primitives：

```typescript
// L2 operation 定义（doc 06）
interface Operation {
  name: string
  inputs: Record<string, ParamSpec>
  outputs: Record<string, ParamSpec>
  execute: (inputs, ctx) => Promise<outputs>
}

// L1 primitive 序列（doc 06）
type Primitive = Move | Execute

// 映射关系：
// 每个 L2 operation.execute 内部 = L1 primitive 序列调用
// 对 L3 / L4 完全透明
```

**为什么强调"精确"**：因为 L3 DAG 解析产生的 L2 序列必须能**确定性地执行**，不能有"近似"或"模糊"。

### 6.3 完整路径示例

```
用户说: "把 src/ 目录下所有 .ts 文件里的 console.log 替换成 logger.debug"

L4 (LLM):
  RecognizedIntent {
    type: 'edit_file',
    semantic_params: {
      target: 'src/**/*.ts',
      modifiers: ['recursive'],
      operation: 'string_replace',
      find: 'console.log',
      replace: 'logger.debug'
    },
    confidence: 0.9
  }

L3 (匹配):
  匹配到: edit_files_with_replace
  {
    file_pattern: '*.ts',
    find: 'console.log',
    replace: 'logger.debug'
  }

L3 (DAG 解析):
  edit_files_with_replace (composite)
  ├─ glob_match (*.ts, recursive=true)
  ├─ for each file:
  │   ├─ file_read
  │   ├─ string_replace
  │   └─ file_write

L2 (执行):
  execute(glob_match, ...) → $files
  for $file in $files:
    execute(file_read, path=$file) → $content
    execute(string_replace, ...) → $modified
    execute(file_write, path=$file, content=$modified) → $ok

L1 (物理执行):
  每个 L2 execute 内部 = move + execute primitives 序列
```

---

## 七、与现有架构的关系

### 7.1 与六层架构（doc 03）的对应

| 六层架构（doc 03） | 本文档视角 | 关系 |
|---|---|---|
| Layer 1 意图识别 | **L4** LLM 语义理解 | 完全相同 |
| Layer 2 上下文追踪 | 跨层关注点 | 在 L3 各处按需调用 |
| Layer 3 意图编译 | **L3** DAG 解析 | 本视角是 doc 03 Layer 3 的"图论"版本 |
| Layer 4 完整性分析 | L3 的子步骤 | 参数校验是 DAG 解析的一部分 |
| Layer 5 补全交互 | L3 的子步骤 | 参数补全是 DAG 解析的一部分 |
| Layer 6 执行 | **L2 + L1** | 与 doc 06 完全相同 |

**关键澄清**：doc 03 的 6 层是**翻译流水线**视角；本视图是**静态结构 + 数据流**视角。两者描述同一系统的不同侧面。

### 7.2 与执行层（doc 06）的对应

| doc 06 | 本文档 | 关系 |
|---|---|---|
| L1 2-Primitive RISC | L1 原语 | 完全相同 |
| L2 微代码 | L2 operations | 完全相同 |
| L3 指令序列 | L3 DAG（未展开）/ L2 序列（已展开） | 同一概念的两种状态 |
| 数据区 | 跨 L3/L2 | 同 |

**关系总结**：
- doc 06 定义**已经展开**的执行层（自底向上视角）
- 本文档定义**未展开**的意图结构（自顶向下视角）
- DAG 解析 = 把本视图的 L3 转化为 doc 06 视角的 L3

### 7.3 与 MVP 04 的对照

| MVP 04 | 本文档 | 改进 |
|---|---|---|
| 意图识别 + 规则编译 | 意图识别 + DAG 解析 | 规则变图，更灵活 |
| 编译规则 < 50 条 | 标准意图 < 50 个 + DAG 子节点 | 边界更清晰 |
| 规则匹配 + 展开 | 意图匹配 + DAG 解析 | 术语更精确 |
| 5 大核心能力 | 5 层架构（L1-L5） | 视角更完整 |

---

## 八、关键决策

### D1. 为什么意图库是有穷的？

**决策**：MVP 阶段意图库条目 < 50。

**理由**：
- LLM 匹配准确率随库大小下降（噪声增多）
- 维护成本指数级增长
- "高频 + 明确"的意图本身就有限
- 剩下的应交给 LLM 直连（bash 兜底）

**反模式**：试图把所有"可能的意图"都列进库。

### D2. 为什么匹配单独于识别？

**决策**：识别（LLM）与匹配（确定性）是两个独立步骤。

**理由**：
- 关注点分离：LLM 负责"猜"，系统负责"确认"
- 可测试性：匹配可独立单元测试
- 可演化：未来匹配可以用更精确的方法（embedding / 规则），不需要改 LLM

### D3. 为什么 DAG 不是树？

**决策**：标准意图的实现是 DAG，允许子意图共享。

**理由**：
- `find_files` 这个子意图可被 `search_in_files`、`list_log_files`、`count_files` 共享
- 共享节点只执行一次，结果缓存
- 修改共享节点 → 所有调用者受益

### D4. 为什么 LLM 不能直接调用 L2？

**决策**：L4（LLM）只能输出 RecognizedIntent，**不能直接调用 L2 operations**。

**理由**：
- LLM 选择 L2 = 概率性选择，可靠性低
- L3 匹配后调用 L2 = 确定性调用，可靠性高
- LLM 只需要负责"理解意图"，不需要懂"如何实现"
- 这样可以独立升级 L4（换更好的 LLM）和 L2（加新 operation）而不互相影响

**反例**：如果 LLM 直接调 `file_read`，会出现：
- LLM 选错路径（如读了错误的文件）
- LLM 漏调步骤（如忘了 sort）
- LLM 重复调同一 L2

### D5. 为什么子节点可以是 L2 或子意图？

**决策**：标准意图的子节点可以是 L2 operation 或子标准意图。

**理由**：
- L2 提供了"原子"能力（无可再分）
- 子意图提供了"复合"能力（可复用业务逻辑）
- 混合使用让意图库更灵活

### D6. 为什么叶节点一定是 L2？

**决策**：DAG 的叶节点一定是 L2 operation，不允许直接是 L1 primitive。

**理由**：
- L2 是业务的"原子单位"（如"读文件"）
- L1 是硬件的"原子单位"（如"move"、"execute"）
- L3 DAG 关心业务结构，不应关心硬件细节

---

## 九、与相关系统的对比

### 9.1 与 MCP / Function Calling 的对比

| 维度 | MCP / Function Calling | 本设计 |
|---|---|---|
| 工具数量 | 开放 | **有穷**（< 50 标准意图） |
| 工具描述 | 自由形式 | **结构化 schema** |
| 调用方式 | LLM 选择 | **DAG 解析** |
| 组合能力 | 由 LLM 临时拼接 | **预定义 + 共享** |
| 失败模式 | LLM 选错工具 | 匹配失败 → bash 兜底 |

**关键区别**：本设计把"如何组合"从 LLM 移到系统层，让 LLM 只负责"识别意图"。

### 9.2 与 LangGraph / 状态机的对比

| 维度 | LangGraph | 本设计 |
|---|---|---|
| 节点 | 任意操作 | **标准意图 / L2 operation** |
| 边 | 条件转移 | **参数依赖** |
| 状态 | 全局状态 | **数据流（参数绑定）** |
| 复杂度 | 显式图编程 | **声明式 DAG** |

**关键区别**：本设计的图是**数据流图**（参数流向），不是**控制流图**（跳转）。

### 9.3 与 pi 工具系统的对比

| 维度 | pi 工具 | 本设计 |
|---|---|---|
| 工具数量 | 4 + N 扩展 | **8 内置 + 意图库** |
| 选择方式 | LLM 直选 | **匹配 → DAG** |
| 组合 | LLM 临时组合 | **预定义 DAG** |
| 业务理解 | 无 | **意图库语义化** |

**关键区别**：本设计在 pi 之上加了"业务意图层"，让 LLM 不再需要懂工具组合。

---

## 十、开放问题

### 10.1 DAG 的并行执行

DAG 的某些子节点可以**并行执行**（无依赖关系）。例如：

```
A ── B
   ╲ ╱
    C
```

但 MVP 阶段所有节点**线性执行**。是否需要并行？

**当前决策**：MVP 串行，避免复杂度。

### 10.2 子意图的循环依赖与递归循环支持

**问题**：DAG 静态结构应无环（避免意图定义中的循环引用），但循环**意图**如何表达？

**决策**：两种不同的"循环"：

| 类型 | 含义 | 是否允许 |
|---|---|---|
| **静态引用环** | Experience A 的 target_op 调用 A 自己 | ❌ 不允许（拓扑排序检测）|
| **运行时递归** | Experience A 的条件判断后调用 A 自己（self_reference） | ✅ 允许（详见 [doc 10 §六.5](./10-reactive-execution-model.md)）|

**静态引用环检测**：

```typescript
function detectCycles(library: Map<string, Experience>): void {
  // 拓扑排序检测
  // Experience 间的调用关系不形成环
}
```

**运行时递归示例**：

```yaml
intent: retry_until_success
dag:
  body:
    - file_read
    - increment_counter('$attempts')
  termination:
    - check_max(5)
  on_continue:
    - self_reference: retry_until_success  # ⭐ 运行时递归
```

**L3 编译结果**：

```typescript
[
  { kind: 'execute_op', operation: 'file_read', ... },
  { kind: 'execute_op', operation: 'increment_counter', ... },
  { kind: 'execute_op', operation: 'check_max', ... },
  { kind: 'conditional_skip', conditionAddr: '$should_continue', n: 1 },
  { kind: 'execute_intent', intent: retry_until_success }  # ⭐ self-reference
]
```

**安全性**：
- L1 默认递归深度限制为 1000（A11 实现）
- 超限抛 Error（防御）

**详细 Walkthrough**见 [doc 10 §六.5](./10-reactive-execution-model.md)。

### 10.3 上下文推断的归属

`run_project_tests` 需要知道"项目用 npm 还是 cargo"。这是：

- **A. LLM 在 L4 推断**（"用户说 npm test → 推断 npm"）
- **B. 标准意图自己推断**（读取 package.json）
- **C. 独立的 context layer**（集中管理）

**当前决策**：倾向 B（标准意图自包含，调用 `shell_exec` 时由 L2 operation 推断）。

### 10.4 DAG 节点的中间结果缓存

如果 DAG 中有共享节点（如 `find_files` 被多个子意图调用），结果应**只执行一次**。

**当前决策**：DAG 解析时按节点去重（共享的子节点只解析一次）。

### 10.5 意图版本管理

意图库升级时（如 `read_file` 的实现变化），旧调用怎么办？

**当前决策**：MVP 暂不处理。未来通过 schema 版本管理（与 doc 06 的 operation schema 一致）。

---

## 十一、设计意图一页纸

### 完整路径

```
NL → L4 (LLM) → L3 (意图库匹配) → L3 (DAG 解析) → L2 → L1
   │    │            │                  │              │    │
   │    │            │                  │              │    └─ 物理执行
   │    │            │                  │              └─ 8 个业务 microcode
   │    │            │                  └─ 递归展开为 L2 序列
   │    │            └─ 在 < 50 个标准意图中查找
   │    └─ 唯一的概率性层
   └─ 用户输入
```

### 核心原则

1. **L4 是唯一模糊层**：LLM 一次猜测，不让它负责更多
2. **L3 是桥梁**：从概率性到确定性的转换点
3. **DAG 而非树**：支持共享、缓存、独立测试
4. **L2 是叶**：业务原子单位
5. **精确映射**：L2 → L1 无近似

### 关键不变量

- L1 词汇表 = 2 primitive（永久不变）
- L2 vocabulary = 8 内置 operations（核心不变，扩展可加）
- L3 标准意图库 = < 50 条（有界，可演化）
- L4 模型 = 可替换（任何 LLM）

### MVP 范围

- **L4**：1 个 LLM 集成（GPT-4 / Claude）
- **L3**：5-10 个核心标准意图（read_file、edit_file、search、run_tests 等）
- **L2**：8 个内置 operations（file_read、file_write、glob_match 等）
- **L1**：2 primitives（move、execute）
- **匹配**：embedding + 规则混合
- **DAG 解析**：纯函数式展开

### 演进路径

```
阶段 1: 5-10 个标准意图，L4 用现成 LLM
阶段 2: 20-30 个标准意图，引入 embedding 匹配
阶段 3: 40-50 个标准意图，支持子意图共享、版本管理
阶段 4: 动态生成 DAG（LLM 辅助）
```

---

## 十二、参考与交叉引用

- **doc 02** 翻译层假说：解释了为什么 LLM 翻译不可靠，需要 L3 确定性层
- **doc 03** 分层架构：本视图与 doc 03 的 6 层视角互补
- **doc 04** MVP 范围：本视图细化了 MVP 五大能力的 L3 部分
- **doc 06** 执行层设计：定义 L1/L2 的精确规范，本文档的 L1/L2 直接引用
- **doc 05** 实施路线图：本视图的实施策略见 05