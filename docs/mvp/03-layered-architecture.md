# 03 - 分层翻译架构

> 用户提出的核心架构：多层关注点分离，使执行层不承担参数验证职责。

---

## 核心原则

```
执行层的契约: "给我已校验的指令"
     ↑
编译层的契约: "我提供指令 + 必需参数清单"
     ↑
完整性分析层的契约: "我提供缺口分析"
     ↑
提示层的契约: "我提供清晰的用户询问"
     ↑
意图层的契约: "我提供结构化意图"

每一层的失败不能传递给下一层。
```

这是经典的 **defensive programming** 应用到 AI 系统。

---

## 完整架构图

```
┌──────────────────────────────────────────────────────────┐
│ 用户自然语言输入 │
└────────────────────────┬─────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│ Layer 1: 意图识别层 (Intent Recognition) │
│ - 识别意图类型（封闭枚举） │
│ - 提取语义参数（含修饰词，如"最新"、"所有"） │
│ - 标注置信度 │
└────────────────────────┬─────────────────────────────────┘
                         ↓ Intent { type, semantic_params }
┌──────────────────────────────────────────────────────────┐
│ Layer 2: 上下文追踪 (Context Tracking) │
│ - 项目元数据（语言、构建系统、test runner） │
│ - 用户明确说过的参数 │
│ - 推断的参数（cwd、git 状态） │
│ - turn 历史 │
└────────────────────────┬─────────────────────────────────┘
                         ↓ Context
┌──────────────────────────────────────────────────────────┐
│ Layer 3: 意图编译层 (Intent Compilation) │
│ - 规则表：Intent Pattern → Instruction Sequence │
│ - 展开复合意图为 primitive 序列 │
│ - 声明每个 primitive 的必需参数 │
└────────────────────────┬─────────────────────────────────┘
                         ↓ Instructions + RequiredParams
┌──────────────────────────────────────────────────────────┐
│ Layer 4: 完整性分析层 (Completeness Analysis) │
│ - 检查每个 primitive 的必需参数 │
│ - 区分显式/推断/派生参数 │
│ - 生成缺口清单 + 优先级 │
└────────────────────────┬─────────────────────────────────┘
                         ↓ CompletenessReport
┌──────────────────────────────────────────────────────────┐
│ Layer 5: 提示/补全层 (Completion Interaction) │
│ - 把缺口转换为用户友好的问题 │
│ - 提供默认值和推断值 │
│ - 收集用户响应 │
└────────────────────────┬─────────────────────────────────┘
                         ↓ CompletedInstructions
┌──────────────────────────────────────────────────────────┐
│ Layer 6: 执行层 (Execution) │
│ - 接收已校验指令 │
│ - 调用底层工具（pi tools / bash） │
│ - 返回结果给翻译层（用于上下文更新） │
└──────────────────────────────────────────────────────────┘
```

---

## 各层的详细规范

### Layer 1: 意图识别

```typescript
type IntentType = 
  | 'read_file' | 'write_file' | 'edit_file'
  | 'find_files' | 'search_content'
  | 'execute_command' | 'git_operation'
  | 'install_dependencies' | 'run_tests'
  | 'unknown';  // 兜底走 bash

interface Intent {
  type: IntentType;
  confidence: number;        // 0-1，< 0.7 应触发澄清
  semantic_params: {
    target?: string;          // 路径/对象
    modifiers?: string[];     // "latest", "all", "modified today"
    constraints?: string[];   // 类型过滤
  };
  ambiguity_notes?: string[]; // 标注歧义点
}
```

**MVP 范围**：有限意图枚举（< 20 种），不追求开放域。

### Layer 2: 上下文追踪

```typescript
interface TranslationContext {
  explicit: Record<string, any>;   // 用户明确提供的
  inferred: {                      // 从项目推断
    language?: string;             // typescript, python, rust, ...
    build_system?: string;         // npm, cargo, make, ...
    test_runner?: string;
    project_root?: string;
  };
  derived: Record<string, any>;    // 从前序指令派生的
  history: Array<{                 // turn 历史
    intent: Intent;
    instructions: Instruction[];
    result: 'success' | 'failure';
  }>;
}
```

### Layer 3: 意图编译

```typescript
interface PrimitiveInstruction {
  kind: 'read_file' | 'write_file' | 'edit_file' | 'list_files' 
      | 'search_content' | 'execute' | 'compose';
  args: Record<string, any>;
  required_params: string[];  // ← 关键：声明必需参数
}

interface CompilationRule {
  intent_pattern: {
    type: IntentType;
    modifiers?: string[];
  };
  preconditions: (ctx: Context) => void;  // 前置检查
  expand: (intent: Intent, ctx: Context) => PrimitiveInstruction[];
}
```

