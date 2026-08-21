# 05 - 实施路线图

> 从 MVP 到长期演进的具体路径与决策点。

---

## 总体策略

**原则**：渐进式扩展 pi，不要重新设计。

```
阶段 1: 扩展 MVP（2-4 周）
   ↓ 评估
阶段 2: SDK 完整实现（2-3 个月）
   ↓ 评估
阶段 3: Fork 或重新设计（必要时）
```

**理由**：
- pi 的设计哲学就是"核心极简，外围可扩展"——这与分层翻译需求天然契合
- 但 pi 的 LLM-as-loop 假设与"分层翻译"假设根本不同
- 完全在扩展内实现不可能 → 必要时 SDK/Fork
- 不要重新设计，除非你的系统**不是** LLM agent

---

## 阶段 1：扩展 MVP（2-4 周）

### 目标

用 pi 的扩展机制实现五大能力的最小可演示版本。

### Pi 提供的扩展点（已确认）

```
user sends prompt
  ├─► input (can intercept, transform, or handle)        ← 意图预分类
  ├─► before_agent_start (can inject message, modify system prompt)
  ├─► agent_start / agent_end
  ├─► LLM responds, may call tools:
  │     ├─► tool_call (can block)                         ← 完整性分析
  │     ├─► tool_result (can modify)
```

其他：
- `pi.registerTool()` - 注册新工具
- `ctx.ui` - 用户交互（select, confirm, input）
- 自定义 schema (TypeBox)

### 任务分解

#### Week 1-2：定义 Primitives + 语义工具

```typescript
// ~/.pi/agent/extensions/semantic-tools.ts
import { Type } from "typebox";

export default function (pi) {
  // 注册 5-7 个语义工具
  pi.registerTool({
    name: "read_file_semantic",
    label: "Read File (Semantic)",
    description: "Read file with strict schema validation",
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
      encoding: Type.Optional(Type.Union(["utf-8", "ascii"])),
      max_bytes: Type.Optional(Type.Number({ minimum: 0 }))
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // 调用底层 read
    }
  });
  
  pi.registerTool({
    name: "find_files_semantic",
    // ...
  });
  
  // ... 更多
}
```

#### Week 3-4：意图识别（input 拦截）

```typescript
// ~/.pi/agent/extensions/intent-classifier.ts
pi.on("input", async (event, ctx) => {
  // 快速规则分类
  const intent = classifyIntent(event.text);
  
  if (intent.type === 'unknown') {
    // 走默认 pi 流程
    return;
  }
  
  // 高置信度 → 注入到 system prompt
  return {
    action: "transform",
    text: `[Intent: ${intent.type}]\n${event.text}`
  };
});
```

#### Week 5-6：tool_call 完整性分析

```typescript
// ~/.pi/agent/extensions/completeness-check.ts
pi.on("tool_call", async (event, ctx) => {
  if (isToolCallEventType("bash", event)) {
    // 分析 command 中的隐含参数
    const analysis = analyzeBashCommand(event.input.command);
    
    if (analysis.missing.length > 0) {
      // 阻塞，要求 LLM 补全
      return {
        block: true,
        reason: `Missing required parameters: ${analysis.missing.join(', ')}. ` +
                `Please specify them explicitly in the command.`
      };
    }
  }
});
```

#### Week 7-8：补全交互（最小版本）

```typescript
// ~/.pi/agent/extensions/completion-prompt.ts
pi.on("tool_call", async (event, ctx) => {
  if (isToolCallEventType("read", event) && !event.input.path) {
    const path = await ctx.ui.input(
      "Which file do you want to read?",
      "Path is required. Enter the relative or absolute path:"
    );
    if (path) {
      event.input.path = path;  // 修改输入
    }
  }
});
```

### 阶段 1 的能力边界

**能做到**：
- ✓ 添加语义工具（带 strict schema）
- ✓ 在 `tool_call` 时做参数完整性检查
- ✓ 在 `input` 时做意图预分类
- ✓ 用 `ctx.ui` 提示用户补全参数

**做不到**：
- ✗ **完全控制 LLM 的工具选择决策**——LLM 仍可能直接调 bash
- ✗ **强制意图→指令序列的展开**——LLM 可能跳过中间步骤
- ✗ **完全分离意图层和编译层**——LLM 在一个 turn 内做所有决策

**预期效果**：60-70% 的分层效果。

### 阶段 1 评估标准

```
继续扩展 ⇔ < 10% 的 LLM 调用绕过语义层直接调 bash
进入 SDK ⇔ ≥ 10% 的调用绕过，说明扩展机制不够
```

---

## 阶段 2：SDK 完整实现（2-3 个月）

### 目标

用 pi 的 SDK 自己实现 agent loop，在外面套上完整的翻译层。

