# 04 - MVP 范围与核心能力

> 基于"长期 LLM 栈会有大量变更"的判断，定义 MVP 的最小核心能力。

---

## 核心判断

**前提**：长期来看，整个 LLM 处理栈必然有大量变更（模型、provider、SDK、协议都会演化）。

**结论**：MVP 不追求完整性，追求**可测试的最小核心**。每一层都应该**独立可替换**，以便未来演进。

---

## MVP 五大核心能力

按依赖顺序：

```
┌──────────────────────────────────────────┐
│ 5. 补全交互 (用户接口层)                  │ ← 最后做，可替换
├──────────────────────────────────────────┤
│ 4. 完整性分析 (检测缺口)                  │  ← 纯逻辑
├──────────────────────────────────────────┤
│ 3. 意图编译 (Intent → Instructions)      │  ← 核心创新
├──────────────────────────────────────────┤
│ 2. 上下文追踪 (项目状态、用户历史)         │  ← 基础设施
├──────────────────────────────────────────┤
│ 1. 基础指令 (Primitives) + 意图识别       │  ← 词汇定义
└──────────────────────────────────────────┘
```

---

## 能力 1：意图识别

**职责**：NL → Intent 类型 + 语义参数

**关键设计**：
- 封闭意图枚举（< 20 种）
- 标注置信度
- 显式声明歧义点

**MVP 范围**：

```typescript
type IntentType = 
  | 'read_file' | 'write_file' | 'edit_file'
  | 'find_files' | 'search_content'
  | 'execute_command' | 'git_operation'
  | 'install_dependencies' | 'run_tests'
  | 'unknown';

interface Intent {
  type: IntentType;
  confidence: number;
  semantic_params: {
    target?: string;
    modifiers?: string[];
    constraints?: string[];
  };
  ambiguity_notes?: string[];
}
```

**关键决策**：
- 集合必须有界 → 开放意图走"unknown → bash" 兜底
- 承认不可翻译性比假装能做更重要

---

## 能力 2：基础指令 Primitives

**职责**：定义小而正交的指令词汇（编译层的目标语言）

**关键设计**：
- **正交性**：每个 primitive 不可由其他 primitives 表达
- **可组合性**：通过 `compose` 表达复合操作
- **可验证性**：每个 primitive 有明确 schema + 验证规则

**MVP 范围**：

```typescript
type PrimitiveInstruction =
  | { kind: 'read_file', args: { path: string, encoding?: string, range?: [number, number] } }
  | { kind: 'write_file', args: { path: string, content: string } }
  | { kind: 'edit_file', args: { path: string, find: string, replace: string } }
  | { kind: 'list_files', args: { pattern: string, recursive: boolean } }
  | { kind: 'search_content', args: { pattern: string, path: string, context: number } }
  | { kind: 'execute', args: { command: string, cwd?: string, timeout?: number } }
  | { kind: 'compose', args: { steps: PrimitiveInstruction[] } };
```

**为什么强调"正交"**：避免意图展开时出现"组合爆炸"和"循环依赖"。

---

## 能力 3：上下文追踪

**职责**：维护翻译所需的项目状态、用户历史、推断参数

**关键设计**：
- 显式 vs 推断 vs 派生的区分
- turn 历史压缩策略（避免无限增长）

**MVP 范围**：

```typescript
interface TranslationContext {
  explicit: Record<string, any>;    // 用户明确提供的参数
  inferred: {                        // 从项目推断
    language?: string;
    build_system?: string;
    test_runner?: string;
    project_root?: string;
  };
  derived: Record<string, any>;      // 从前序指令派生的
  history: Array<{                   // turn 历史（压缩）
    intent: Intent;
    instructions: PrimitiveInstruction[];
    result: 'success' | 'failure';
  }>;
}
```

**为什么必须有**：
- 编译层需要"pattern 默认是 *.log 还是 *.{log,txt}？"——来自上下文
- 完整性分析需要"用户之前说过 cwd 在哪里"——来自上下文
- 没有上下文追踪，前四层无法工作

---

## 能力 4：意图编译

**职责**：Intent → Instruction 序列（核心创新）

**关键设计**：
- 规则驱动，确定性映射优先
- LLM 只在规则不覆盖时介入
- 规则集可扩展（新增意图 = 新增规则）

**MVP 范围**：

```typescript
interface CompilationRule {
  intent_pattern: IntentPattern;
  preconditions: (ctx: Context) => void;
  expand: (intent: Intent, ctx: Context) => PrimitiveInstruction[];
}
```

**示例**：

```typescript
const rules: CompilationRule[] = [
  {
    intent_pattern: { type: 'read_file', modifiers: ['latest'] },
    expand: (intent, ctx) => [
      { kind: 'list_files', args: { pattern: extractLogPattern(intent), recursive: true }, 
        required_params: ['pattern', 'location'] },
      { kind: 'sort_results', args: { by: 'mtime', desc: true }, required_params: [] },
      { kind: 'take_first', args: {}, required_params: [] },
      { kind: 'read_file', args: { path: '<derived>' }, required_params: ['path'] }
    ]
  },
  // 5-10 个核心规则起步
];
```

**关键决策**：
- 规则必须是**确定性**的（不是 LLM 提示词）
- 规则数量 < 50（多了说明意图集合划分有问题）
- 每条规则必须有单元测试