**示例规则**：

```typescript
const rules: CompilationRule[] = [
  {
    intent_pattern: { type: 'read_file', modifiers: ['latest'] },
    expand: (intent, ctx) => [
      { 
        kind: 'list_files', 
        args: { pattern: extractLogPattern(intent), recursive: true },
        required_params: ['pattern', 'location']  // location 必填
      },
      { kind: 'sort_results', args: { by: 'mtime', desc: true }, required_params: [] },
      { kind: 'take_first', args: {}, required_params: [] },
      { kind: 'read_file', args: { path: '<derived:previous>' }, required_params: ['path'] }
    ]
  }
];
```

### Layer 4: 完整性分析

```typescript
interface CompletenessReport {
  complete: boolean;
  missing: Array<{
    instruction_index: number;
    param: string;
    source: 'missing' | 'ambiguous' | 'needs_clarification';
    suggestion?: string;       // 自动补全建议
    question?: string;         // 向用户询问的问题
  }>;
  derived_chains: Array<{     // 依赖链
    from: number;              // 源指令索引
    to: number;                // 目标指令索引
    param: string;
  }>;
}

function analyzeCompleteness(
  instructions: PrimitiveInstruction[],
  context: TranslationContext
): CompletenessReport {
  // ... 确定性逻辑
}
```

### Layer 5: 提示/补全

```typescript
interface UserPrompt {
  message: string;
  questions: Array<{
    param: string;
    question: string;
    default?: any;
    options?: string[];
    type: 'text' | 'select' | 'confirm';
  }>;
}

async function fillCompleteness(
  report: CompletenessReport,
  ui: UserInterface
): Promise<CompletedInstructions | null>;
```

### Layer 6: 执行

```typescript
async function execute(instructions: PrimitiveInstruction[]) {
  // ⚠ 进入这一层意味着：所有参数已验证、已补全
  for (const inst of instructions) {
    await runTool(inst.kind, inst.args);
  }
}
```

**执行层不做任何参数检查**——这是契约。

---

## 现有系统中类似分层

| 系统 | 对应分层 | 完整性分析机制 |
|---|---|---|
| 静态类型语言 | 表达式 → AST → 类型检查 → 编译 | 类型检查器在编译期发现缺失参数 |
| 数据库查询优化器 | SQL → 解析 → 逻辑计划 → 物理计划 → 执行 | 优化器在执行前发现 schema 不匹配 |
| Web 表单验证 | HTML 表单 → 字段定义 → 验证规则 → 提交 | 浏览器在提交前发现字段缺失 |
| 函数式编程 | 函数签名 → 模式匹配 → 类型推导 | 编译器在链接期发现签名不匹配 |
| Protobuf | .proto 定义 → 代码生成 → 序列化/反序列化 | 反序列化时发现缺失字段 |
| LLVM | 源码 → IR → 优化 → 目标代码 | 每层都有自己的验证 Pass |

**共同模式**：定义层 → 验证层 → 补全/错误层 → 执行层

---

## 架构的边界与限制

### 适用场景 ✓

- 任务型意图（明确、可枚举）
- 有清晰操作词汇集
- 用户能澄清歧义

### 不适用场景 ✗

- 探索型意图（"修复 bug"、"让它更好"）
- 创作型意图（"设计一个 API"）
- 需要领域知识的意图（"按团队规范提交"）

**这些情况必须兜底走 bash + LLM 直连**。

---

## 失败模式

```
F001: 复合意图边界识别失败（如"修复 bug"无法分解）
  → 兜底走"unknown" → bash
F002: 上下文推断错误（如误判项目语言）
  → 完整性分析重新触发
F003: 用户补充的参数仍然不完整
  → 二轮澄清
F004: 编译规则不覆盖
  → 兜底走"unknown" → bash
F005: 执行层错误（文件不存在、权限不足）
  → 上报意图层，决定重试/换策略
```

---

## 与 pi 的整合点

| 架构层 | pi 扩展点 |
|---|---|
| 意图层 | `pi.on("input")` 做意图预分类 |
| 编译层 | 自定义规则引擎（不在 pi 内） |
| 完整性分析 | `pi.on("tool_call")` 拦截检查 |
| 补全层 | `ctx.ui.input/select/confirm` |
| 执行层 | 直接调用 pi tools |

**MVP 可以完全用 pi 扩展机制实现**，无需 Fork。