### 任务分解

#### Month 1：架构骨架

```typescript
// layered-translation-runtime/src/runtime.ts
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

class LayeredTranslationRuntime {
  private intentLayer: IntentLayer;
  private contextLayer: ContextLayer;
  private compilationLayer: CompilationLayer;
  private completenessLayer: CompletenessLayer;
  private completionLayer: CompletionLayer;
  
  async handleUserInput(rawInput: string, piSession: AgentSession) {
    // Layer 1: 意图识别
    const intent = await this.intentLayer.recognize(rawInput);
    
    // Layer 2: 上下文
    const context = await this.contextLayer.snapshot();
    
    // Layer 3: 编译
    const instructions = await this.compilationLayer.compile(intent, context);
    
    // Layer 4: 完整性分析
    const report = this.completenessLayer.analyze(instructions, context);
    
    // Layer 5: 补全（如需要）
    if (!report.complete) {
      const completed = await this.completionLayer.fill(report);
      if (!completed) return;
      instructions = applyCompletions(instructions, completed);
    }
    
    // Layer 6: 执行（通过 pi）
    for (const inst of instructions) {
      await this.executeOnPi(inst, piSession);
    }
  }
}
```

#### Month 2：能力实现

- 实现独立意图层（可能用微调的小模型）
- 实现编译层（规则表 + 模板）
- 实现 pi session pool（复用连接）
- 失败模式目录建立

#### Month 3：评估与优化

- 收集"LLM 绕过语义层"案例
- 优化规则覆盖
- 建立测试语料

### 阶段 2 的优势

- ✓ 完全控制意图识别（独立 LLM 调用，约束更紧）
- ✓ 编译层独立（规则表 or 微调模型）
- ✓ 执行层只接收已校验的指令
- ✓ 完整的关注点分离

### 阶段 2 的代价

- 失去部分 pi 高级特性（如交互式 steering、消息队列的部分整合）
- 需要自己处理 session、消息历史
- 调试更复杂

---

## 阶段 3：Fork 或重新设计（按需）

### 决策树

```
遇到 fork 红灯？
├── 否 → 继续优化阶段 2
└── 是 → 评估
    ├── 修改局部（< 30% 核心代码）→ Fork pi
    └── 需要全新能力 → 重新设计

Fork 红灯信号：
- 需要修改 agent loop 的核心 turn 逻辑
- 需要修改消息历史的存储格式
- 需要绕过 pi 的 LLM provider 抽象
- 需要修改安全模型（沙箱边界）
```

### Fork 的成本评估

| 项目 | 估计 |
|---|---|
| Fork pi 并维护 | 2-3 人月起步 |
| 持续与上游同步 | 1-2 人月/年 |
| 失去的部分扩展能力 | 取决于修改深度 |

### 重新设计的判断标准

只在以下情况重新设计：
- 你的系统**不是** LLM agent
- 你需要完全不同的 LLM 推理假设（如多模型协作）
- 你需要不同的安全模型
- 你的目标用户与 pi 完全不同

---

## 关键决策检查清单

在任何阶段开始前，问自己：

| 问题 | 回答决定 |
|---|---|
| 意图空间多大？ | < 100 种 → 扩展足够；> 1000 种 → 需要 SDK |
| 需要多严格的完整性保证？ | 软件工程级 → 编译层必须是确定性规则 |
| LLM 调用延迟敏感吗？ | 是 → 多层 LLM 成本高，规则优先 |
| 是否需要离线/确定性模式？ | 是 → 必须用规则表，不能依赖 LLM |
| 团队规模？ | 1-2 人 → 扩展优先；> 5 人 → SDK 更可控 |

---

## 长期演进方向

即使 MVP 完成，LLM 栈会持续变化。**保持可替换性的设计**：

```
短期会变（高频演化）：
- 意图层（LLM 模型、provider）
- 补全交互（UI/UX）

中期会变（中频演化）：
- 编译规则（业务逻辑变化）
- 上下文追踪（项目类型增加）

长期稳定（低频演化）：
- Primitives 定义
- 完整性分析逻辑
- 执行层接口
```

**MVP 的核心价值**：把这三层清晰地分离开，让变化的部分独立演化，不互相拖拽。

---

## 立即可开始的行动

**Week 0**（本周末）：
1. 在 `~/.pi/agent/extensions/` 创建第一个扩展 `semantic-tools.ts`
2. 定义 3 个语义工具（read_file, write_file, find_files）
3. 用真实任务测试 LLM 绕过率

**评估**：
- 如果绕过率 < 10% → 继续扩展路线
- 如果 ≥ 10% → 提前进入阶段 2

**核心原则**：**不要重新设计**，**专注于填补能力空白**。