---

## 能力 5：完整性分析 + 补全交互（拆分）

**职责**：检测参数缺口 + 用户澄清

**关键设计**：**拆成两个独立能力**：

### 5a. 完整性分析（纯逻辑）

```typescript
interface CompletenessReport {
  complete: boolean;
  missing: Array<{
    instruction_index: number;
    param: string;
    source: 'missing' | 'ambiguous' | 'needs_clarification';
    suggestion?: string;
  }>;
}

function analyzeCompleteness(
  instructions: PrimitiveInstruction[],
  context: TranslationContext
): CompletenessReport {
  // 纯确定性逻辑
}
```

**特性**：
- 单元可测试
- 形式化可验证
- 与 UI 完全解耦

### 5b. 补全交互（UX 层）

```typescript
async function fillCompleteness(
  report: CompletenessReport,
  ui: UserInterface
): Promise<CompletedInstructions | null>;
```

**特性**：
- 可替换实现（CLI / Web / Voice）
- MVP 可用最小文本提示
- 未来升级 UI 不影响分析逻辑

**为什么必须拆开**：
- 完整性分析是纯逻辑——独立测试、形式化
- 补全交互是 UX——会随时间演化
- MVP 可以先做完整性分析，后期升级 UI 不影响分析

---

## 必须推迟的能力

不要进 MVP，避免范围蔓延：

| 能力 | 为什么推迟 |
|---|---|
| 多轮意图状态机 | 太复杂，先做单轮翻译 |
| 跨会话记忆 | 持久化层是单独的大工程 |
| 自动工具发现 | 手动维护工具列表更可控 |
| 意图分类的 LLM 替代品（规则/微调模型） | 第一版用现成 LLM，后期优化 |
| 复杂复合意图的自动分解 | 规则的 `compose` 已覆盖简单情况 |
| 撤销 / 重做 | pi 已有的 `/tree` 可复用 |
| 自动学习 | 需要数据闭环，超出 MVP 范围 |
| 跨平台 schema 统一 | 先支持一种 OS |

---

## MVP 必须包含的非功能性基础设施

能力之外，**这些基础设施同等重要**：

### 1. 测试语料（必备）

```typescript
// tests/corpus/intent-recognition.test.ts
const testCases = [
  { input: "读 README.md", 
    expected: { type: 'read_file', params: { path: 'README.md' } } },
  { input: "查找最近的日志", 
    expected: { type: 'read_file', semantic: { modifier: 'latest', filter: 'log' } } },
  { input: "运行测试", 
    expected: { type: 'execute_command', missing: ['test_runner'] } },
  // ... 100+ 真实场景标注
];
```

**没有测试语料，无法量化 MVP 的有效性。**

### 2. Schema 版本管理

```typescript
// v1 → v2 兼容策略
interface IntentV1 { type: string; params: any; }
interface IntentV2 { type: string; params: any; semantic_params?: any; }

function migrate(intent: any, fromVersion: string): Intent { ... }
```

**为什么必备**：3 个月后你会想改 schema，没有版本管理会后悔。

### 3. 可观测性

```typescript
interface TranslationTrace {
  step: 'intent_recognition' | 'compilation' | 'completeness' | 'completion';
  input: any;
  output: any;
  latency_ms: number;
  success: boolean;
  error?: string;
}
```

**为什么必备**：意图层是黑盒，没有 trace 无法定位问题。

### 4. 失败模式目录

```markdown
## 已知失败模式
- F001: 复合意图的边界识别失败（如"修复 bug"无法分解）
- F002: 上下文推断错误（如误判项目语言）
- F003: 用户补充的参数仍然不完整
- F004: 意图作者未考虑错误场景（DAG 缺少条件分支）→ 详见 doc 10
- F005: 异常未能被任何 handleError 层截获（op throw）→ L1 冒泡到顶层 → UnhandledError

## 应对策略
- F001 → 兜底走"unknown" → bash
- F002 → 完整性分析重新触发
- F003 → 二轮澄清
- F004 → DAG 完整性检查要求 DAG 显式处理业务错误（见 doc 10 §五）
- F005 → L1 bubbleError 冒泡：写 $r_err → 找最近 handleError 帧；无 handler → UnhandledError（见 doc 10 §三.8）
```

**为什么必备**：明确"什么做不了"比假装能做更重要。

**与响应式执行模型的关系**：错误处理是业务逻辑，应在意图 DAG 中显式表达（详见 [doc 10 §五/§七](./10-reactive-execution-model.md)）。MVP 不需提供特殊错误处理路径。

---

## MVP 验收标准

**MVP 完成 = 以下条件全部满足**：

1. ✓ 五大能力各自有单元测试，覆盖率 > 80%
2. ✓ 完整链路有集成测试（用户输入 → 完整指令序列 → 执行）
3. ✓ 测试语料 100+ 条，标注准确率 > 90%
4. ✓ 失败模式目录覆盖 80% 实际失败场景
5. ✓ 关键操作有 trace 日志
6. ✓ 文档说明每个能力的边界（哪些能做、哪些不能）

**MVP 不完成 ≠ 不交付**：任何一项不满足，但五大能力都能跑通，都算"可演示但未达 MVP"。