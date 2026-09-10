# 09 - L1 实现设计：Runtime、注册机制、动态加载

> L1（2-Primitive RISC）的 TypeScript 实现方案：语言选型、Runtime 架构、Operation 注册机制、动态加载、与 L3 编译器的衔接。

本文档是 `06-execution-layer.md`（L1/L2/L3 词汇表）和 `07-intent-library.md`（L4→L1 完整路径）的**实现侧补充**：把"硬件接口"落到 TypeScript 代码层面。

> ⚠️ **本文档与 [10-reactive-execution-model.md](./10-reactive-execution-model.md) 的关系**：本文档描述 L1 的**基本实现骨架**（语言选型、Operation 注册、动态加载）；doc 10 定义 L1 的**执行语义**（5-case 调度器主循环、异构指令栈、异常冒泡 + handleError 标志）。
>
> **部分章节已过时**：
> - §5 L1Runtime 主体：原 `runSequence` 被 `l1MainLoop`（5-case dispatch）取代
> - §10 D4 Operation 失败用 throw：已被替换为 "错误作为数据 + throw 交给 L1 冒泡（L3 决定处置权）"
>
> 建议以 doc 10 为权威实现模型，本文保留为 L1 的**基础能力**与**加载机制**参考。

---

## 决策摘要

L1 的实现遵循以下核心决策：

| 决策维度 | 选择 | 理由 |
|---|---|---|
| **实现语言** | TypeScript（MVP） | 与 pi 同生态；ESM 动态导入原生支持；IO 密集场景性能足够 |
| **进程模型** | 同进程（MVP） | 简化架构；可直接调 pi tools；性能瓶颈出现时再下沉 |
| **L1 Primitive 数量** | **5**（move/execute_op/execute_intent/skip_n/conditional_skip） | 与 doc 10 一致 |
| **调度器模式** | **l1MainLoop**（5-case dispatch） | 取代旧的 runSequence（顺序执行完整序列）|
| **Operation 形式** | 普通对象（含 `execute` 方法） | 简单即正义；类仅用于有内部状态的特殊情况 |
| **Address 解析** | eager（execute 前全解析） | 调试友好；失败前置 |
| **错误处理** | **错误作为数据 + throw 交给 L1 冒泡** | 业务逻辑走 DAG 条件分支；异常冒泡处置权在 L3（handleError）|
| **扩展加载** | 启动时扫描 + 动态 import | 依赖图清晰；与 pi 扩展机制一致 |
| **反射需求** | **零反射** | schema 是纯数据；TypeScript 编译期已校验 |

**核心模式**：**调度器 + Registry**——L1 main loop 通过异构指令栈调度 L2 (execute_op) 和 L3 (execute_intent)，operation 通过注册表动态加载。DAG 条件分支编译为 `skip_n` / `conditional_skip` 控制流 primitive。

---

## 一、设计目标与约束

### 1.1 设计目标

1. **可执行**：MVP 阶段就能跑通端到端（意图→L1 执行）
2. **可扩展**：新增 operation 不需要改 L1 Runtime
3. **可调试**：每个 primitive 都有 trace；失败可定位到具体 operation
4. **可演进**：性能瓶颈出现时，可单独把 hot operation 下沉到 Rust

### 1.2 设计约束

- **不能依赖 pi 特定版本**：L1 Runtime 是独立模块，可被任意 host 进程调用
- **不能假设同步 IO**：所有 operation 必须可异步
- **不能丢失数据**：primitive 失败必须有明确错误传播路径
- **不能假设文件系统结构**：operation 自己决定 IO 策略

### 1.3 与 doc 06 的关系

- **doc 06 定义 L1 词汇表**（`move`、`execute`、5 种 Address、Operation 接口）
- **本文档定义 L1 Runtime 如何实现该词汇表**
- 本文档的 TypeScript 代码可以直接编译为 doc 06 中的 TypeScript 类型

### 1.4 与 doc 07 的关系

- **doc 07 定义 L3 从 Experience 编出 StackEntry 序列**（三段式编译）
- 本文档**第 9 节**展示 L3 编译器如何使用本文档定义的 Runtime API
- L3 与 L1 的边界：**L3 只读 metadata；L1 调 execute**

> **2026-08-20 更新**：原 doc 07 的"StandardIntent + DAG 节点"已重写为"Experience 三段式"。详见 [doc 12-experience-model.md](./12-experience-model.md)。

### 1.5 与 doc 08 的关系

- **doc 08 定义 Environment Context**（会话级环境元数据）
- 本文档的 **L1Runtime 接受 EnvironmentContext 作为构造参数**
- `$env.*` 的解析通过 ExecutionContext 暴露给 operation

---

## 二、语言与进程模型选型

### 2.1 语言候选对比

| 语言 | 推荐度 | 优势 | 劣势 |
|---|---|---|---|
| **TypeScript** | ⭐⭐⭐⭐⭐ | 与 pi 同生态；ESM 动态导入；迭代最快 | 性能上限低于 Rust/C++ |
| **Rust (NAPI addon)** | ⭐⭐⭐ | 性能强；内存安全；可下沉热路径 | FFI 复杂度；与 pi 工具交互需额外胶水 |
| **C++ (NAPI addon)** | ⭐⭐ | 性能强 | 内存安全差；维护成本高 |
| **C#** | ⭐ | 反射支持强 | 与 Node 生态断裂；IPC 成本高 |
| **WASM (Rust→WASM)** | ⭐⭐⭐ | 跨平台；沙箱 | 与 Node IO 集成需胶水 |

### 2.2 推荐策略

**MVP 纯 TypeScript，性能瓶颈出现时下沉 Rust**。

理由：

1. **L1 真实瓶颈不在计算，在 IO 等待**——`file_read`、`shell_exec` 等 operation 都是 IO 密集
2. **TypeScript 与 pi 共进程 = 直接调 pi tools**——省去 FFI 胶水代码
3. **ESM 动态导入原生支持**——无需额外工具实现扩展机制
4. **每个 L2 operation 是独立单元**——可以**单独替换为 Rust 实现**（NAPI 暴露 async 函数），其他 L2 不受影响

### 2.3 进程模型

**MVP：L1 Runtime 与 host 进程同进程**。

```
┌──────────────────────────────────────────┐
│ Host Process (e.g., pi coding agent)     │
│                                          │
│  ┌──────────┐    ┌──────────────────┐    │
│  │ L3       │───▶│ L1 Runtime       │    │
│  │ Compiler │    │ (in-process)     │    │
│  └──────────┘    └────────┬─────────┘    │
│                            │              │
│                            ▼              │
│                  ┌──────────────────┐    │
│                  │ Operations (L2)  │    │
│                  │ - file_read      │    │
│                  │ - shell_exec     │    │
│                  │ - user_ops       │    │
│                  └──────────────────┘    │
└──────────────────────────────────────────┘
```

**未来演进路径**：若需要 L1 进程隔离（沙箱、安全），可通过：
- **A. 拆为子进程 + stdin/stdout RPC**（简单，JSON 协议）
- **B. 拆为独立 HTTP/gRPC 服务**（复杂，适合分布式）
- **C. WASM 沙箱**（限制 operation 能力）

MVP 不做这些。

---

## 三、核心架构

### 3.1 模块视图

```
┌─────────────────────────────────────────────────────┐
│ L1 Runtime │
│ │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────┐ │
│  │ Operation    │ │ Data Area    │ │ Address     │ │
│  │ Registry     │ │ (Variables)  │ │ Resolver    │ │
│  └──────────────┘ └──────────────┘ └─────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ │
│  │ Trace Logger │ │ Env Context  │ │
│  │              │ │ (readonly)   │ │
│  └──────────────┘ └──────────────┘ │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼ uses
┌─────────────────────────────────────────────────────┐
│ Operation Library (L2) │
│ │
│  ┌──────────────────────────────────────────┐ │
│  │ Built-in Ops (8 个) │ │
│  │  - file_read / file_write │ │
│  │ - glob_match / grep_search │ │
│  │  - shell_exec / string_replace │ │
│  │ - evaluate_expr / evaluate_collection │ │
│  └──────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────┐ │
│  │ Extension Ops (动态加载) │ │
│  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 3.2 关键概念

- **Operation Registry**：name → Operation 的 Map
- **Data Area**：sequence 内的命名变量池
- **Address Resolver**：Address → Value 的解析器
- **Trace Logger**：可注入的 trace 输出（MVP 默认 NullLogger）

---

## 四、Command Pattern 的精确映射

L1 设计本质上是 **Command Pattern + Registry**：

```
┌─────────────────────────────────────────────────────────┐
│ L3 编译器 (只读 metadata，**不知道** operation 怎么实现) │
└──────────────────────────┬──────────────────────────────┘
                           │ 读 metadata
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Operation 注册表                                         │
│                                                         │
│   {                                                     │
│     name: 'file_read',                                  │
│     inputs: { path: { required: true } },               │ ← metadata (L3 用)
│     outputs: { content: { required: true } },           │
│     execute: async (i) => ({...})                       │ ← 实现 (L1 用)
│   }                                                     │
└─────────────────────────────────────────────────────────┘
```

**关键边界**：

- **元数据 (inputs/outputs schema)** = 公开契约，L3 编译器可见
- **execute 函数** = 私有实现，L3 编译器**永远不调用**
- L3 通过 metadata 决定："这个意图展开需要哪些 move 准备输入、分配哪些变量接收输出"
- L1 Runtime 才真正调用 `execute`

这就是经典的 **Command Pattern**：
- **Primitive 序列**（move + execute）= 命令对象
- **L1Runtime.execute(prim)** = 命令执行器
- **Operation** = 命令的实际处理逻辑

### 4.1 编译期 vs 运行期的清晰分离

| 阶段 | L3 编译器 | L1 Runtime |
|---|---|---|
| **可见** | Operation metadata | Operation execute + metadata |
| **调用** | `op.inputs` / `op.outputs`（schema 访问） | `op.execute(inputs, ctx)` |
| **依赖** | 编译时类型（TypeScript interface） | 运行时注册表（Map） |
| **失败** | schema 不匹配 → 编译错误 | execute 抛错 → trace + 上抛 |

---

## 五、L1Runtime 核心结构

> ⚠️ **本节已被响应式执行模型大幅修订**：原 `runSequence`（顺序执行完整 Primitive 序列）被替换为 `l1MainLoop`（5-case 调度器主循环 + 异构指令栈）。详细实现见 [doc 10 §三](./10-reactive-execution-model.md#三l1-调度器主循环)。
>
> 本节保留 L1 Runtime 的**基本能力**（Address 解析、IO 操作、Trace Logger），作为实现层的参考。

### 5.1 类型定义（双区架构版，2026-08-20 重写）

> **重大变更**：本节已在 2026-08-20 重大重写中重构，与 [doc 06 §四/§五/§六](./06-execution-layer.md) 一致。

```typescript
// src/l1/types.ts

// ============== Value（基本值类型）==============
export type Value =
  | string | number | boolean | null | undefined
  | Value[]
  | { [key: string]: Value }

// ============== Address（双区架构：4 kinds）==============
export type Address =
  | { kind: 'literal'; value: Value }              // 字面量（仅作为 move 源）
  | { kind: 'public'; name: string }               // 业务数据（持久）
  | { kind: 'internal'; name: string }             // 寄存器（瞬态）
  | { kind: 'file'; path: string }                 // 文件路径

// ============== Intent 类型 ==============
export interface RecognizedIntent {
  type: string
  params: Record<string, unknown>
}

export interface StandardIntent {
  name: string
  description: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  children: unknown[]
}

// ============== BaseEntry（指令栈条目基类）==============
export interface BaseEntry {
  id: string
  parentIntentId: string | null
  createdAt: number
}

// ============== 5 种 L1 Primitive（StackEntry）==============
export interface OpEntry extends BaseEntry {
  kind: 'execute_op'
  operation: string
  inputs: Record<string, Address>     // 仅 internal
  outputs: Record<string, Address>    // 仅 internal
  status: 'pending' | 'running' | 'done'
}

export interface IntentEntry extends BaseEntry {
  kind: 'execute_intent'
  intent: RecognizedIntent | StandardIntent
  phase: 'pending' | 'awaiting_children' | 'done' | 'aborted'
  children: StackEntry[]
}

export interface MoveEntry extends BaseEntry {
  kind: 'move'
  from: Address                       // 任意 kind（literal/public/internal/file）
  to: Address                          // 非 literal
}

export interface SkipN extends BaseEntry {
  kind: 'skip_n'
  n: number
}

export interface ConditionalSkip extends BaseEntry {
  kind: 'conditional_skip'
  conditionAddr: Address               // 必须 internal
  n: number
}

export type StackEntry = OpEntry | IntentEntry | MoveEntry | SkipN | ConditionalSkip

// ============== FormalParam（形参元数据）==============
export interface FormalParam {
  businessName: string                // 业务语义名
  register: string                    // L1 寄存器地址（必填）
  type: ParamType
  required: boolean
  description?: string
}

export interface OperationFormalSpec {
  inputs: Record<string, FormalParam>   // key 是 businessName
  outputs: Record<string, FormalParam>
}

// ============== Operation 接口 ==============
export type ParamType =
  | 'string' | 'number' | 'boolean'
  | 'path' | 'pattern'
  | 'list<string>' | 'list<path>' | 'list<struct>'
  | 'struct'

export interface Operation {
  name: string                        // opcode
  description: string
  formalSpec: OperationFormalSpec     // 形参元数据（双区架构）
  execute: (inputs: Record<string, Value>) => Promise<Record<string, Value>>
}

// ============== 标准错误结构 ==============
export interface OperationError {
  code: string                        // 'ENOENT', 'EXEC_FAILED',...
  message: string
  op: string                          // operation name
  timestamp: number                   // 毫秒
  details?: unknown
}

// EnvironmentContext 引用 doc 08（不在 L1 数据区中）
import type { EnvironmentContext } from '../env/types'
```

**Address 与 Primitive 的关系**：

| Primitive | inputs | outputs | conditionAddr | from | to |
|---|---|---|---|---|---|
| `move` | - | - | - | 任意 | 非 literal |
| `execute_op` | 仅 internal | 仅 internal | - | - | - |
| `execute_intent` | 仅 internal | 仅 internal | - | - | - |
| `conditional_skip` | - | - | 仅 internal | - | - |
| `skip_n` | - | - | - | - | - |

**旧类型的映射**：

| 旧类型 | 新类型 | 说明 |
|---|---|---|
| `Address.variable` | `Address.public` / `Address.internal` | 业务 vs 寄存器分离 |
| `Address.stream` | （未列入 MVP）| 用 file + shell_exec 组合代替 |
| `Address.field` | （未列入 MVP）| 用结构化 Value + 应用层处理 |
| `Operation.inputs/outputs: ParamSpec` | `Operation.formalSpec: OperationFormalSpec` | 加形参元数据 |

### 5.2 L1Runtime 主体（**已过时**，详见 doc 10）

> ⚠️ **本节已被 [doc 10 §三](./10-reactive-execution-model.md#三l1-调度器主循环) 取代**。以下代码展示旧版 `runSequence` 设计，仅作为参考。
>
> **新版** L1 Runtime 实现为**调度器**（`l1MainLoop`），通过异构指令栈调度 L2 和 L3。

```typescript
// src/l1/runtime.ts（旧版，仅供参考）

import type {
  Primitive, Move, Execute, Address, Value,
  Operation, ExecutionContext, TraceLogger, TraceEvent
} from './types'
import type { EnvironmentContext } from '../env/types'
import { NullLogger } from './trace'
```

### 5.3 循环支持：递归 intent 引用（详见 [doc 10 §六.5](./10-reactive-execution-model.md)）

> **不增加 `loop` primitive**——L1 词汇表固定为 5 primitive。

循环通过 **递归 intent 引用** + `conditional_skip` 实现。L1Runtime 仅需添加**递归深度跟踪**作为安全网：

```typescript
// ExecutionState 增加递归深度跟踪字段（A11，2026-08-20 实现版）
interface ExecutionState {
  stack: StackEntry[]                 // 异构指令栈
  publicStore: Map<string, Value>     // 业务数据（双区）
  internalStore: Map<string, Value>   // 寄存器（双区）
  allocator: RegisterAllocator
  recursionDepth: Map<string, number> // ⭐ intent.type → 递归深度
  l2: L2Registry
  l3: L3Service
}

// 递归深度默认限制（独立模块 src/l1/recursion.ts）
const DEFAULT_MAX_RECURSION_DEPTH = 1000

// 进入意图时检查深度（超限抛 RecursionDepthError——L1 系统防御，不走业务冒泡）
function enterIntent(
  intentName: string,
  state: ExecutionState,
  maxDepth: number = DEFAULT_MAX_RECURSION_DEPTH
): void {
  const current = state.recursionDepth.get(intentName) ?? 0
  const next = current + 1
  if (next > maxDepth) {
    throw new RecursionDepthError(intentName, next)
  }
  state.recursionDepth.set(intentName, next)
}

// 退出意图时减少深度（归零删除键；空计数防御：enter/exit 不平衡时静默）
function exitIntent(intentName: string, state: ExecutionState): void {
  const current = state.recursionDepth.get(intentName) ?? 0
  if (current <= 0) return  // 防御
  if (current === 1) state.recursionDepth.delete(intentName)
  else state.recursionDepth.set(intentName, current - 1)
}

// processIntentEntry（帧保留 + 双 phase + 递归深度）
async function processIntentEntry(
  entry: IntentEntry,
  state: ExecutionState,
  maxRecursionDepth: number
) {
  if (entry.phase === 'pending') {
    // A11：激活帧前登记递归深度（超限抛错时 phase 仍 pending，冒泡不会误 exit）
    enterIntent(entry.intent.type, state, maxRecursionDepth)
    entry.phase = 'awaiting_children'
    const children = await state.l3.compile(entry.intent, state)
    entry.children = children
    for (let i = children.length - 1; i >= 0; i--) {
      state.stack.push(children[i])
    }
    return
  }

  if (entry.phase === 'awaiting_children') {
    // children 全部执行完（栈顶回到帧）→ 正常完成：释放深度 + done + pop
    exitIntent(entry.intent.type, state)
    entry.phase = 'done'
    state.stack.pop()
  }
  // aborted：冒泡时已被弹出（abortFrame 已 exitIntent），主循环不会再次遇到
}
```

**关键性质**：
- 每次递归调用 L3.compile(A)，返回新 children（全新 ID）
- 栈深度恒定（不增长）
- 异常路径：bubbleError 弹出帧时 abortFrame（exitIntent + aborted）——深度不泄漏
- RecursionDepthError 与 L1MaxStepsError 同类：l1MainLoop catch 直接 throw（不走 handleError 冒泡）

**关键性质**：
- 每次递归调用 L3.compile(A)，返回新 children（全新 ID）
- 栈深度恒定（不增长）
- resultStore 不冲突（不同 entry ID）
- 词汇表仍为 5 primitive

**示例意图**（retry_until_success）：

```typescript
const retryUntilSuccess: StandardIntent = {
  name: 'retry_until_success',
  inputs: { max_attempts: 5, path: 'path' },
  outputs: { result: 'any' },
  dag: {
    kind: 'sequence',
    steps: [
      // body
      { kind: 'op', operation: 'file_read', inputs: { path: '$path' }, outputs: { content: '$attempt_result' } },
      // termination check
      { kind: 'op', operation: 'increment_counter', inputs: { var_name: '$attempts' }, outputs: { _: '$attempts' } },
      { kind: 'op', operation: 'check_max', inputs: { max: 5, current: '$attempts' }, outputs: { should_continue: '$should_continue' } },
      // ⭐ 递归引用自身
      { kind: 'if', condition: '$should_continue',
        then: [{ kind: 'sub_intent', intentName: 'retry_until_success' }],
        else: []
      }
    ]
  }
}
```

**详细 Walkthrough**见 [doc 10 §六.5](./10-reactive-execution-model.md)。

```typescript
// src/l1/runtime.ts（旧版，仅供参考）

import type {
  Primitive, Move, Execute, Address, Value,
  Operation, ExecutionContext, TraceLogger, TraceEvent
} from './types'
import type { EnvironmentContext } from '../env/types'
import { NullLogger } from './trace'

/**
 * L1 Runtime（旧版）：执行 Primitive 序列
 * * ⚠️ 已被响应式执行模型取代：现在 L1 是调度器，通过异构指令栈调度 L2/L3
 * * 保留此代码是因为它演示了：
 *   - Operation 注册表
 *   - Address 解析
 *   - Trace Logger
 *   - IO 操作（这些仍被新版使用）
 */
export class L1Runtime {
  private operations = new Map<string, Operation>()
  private dataArea: Map<string, Value> = new Map()
  private env: EnvironmentContext
  private logger: TraceLogger

  constructor(env: EnvironmentContext, logger?: TraceLogger) {
    this.env = env
    this.logger = logger ?? new NullLogger()
  }

  // ============== 注册接口 ==============

  registerOperation(op: Operation): void {
    if (this.operations.has(op.name)) {
      throw new Error(`Operation '${op.name}' already registered`)
    }
    this.operations.set(op.name, op)
  }

  registerOperations(ops: Operation[]): void {
    for (const op of ops) {
      this.registerOperation(op)
    }
  }

  hasOperation(name: string): boolean {
    return this.operations.has(name)
  }

  // ============== 执行接口（旧版 runSequence） ==============
  // ⚠️ 已过时。新版使用 l1MainLoop（见 doc 10 §三）

  async runSequence(seq: Primitive[]): Promise<void> {
    const start = Date.now()
    this.logger.trace({ event: 'sequence_start', length: seq.length })
    for (let i = 0; i < seq.length; i++) {
      await this.execute(seq[i])
    }
    this.logger.trace({ event: 'sequence_end', latency_ms: Date.now() - start })
  }

  async execute(prim: Primitive): Promise<void> {
    const start = Date.now()
    this.logger.trace({ event: 'primitive_start', prim })
    try {
      switch (prim.kind) {
        case 'move':
          await this.executeMove(prim)
          break
        case 'execute':
          await this.executeExecute(prim)
          break
        default:
          throw new Error(`Unknown primitive kind: ${(prim as any).kind}`)
      }
      this.logger.trace({
        event: 'primitive_end',
        prim,
        latency_ms: Date.now() - start
      })
    } catch (e: any) {
      this.logger.trace({
        event: 'primitive_error',
        prim,
        error: e.message ?? String(e)
      })
      throw e
    }
  }

  // ============== 私有：move 实现 ==============

  private async executeMove(prim: Move): Promise<void> {
    const value = await this.resolveAddress(prim.from)
    await this.writeAddress(prim.to, value)
  }

  // ============== 私有：execute 实现 ==============

  private async executeExecute(prim: Execute): Promise<void> {
    // 1. 查找 operation
    const op = this.operations.get(prim.operation)
    if (!op) {
      throw new Error(`Operation not registered: ${prim.operation}`)
    }

    // 2. 解析所有 inputs (eager)
    const inputs: Record<string, Value> = {}
    for (const [paramName, addr] of Object.entries(prim.inputs)) {
      inputs[paramName] = await this.resolveAddress(addr)
    }

    // 3. 构造 ExecutionContext
    // ⚠️ 新版 ExecutionContext 增加了 pushErrorHandler 等能力（见 doc 10 §五）
    const ctx: ExecutionContext = {
      env: this.env,
      logger: this.logger,
      signal: new AbortController().signal  // MVP 简化
    }

    // 4. 调用 operation
    const start = Date.now()
    this.logger.trace({
      event: 'operation_call',
      operation: prim.operation,
      input_keys: Object.keys(inputs)
    })
    const outputs = await op.execute(inputs, ctx)
    this.logger.trace({
      event: 'operation_return',
      operation: prim.operation,
      output_keys: Object.keys(outputs),
      latency_ms: Date.now() - start
    })

    // 5. 写入所有 outputs
    for (const [paramName, addr] of Object.entries(prim.outputs)) {
      const value = outputs[paramName]
      if (value === undefined) {
        throw new Error(
          `Operation '${prim.operation}' did not produce required output '${paramName}'`
        )
      }
      await this.writeAddress(addr, value)
    }
  }

  // ============== 私有：Address 解析 ==============
  // ✅ 这部分代码在新版中仍然使用

  private async resolveAddress(addr: Address): Promise<Value> {
    switch (addr.kind) {
      case 'literal':
        return addr.value

      case 'variable': {
        const v = this.dataArea.get(addr.name)
        if (v === undefined) {
          throw new Error(`Variable not found: ${addr.name}`)
        }
        return v
      }

      case 'file': {
        return await this.readFile(addr.path)
      }

      case 'field': {
        const parent = await this.resolveAddress(addr.parent)
        return this.accessField(parent, addr.path)
      }

      case 'stream': {
        return this.dataArea.get(`stream:${addr.source}`) ?? null
      }

      default:
        throw new Error(`Unknown address kind: ${(addr as any).kind}`)
    }
  }

  private async writeAddress(addr: Address, value: Value): Promise<void> {
    switch (addr.kind) {
      case 'variable':
        this.dataArea.set(addr.name, value)
        break

      case 'file':
        await this.writeFile(addr.path, value)
        break

      case 'literal':
        throw new Error('Cannot write to literal address')

      default:
        throw new Error(`Cannot write to address kind: ${addr.kind}`)
    }
  }

  // ============== 私有：IO 实现 ==============

  protected async readFile(path: string): Promise<Value> {
    const fs = await import('fs/promises')
    return await fs.readFile(path, 'utf-8')
  }

  protected async writeFile(path: string, value: Value): Promise<void> {
    const fs = await import('fs/promises')
    await fs.writeFile(path, String(value))
  }

  protected accessField(parent: Value, path: string): Value {
    // 简单实现：支持 . 和 [n]
    if (parent === null || parent === undefined) {
      throw new Error(`Cannot access field '${path}' of null/undefined`)
    }
    if (typeof parent === 'object' && !Array.isArray(parent) && 'kind' in parent) {
      // struct value
      if (parent.kind === 'struct') {
        return this.accessStructField(parent.obj, path)
      }
      if (parent.kind === 'list') {
        return this.accessListIndex(parent.items, path)
      }
    }
    throw new Error(`Field access not supported on value: ${JSON.stringify(parent).slice(0, 50)}`)
  }

  private accessStructField(obj: Record<string, Value>, path: string): Value {
    if (path in obj) return obj[path]
    throw new Error(`Field '${path}' not found in struct`)
  }

  private accessListIndex(items: Value[], path: string): Value {
    const match = path.match(/^\[(\d+)\]$/)
    if (!match) throw new Error(`Invalid list index syntax: ${path}`)
    const idx = parseInt(match[1], 10)
    if (idx >= items.length) throw new Error(`List index out of range: ${idx}`)
    return items[idx]
  }
}
```

---

## 六、Operation 接口与注册机制

### 6.1 Operation 是普通对象

```typescript
// src/l1/operations/file_read.ts

import type { Operation } from '../types'
import * as fs from 'fs/promises'

export const fileRead: Operation = {
  // ===== Metadata (L3 用) =====
  name: 'file_read',
  description: 'Read file content as UTF-8 string',
  inputs: {
    path: { type: 'path', required: true, description: 'Path to file' },
    encoding: { type: 'string', required: false, default: 'utf-8' }
  },
  outputs: {
    content: { type: 'string', required: true, description: 'File content' }
  },

  // ===== Implementation (L1 用) =====
  execute: async (inputs, ctx) => {
    const path = inputs.path as string
    const encoding = (inputs.encoding as string) ?? 'utf-8'
    const content = await fs.readFile(path, encoding)
    return { content }
  }
}
```

### 6.2 类形式（用于有内部状态的复杂 operation）

```typescript
// src/l1/operations/docker_run.ts

import type { Operation, Value, ExecutionContext } from '../types'
import { Docker } from 'dockerode'

export class DockerRunOp implements Operation {
  // ===== Metadata =====
  readonly name = 'docker_run'
  readonly description = 'Run a command in a Docker container'
  readonly inputs = {
    image: { type: 'string', required: true } as const,
    command: { type: 'string', required: true } as const,
    timeout: { type: 'number', required: false } as const
  }
  readonly outputs = {
    stdout: { type: 'string', required: true } as const,
    stderr: { type: 'string', required: true } as const,
    exit_code: { type: 'number', required: true } as const
  }

  // ===== Instance state (可跨多次 execute 共享) =====
  private docker = new Docker()
  private activeContainers = new Map<string, string>()

  async execute(
    inputs: Record<string, Value>,
    ctx: ExecutionContext
  ): Promise<Record<string, Value>> {
    // ... 使用 this.docker, this.activeContainers ...
    return { stdout: '', stderr: '', exit_code: 0 }
  }
}
```

**类形式 vs 对象形式**：

| 维度 | 对象形式 | 类形式 |
|---|---|---|
| 复杂度 | 简单 | 较复杂 |
| 内部状态 | 无 | 有（实例字段）|
| 单例 vs 多例 | 单例 | 可创建多个实例 |
| 注册方式 | `runtime.registerOperation(op)` | `new DockerRunOp()` 后注册 |
| 适用场景 | 无状态 IO 操作 | 需要跨调用维护状态 |

**MVP 优先用对象形式**，仅在必要时用类形式。

---

## 七、动态加载机制

### 7.1 三种加载场景

| 场景 | 时机 | 机制 |
|---|---|---|
| **内置 8 个 operation** | 启动时 | 显式 import（编译期可见） |
| **扩展 operation** | 启动时 | 扫描目录 + 动态 import |
| **用户临时注册** | 运行时 | 调用 `runtime.registerOperation(op)` |

### 7.2 启动时加载内置

```typescript
// src/l1/loader.ts

import { L1Runtime } from './runtime'
import type { EnvironmentContext } from '../env/types'

/**
 * 加载所有内置 operations
 * 编译期 import 可见，类型安全
 */
export async function loadBuiltinOps(runtime: L1Runtime): Promise<void> {
  const [
    { fileRead },
    { fileWrite },
    { globMatch },
    { grepSearch },
    { shellExec },
    { stringReplace },
    { sortBy },
    { takeFirst }
  ] = await Promise.all([
    import('./operations/file_read.js'),
    import('./operations/file_write.js'),
    import('./operations/glob_match.js'),
    import('./operations/grep_search.js'),
    import('./operations/shell_exec.js'),
    import('./operations/string_replace.js'),
    import('./operations/evaluate_expr.js'),
    import('./operations/evaluate_collection.js')
  ])

  runtime.registerOperations([
    fileRead, fileWrite, globMatch, grepSearch,
    shellExec, stringReplace, sortBy, takeFirst
  ])
}
```

### 7.3 启动时加载扩展

```typescript
// src/l1/loader.ts (续)

import * as path from 'path'
import * as fs from 'fs/promises'
import { pathToFileURL } from 'url'

/**
 * 加载扩展 operations (类似 pi 的扩展机制)
 */
export async function loadExtensions(
  runtime: L1Runtime,
  extDirs: string[]
): Promise<void> {
  for (const dir of extDirs) {
    let files: string[]
    try {
      files = await fs.readdir(dir)
    } catch {
      continue  // 目录不存在则跳过
    }

    for (const file of files) {
      if (!file.endsWith('.js') && !file.endsWith('.ts')) continue

      const fullPath = path.join(dir, file)
      await loadExtensionFile(runtime, fullPath)
    }
  }
}

async function loadExtensionFile(
  runtime: L1Runtime,
  fullPath: string
): Promise<void> {
  try {
    // 动态 import (ESM) - 关键 API
    const module = await import(pathToFileURL(fullPath).href)
    const defaultExport = module.default

    if (typeof defaultExport === 'function') {
      // 扩展默认导出是注册函数 (pi 风格)
      // 例: export default function(pi) { pi.registerOperation({...}) }
      defaultExport({
        registerOperation: (op: Operation) => runtime.registerOperation(op),
        env: runtime.env,
        logger: runtime.logger
      })
    } else if (defaultExport?.operations) {
      // 或者直接导出 operations 数组
      runtime.registerOperations(defaultExport.operations)
    }
  } catch (e: any) {
    console.warn(`Failed to load extension ${fullPath}: ${e.message}`)
  }
}
```

**扩展文件示例**：

```typescript
// ~/.pi/l1-extensions/my-extension.ts

import type { Operation } from 'pi-mvp/l1/types'

const myOp: Operation = {
  name: 'http_get',
  description: 'Fetch a URL',
  inputs: {
    url: { type: 'string', required: true }
  },
  outputs: {
    body: { type: 'string', required: true },
    status: { type: 'number', required: true }
  },
  execute: async (inputs) => {
    const response = await fetch(inputs.url as string)
    return {
      body: await response.text(),
      status: response.status
    }
  }
}

export default function(api: {
  registerOperation: (op: Operation) => void
}) {
  api.registerOperation(myOp)
}
```

### 7.4 用户运行时注册

```typescript
// 用户在交互中临时注册新 operation
runtime.registerOperation({
  name: 'greet_user',
  inputs: { name: { type: 'string', required: true } },
  outputs: { greeting: { type: 'string', required: true } },
  execute: async (inputs) => ({
    greeting: `Hello, ${inputs.name}!`
  })
})

// 之后 L3 编译器可以为它编出 sequence
```

---

## 八、Address 解析器详解（双区架构版）

### 8.1 解析规则

| Address Kind | resolve 行为 | write 行为 |
|---|---|---|
| `literal` | 返回 `addr.value` | 抛 `AddressError`（不可写）|
| `public` | 查 `publicStore`，返回对应值 | 写入 `publicStore` |
| `internal` | 查 `internalStore`，返回对应值 | 写入 `internalStore` |
| `file` | 读文件，返回内容 | 写文件 |

**不再支持的 kind**（原设计）：`variable` / `stream` / `field`（详见 [doc 06 §四.4](./06-execution-layer.md#44-不再支持的-address-类型)）。

### 8.2 跨区约束（强制）

execute_op / execute_intent / conditional_skip **只能读写 internal**。这意味着：

```typescript
// ✅ 正确：internal only
{ kind: 'execute_op', operation: 'file_read',
  inputs: { path: { kind: 'internal', name: '$r0' } },
  outputs: { content: { kind: 'internal', name: '$r1' }, error: { kind: 'internal', name: '$r_err' } } }

// ❌ 错误：inputs 不能是 literal
{ kind: 'execute_op', operation: 'file_read',
  inputs: { path: { kind: 'literal', value: '/tmp/x' } } }  // 报错

// ❌ 错误：outputs 不能是 public
{ kind: 'execute_op', operation: 'file_read',
  outputs: { content: { kind: 'public', name: 'content' } } }  // 报错
```

`move` 是唯一的跨区桥梁：literal / public / internal / file 之间的数据搬运必须通过 `move`。

### 8.3 Address 解析失败的语义

```typescript
// 解析失败 → sequence 中止
// 错误信息应包含：哪个 primitive 的哪个 Address

try {
  await runtime.execute(prim)
} catch (e) {
  // 错误示例：
  //   "Public variable not found: $readme (in primitive: execute(file_read))"
  //   "Internal register not found: $r5 (in primitive: execute(file_read))"
  //   "Failed to read file '/etc/x': ENOENT (in primitive: move(from: file))"
  //   "Cannot write to literal address (in primitive: move(to: literal))"
}
```

**双区架构错误类型**（所有抛错统一为 `AddressError`，2026-08-20 增强）：

**`AddressError` 接口**：

```typescript
export class AddressError extends Error {
  readonly code: string | undefined   // 错误码（原始 fs code 或自定义分类）

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'AddressError'
    this.code = code
  }
}
```

**错误码约定**：

| code | 含义 | 触发场景 | 示例 |
|---|---|---|---|
| `LITERAL_WRITE` | 编程错误 | 写入 literal Address | `writeAddress(literal, ...)` |
| `VARIABLE_NOT_FOUND` | 语义错误 | public/internal 不存在 | `resolveAddress({public, missing})` |
| `ENOENT` | 文件不存在 | fs.readFile 文件不存在 | （原始 fs 错误码透传）|
| `EACCES` | 权限拒绝 | fs.writeFile 不可写 | （原始 fs 错误码透传）|
| 其他 fs code | 其他文件系统错误 | ENOTDIR, EISDIR 等 | （原始 fs 错误码透传）|
| `undefined` | 未分类错误 | 理论上不应该 | 默认值 |

**错误场景**：

| 场景 | `err.message` 示例 | `err.code` |
|---|---|---|
| public 不存在 | `Public variable not found: $name` | `VARIABLE_NOT_FOUND` |
| internal 不存在 | `Internal register not found: $r5` | `VARIABLE_NOT_FOUND` |
| file 不存在 | `Failed to read file '/path': ENOENT: no such file...` | `ENOENT`（原始 fs code 透传）|
| file 权限拒绝 | `Failed to read file '/etc/x': EACCES: permission denied` | `EACCES` |
| file 其他 IO 错误 | `Failed to write file '/x': <message>` | `ENOTDIR` / `EISDIR` / ... |
| 写入 literal | `Cannot write to literal address (literal is read-only)` | `LITERAL_WRITE` |

**DAG 决策能力**（设计意图）：

`err.code` 使 DAG 可以基于错误类型做不同处理，而非仅基于 truthy 判断：

```typescript
// DAG 编译产物：
[
  { kind: 'execute_op', operation: 'file_read', inputs: {path: $r0}, outputs: {content: $r1, error: $r_err} },

  // 根据 $r_err.code 做不同处理
  { kind: 'conditional_skip', conditionAddr: $r_err, n: ... },  // 错误跳过成功块

  // ... 成功块 ...

  { kind: 'skip_n', n: ... },

  // 检查错误码分支（如果需要）
  // **重构后**（2026-08-20）：用 evaluate_expr 替代 string_equals + extract_error_code 链
  { kind: 'execute_op', operation: 'evaluate_expr',
    inputs: { expr: {
      type: 'op',
      name: '==',
      args: [
        { type: 'op', name: 'error_code', args: [{ kind: 'internal', name: '$r_err' }] },
        { type: 'literal', value: 'ENOENT' }
      ]
    }},
    outputs: { result: $r_is_enoent } },

  { kind: 'conditional_skip', conditionAddr: $r_is_enoent, n: ... },
  // ... ENOENT 处理：创建默认文件 ...
  // ... 其他错误处理：报告错误 ...
]
```

**实现细节**（参见 [prototype `address-resolver.ts`](../../mvp-prototype/src/l1/address-resolver.ts)）：

- `extractErrorInfo(err)` helper：处理 Error / 非 Error 两种情况
- 非 Error 抛出走 `NON_ERROR_THROW` code（防御性，生产不会触发）
- 详细设计反馈见 `mvp-prototype/docs/dev-log/2026-08-20-coverage-reflection.md`

---

## 九、与 L3 编译器的衔接

> ⚠️ **本节已被响应式执行模型更新**：原描述中 L3 是"编译期"的工具，被 L1 调用以验证 schema。响应式模型下，L3 是被 L1 **运行时**调用的 service，每次分解一个 intent 一层（详见 [doc 10 §四](./10-reactive-execution-model.md#四l3-服务契约)）。

### 9.1 运行期使用 metadata + formalSpec（双区架构版）

L3 编译服务**只读** Operation 的 `formalSpec`（形参元数据）：

```typescript
// src/l3/compiler.ts (双区架构版)

import type { Operation } from '../l2/operation'
import type { ExecutionState } from '../l1/execution-state'
import type { StackEntry, Address } from '../l1/types'

export function compileReadLatestLog(
  intent: Intent,
  registry: Map<string, Operation>,  // ← 只读 metadata
  state: ExecutionState              // ← 提供 allocator
): StackEntry[] {
  const globMatch = registry.get('glob_match')!
  const evaluateCollection = registry.get('evaluate_collection')!
  const fileRead = registry.get('file_read')!

  // 编译期检查：所有 required inputs 必须有值
  //   globMatch.formalSpec.inputs.pattern.required === true ✓
  //   evaluateCollection.formalSpec.inputs.expr.required === true ✓

  // 从 allocator 分配寄存器
  const r0 = state.allocator.allocate()  // '$r0' (glob pattern)
  const r1 = state.allocator.allocate()  // '$r1' (logs)
  const r2 = state.allocator.allocate()  // '$r2' (collection expr)
  const r3 = state.allocator.allocate()  // '$r3' (latest)
  const r4 = state.allocator.allocate()  // '$r4' (content)
  const rErr = state.allocator.errorRegister()  // '$r_err'

  return [
    // 1. move literal(glob) → $r0
    { kind: 'move', id: 'm1', parentIntentId: intent.id, createdAt: Date.now(),
      from: { kind: 'literal', value: '*.log' },
      to: { kind: 'internal', name: r0 } },

    // 2. execute_op glob_match ($r0 → $r1)
    { kind: 'execute_op', id: 'op1', parentIntentId: intent.id, createdAt: Date.now(),
      operation: 'glob_match',
      inputs: { pattern: { kind: 'internal', name: r0 } },
      outputs: { matches: { kind: 'internal', name: r1 } },
      status: 'pending' },

    // 3. move literal(collection expr) → $r2
    { kind: 'move', id: 'm2', parentIntentId: intent.id, createdAt: Date.now(),
      from: { kind: 'literal', value: {
        type: 'pipe',
        source: { type: 'var', name: 'items' },
        stages: [
          { op: 'sort', args: [
            { type: 'literal', value: 'mtime' },
            { type: 'literal', value: true }
          ]},
          { op: 'take', args: [{ type: 'literal', value: 1 }] }
        ]
      }},
      to: { kind: 'internal', name: r2 } },

    // 4. execute_op evaluate_collection ($r1, $r2 → $r3)
    { kind: 'execute_op', id: 'op2', parentIntentId: intent.id, createdAt: Date.now(),
      operation: 'evaluate_collection',
      inputs: {
        expr: { kind: 'internal', name: r2 },
        env: { kind: 'literal', value: { items: r1 } }
      },
      outputs: { result: { kind: 'internal', name: r3 } },
      status: 'pending' },

    // 5. execute_op file_read ($r3 → $r4, $r_err)
    { kind: 'execute_op', id: 'op3', parentIntentId: intent.id, createdAt: Date.now(),
      operation: 'file_read',
      inputs: { path: { kind: 'internal', name: r3 } },
      outputs: { content: { kind: 'internal', name: r4 }, error: { kind: 'internal', name: rErr } },
      status: 'pending' }
  ]
}
```

**关键观察**（双区架构）：

- L3 通过 `state.allocator.allocate()` 分配寄存器（从 L1 拿到 allocator）
- L3 通过 `formalSpec` 读形参元数据（businessName ↔ register 映射）
- 所有 execute_op 的 inputs/outputs 必须是 internal（literal 必须先 move）
- `error` 输出通常写到 `$r_err`（全局错误寄存器）
- L3 只生成 StackEntry，不调用 `op.execute()`（执行是 L1 的事）

**Allocator 生命周期**：
- 每个外部意图处理循环初始化一次（通过 `createInitialState` 创建）
- L3 编译时递增分配（同一 intent 的不同子意图复用同一 allocator）
- 递归 intent 也复用同一 allocator（通过 state 传递）

### 9.2 运行时 schema 校验

> ⚠️ "编译期"改为"运行时"——L3 在每次 compile 调用时校验（详见 doc 10 §四）。

```typescript
// src/l3/validator.ts (双区架构版)

import type { Operation, FormalParam } from '../l2/operation'
import type { StackEntry, Address } from '../l1/types'
import { isInternalAddress } from '../l1/types'

export function validatePrimitive(
  entry: StackEntry,
  registry: Map<string, Operation>
): ValidationResult {
  if (entry.kind === 'move') {
    return validateMove(entry)
  }

  if (entry.kind === 'execute_op' || entry.kind === 'execute_intent') {
    // execute_op 校验...
    if (entry.kind === 'execute_op') {
      const op = registry.get(entry.operation)
      if (!op) {
        return { ok: false, error: `Unknown operation: ${entry.operation}` }
      }

      // 检查所有 required inputs 都提供，且是 internal
      for (const [paramName, param] of Object.entries(op.formalSpec.inputs)) {
        if (param.required && !(paramName in entry.inputs)) {
          return {
            ok: false,
            error: `Missing required input '${paramName}' for operation '${entry.operation}'`
          }
        }

        const addr = entry.inputs[paramName]
        if (addr && !isInternalAddress(addr)) {
          return {
            ok: false,
            error: `Input '${paramName}' must be internal (got ${addr.kind}). Use move to copy from literal/public/file first.`
          }
        }
      }

      // 检查 outputs 都是 internal
      for (const [paramName, addr] of Object.entries(entry.outputs)) {
        if (!isInternalAddress(addr)) {
          return {
            ok: false,
            error: `Output '${paramName}' must be internal (got ${addr.kind})`
          }
        }
      }
    }
  }

  if (entry.kind === 'conditional_skip') {
    if (!isInternalAddress(entry.conditionAddr)) {
      return {
        ok: false,
        error: `conditionAddr must be internal (got ${entry.conditionAddr.kind})`
      }
    }
  }

  return { ok: true }
}
```

---

## 十、关键设计决策

### D1. 为什么选 TypeScript（MVP）？

**决策**：MVP 阶段 L1 Runtime 完全用 TypeScript 实现。

**理由**：
- 与 pi 同生态，零 FFI 复杂度
- ESM 动态导入原生支持扩展机制
- L1 真实瓶颈在 IO 等待，TS 完全够用
- 后期可单独把 hot operation 下沉到 Rust（NAPI 暴露 async 函数）

**反例**（不选 Rust MVP）：
- 需要重新实现 ts 与 host 进程的胶水
- 增加构建复杂度（Rust 工具链、NAPI binding）
- MVP 阶段性能不是瓶颈

### D2. 为什么 Operation 用对象而非类？

**决策**：默认 Operation 是普通对象 `{ name, inputs, outputs, execute }`。

**理由**：
- 简单即正义：对象注册即用，类需要 `new`
- 大多数 operation 无状态，对象足够
- 注册表语义统一：key → Operation 对象
- 类形式保留给有内部状态的特殊情况

### D3. 为什么 Address 解析用 eager 而非 lazy？

**决策**：`execute` 前**全部解析** inputs，调用 operation 时所有 inputs 都是 Value。

**理由**：
- **失败前置**：缺值立刻报错，而非在 operation 内部
- **调试友好**：可以看到实际值进入 operation
- **operation 实现简单**：operation 只关心业务逻辑，不用处理 Address

**反例**（lazy）：
- 失败延迟到 operation 内部，调试难
- operation 需要自己处理 Address → Value 转换
- 与"operation 接收已校验 Value"的契约不一致

### D4. 为什么 Operation 失败用 throw？（已修订）

**决策**：**已被响应式执行模型重大更新**——详见 [doc 10 §五/§七](./10-reactive-execution-model.md)。

**原决策**（已过时）：operation 内部 throw → 整个 sequence 中止。

**新决策**（错误处置权在 L3，2026-08-20 修订）：
- **op 返回错误数据**：Operation 返回 `{ value: null, error: OperationError }` 作为数据
  - L1 正常完成，DAG 通过 conditional_skip 处理（$r_err 检查）
  - 业务逻辑应在意图 DAG 中显式表达
- **op throw（任何异常）**：
  - 主循环 catch → bubbleError：写 $r_err（保留原始错误码）→ 找最近 handleError 帧截获
  - 无 handler → UnhandledError 冒泡给调用者
  - ❌ 原"硬错误 propagateHardError 逐层 abort"已废弃（见 doc 10 §三.8）
- **移除**：`ctx.pushErrorHandler()` 不再存在
- **ExecutionContext** 不再提供 pushErrorHandler 方法

**理由**：
- 业务逻辑（"file missing 后做什么"）应在意图 DAG 中显式表达
- DAG 条件分支让所有可能路径可见，是标准做法
- 错误处理与正常处理统一为同一个调度循环（5-case dispatch）
- 不需要 L1 内部特殊错误路径
- 错误处理即业务逻辑，不需要特殊语义

**file_read 修订示例**：

```typescript
// 新版：错误作为数据 + throw 交给 L1 冒泡
const fileRead: Operation = {
  name: 'file_read',
  outputs: {
    content: { type: 'string', required: false },
    error: { type: 'object', required: false }
  },
  execute: async (inputs, ctx) => {
    try {
      const content = await fs.readFile(inputs.path as string, 'utf-8')
      return { content, error: null }  // 成功
    } catch (err: any) {
      if (err.code === 'ENOENT' || err.code === 'EACCES') {
        return { content: null, error: { code: err.code, message: err.message } }  // 主动返回错误数据
      }
      throw err  // 其他异常：交给 L1 冒泡（L3 handleError 决定处置权）
    }
  }
}
```

**详细设计**见 [doc 10 §五/§六/§七](./10-reactive-execution-model.md)。

### D5. 为什么扩展用启动时加载而非懒加载？

**决策**：session 启动时扫描 + 加载所有扩展 operations。

**理由**：
- 依赖图清晰：所有可用 operation 在启动时已知
- 编译期可用：L3 编译器编 sequence 时就能看到所有 metadata
- 与 pi 现有扩展机制一致

**反例**（懒加载）：
- 编译时不知道 operation 是否存在，可能编出无法执行的 sequence
- 增加运行时复杂度（首次调用的延迟）

### D6. 为什么 L1 与 host 进程同进程？

**决策**：MVP 阶段 L1 Runtime 与 host 进程（如 pi）同进程。

**理由**：
- 简化架构：无需 IPC、无需序列化
- 性能：函数调用级开销
- 可直接调 pi tools / Node APIs

**未来演进**：若需要沙箱隔离，可拆为子进程 + RPC（JSON over stdin/stdout）。

### D7. 为什么不需要反射？

**决策**：L1 Runtime 完全不依赖反射 / 运行时类型检查。

**理由**：

| 如果用反射（Java/C# 风格）| 我们的方案 |
|---|---|
| `Class.getMethod('execute')` 查找方法 | `Map.get(name)` 查找 operation |
| `Type.getDeclaredFields()` 读 schema | schema 直接是普通数据 |
| 运行时类型检查 | TypeScript 编译期 + schema 校验 |
| 性能开销 | 零开销（Map 查找 O(1)）|

**Operation metadata 是纯数据**，TypeScript 编译期已校验字段类型。运行时只需要 Map 查找 + 函数调用。

### D8. 为什么 L3 编译器不直接调用 operation？

**决策**：L3 编译器只访问 `formalSpec`（形参元数据），**永不调用** `op.execute`。

**理由**：
- 关注点分离：L3 负责"算什么"，L1 负责"怎么算"
- L3 编译期不应有副作用
- L3 单元测试不需要 mock operation execute
- 可替换性：L3 编出的 sequence 与具体 operation 实现解耦

**双区架构补充**（2026-08-20）：
- L3 不仅读 metadata，还需要**分配寄存器**（通过 `state.allocator.allocate()`）
- L3 负责业务名 ↔ 寄存器的映射（通过 formalSpec）
- L1 负责持有 allocator 实例（生命周期）

---

## 十一、文件组织

```
src/
├── l1/                          # L1 Runtime 模块（双区架构）
│   ├── runtime.ts               # L1Runtime + l1MainLoop (5-case dispatch)
│   ├── types.ts                 # StackEntry (5 种), Address (4 kinds), FormalParam
│   ├── execution-state.ts       # ExecutionState (publicStore + internalStore + allocator)
│   ├── address-resolver.ts      # Address 解析 (resolve/writeAddress)
│   ├── register-allocator.ts    # RegisterAllocator (L1 拥有)
│   ├── primitives/              # 5 primitive 实现
│   │   ├── move.ts
│   │   ├── execute-op.ts
│   │   ├── execute-intent.ts
│   │   ├── skip-n.ts
│   │   └── conditional-skip.ts
│   └── trace.ts                 # TraceLogger 接口 + NullLogger 默认实现
├── l2/                          # L2 operations 模块（双区架构）
│   ├── operation.ts             # Operation 接口 + FormalParam + formalSpec
│   ├── errors.ts                # 标准 OperationError 结构
│   ├── registry.ts              # L2Registry (运行时)
│   └── builtin/                 # 内置 L2 operations
│       ├── file_read.ts
│       ├── file_write.ts
│       ├── glob_match.ts
│       ├── grep_search.ts
│       ├── shell_exec.ts
│       ├── string_replace.ts
│       ├── evaluate_expr.ts
│       └── evaluate_collection.ts
├── l3/                          # L3 编译器模块（双区架构）
│   ├── service.ts               # L3Service 接口 + compile(intent, state)
│   ├── compiler.ts              # StandardIntent → StackEntry[]
│   ├── allocator.ts             # (可选) L3 的寄存器预分配辅助
│   ├── validator.ts             # StackEntry schema 校验
│   └── standard-intents/        # 标准意图实现
│       └── ...
├── mocks/                       # Mock 设施（用于单元测试）
│   ├── mock-l2.ts               # MockOpTracker + createMockL2
│   └── mock-l3.ts               # createMockL3 + createSpyL3
├── env/                         # Environment Context 模块（doc 08）
│   ├── context.ts               # EnvironmentContext 接口
│   ├── detector.ts              # 自动检测器
│   └── ...
└── host.ts                      # 入口：构造 Runtime + 加载 builtin + 加载 extensions
```

---

## 十二、与 L2 微代码层的关系

> ⚠️ **L2 角色在响应式执行模型中的变化**：L2 不再仅是 L1 的"执行目标"，而是 L1 调用的一个 service（详见 [doc 10 §八](./10-reactive-execution-model.md#八与-l2l3-的关系重定义)）。L1 通过异构指令栈按需调度 L2（op 执行）和 L3（intent 分解）。

### 12.1 L2 是 L1 的"业务封装"

```
┌─────────────────────────────────────────┐
│ L3 Experience（经验）                │
│   ↓ compile 三段式                   │
│ L2 序列（file_read, glob_match, ...） │
│   ↓ execute_op 映射为                │
│ L1 序列（move + execute_op）          │
│   ↓ 执行                            │
│ 物理效果                            │
└─────────────────────────────────────────┘
```

**L2 operation 本身就是 L1 execute primitive 的"操作码"**。

L1 Runtime 不区分 L2 和"扩展 operation"——它们都是 Operation 注册表里的一项。

### 12.2 L2 的两类实现策略

每个 L2 operation 可选择：

| 实现策略 | 说明 | 适用 |
|---|---|---|
| **直接实现** | operation 内部直接调 fs / shell | 简单 IO（如 file_read、shell_exec）|
| **复合（microcode）** | operation 内部递归调用其他 operation | 业务复合（如 edit_file 可拆为 file_read + string_replace + file_write）|

MVP 阶段 8 个内置都用"直接实现"。后续可加入"复合 operation"模式：

```typescript
// 复合 operation 示例
export const editFile: Operation = {
  name: 'edit_file',
  inputs: {
    path: { type: 'path', required: true },
    find: { type: 'string', required: true },
    replace: { type: 'string', required: true }
  },
  outputs: {
    success: { type: 'boolean', required: true }
  },
  execute: async (inputs, ctx) => {
    // 内部复合: read → replace → write
    // 注意: 这种实现需要 access 其他 operation
    // 后续可设计 CompositeOperation 接口
    throw new Error('Not implemented yet')
  }
}
```

---

## 十三、与 Environment Context 的集成

### 13.1 `$env.*` 的解析

`$env.*` 不是 L1 Address 的原生类型，而是通过 `ExecutionContext.env` 暴露给 operation：

```typescript
// operation 内部访问 env
execute: async (inputs, ctx) => {
  const cwd = ctx.env.session.working_directory
  const projectType = ctx.env.project.type
  // ...
}
```

### 13.2 Operation 的 `default_source: 'environment'`

ParamSpec 可声明默认值来自 EnvironmentContext：

```typescript
{
  name: 'shell_exec',
  inputs: {
    command: { type: 'string', required: true },
    cwd: {
      type: 'path',
      required: false,
      default_source: 'environment',
      default_field: 'session.working_directory'
    }
  }
}
```

**解析时**（由完整性分析层负责，见 doc 04）：

1. 如果 primitive 提供 `cwd` → 用 primitive 的值
2. 否则从 `env.session.working_directory` 取
3. 否则报错

L1 Runtime **不直接处理** `default_source`——这是完整性分析层的职责。L1 只接收最终已解析的值。

---

## 十四、开放问题

### 14.1 异步取消（AbortSignal）

**问题**：长 operation（如 `shell_exec`）如何响应取消？

**当前**：MVP 阶段所有 operation 接收 `signal`，但**仅作为参数传递**。operation 自己决定是否监听。

**未来**：
- 标准化 operation 取消模式
- Runtime 检测 signal 主动中断
- 文件 IO 操作的取消支持

### 14.2 流式 IO

**问题**：`shell_exec` 输出可能很大（GB 级），一次返回整个字符串不合理。

**当前**：MVP 假设所有 operation 输出都装入 Data Area。

**未来**：
- `ReadableStream` 类型 Address
- operation 间通过 stream 串联（pipe 语义）

### 14.3 Operation 的依赖注入

**问题**：operation 之间如何共享资源（如数据库连接池）？

**当前**：每个 operation 自己 new 出依赖（如 `DockerRunOp` 的 `Docker` 实例）。

**未来**：
- L1 Runtime 提供 `opContext` 注入共享资源
- 类似 FastAPI 的 `Depends` 机制

### 14.4 Operation 的版本管理

**问题**：operation 升级时，旧 primitive 序列如何兼容？

**当前**：MVP 不处理。

**未来**：
- Operation metadata 加 `version: string`
- Primitive 编 operation 时绑定版本
- Runtime 检测不匹配时尝试 fallback

### 14.5 L1 Runtime 的多线程/多 worker

**问题**：单个 sequence 是否能并行执行独立 primitive？

**当前**：MVP 单线程顺序执行。

**未来**：
- 检测 `move + execute` 的 DAG 依赖
- 无依赖 primitive 并行执行
- Worker 池管理

### 14.6 错误恢复策略

**问题**：某个 primitive 失败时，是否能跳到 fallback primitive？

**当前**：失败立即中止整个 sequence。

**未来**：
- Primitive 加 `on_error: 'continue' | 'abort' | 'fallback:<prim_index>'`
- 完整性分析层支持错误处理声明

---

## 十五、设计意图一页纸

### 一句话定义

**L1 Runtime 是 TypeScript 实现的 5-primitive 调度器**，通过异构指令栈调度 L2（execute_op）和 L3（execute_intent + DAG 条件分支编译），采用 Registry + 动态加载机制支持扩展 operation，**循环通过递归 intent 引用实现**，无需反射。

> ⚠️ **本节需结合 [doc 10](./10-reactive-execution-model.md) 理解**：本页保留 L1 的基础能力描述；doc 10 定义 L1 的执行语义（5-case 调度器主循环、异构指令栈、异常冒泡 + handleError 标志）。

### 核心架构

```
L4 (one-shot, LLM)
     │ RecognizedIntent
     ▼
┌─ L1 调度器 Main Loop ────────────────────────────────┐
│                                                        │
│  Instruction Stack (5 primitive 混合)               │
│  ResultStore (全局结果寻址)                          │
│  Environment Context (会话级元数据)                  │
│                                                        │
│  while (stack.length > 0) {                           │
│    top = stack[-1]                                    │
│    switch (top.kind) {                                 │
│      case 'move':              → 数据搬运             │
│      case 'execute_op':        → L2.execute          │
│      case 'execute_intent':    → L3.compile          │
│      case 'skip_n':            → 无条件跳转           │
│      case 'conditional_skip':  → 条件跳转             │
│    }                                                  │
│                                                        │
│  on execute_op throws:                                │
│    → 异常冒泡：$r_err 写入 → 找最近 handleError 帧 ⭐ │
                                                        │
│  循环 = 递归 intent 引用 + conditional_skip ⭐ │
└─────┬──────────────────────────┬───────────────────────┘
      ↓                          ↓
   L2: Operation              L3: Intent
   (返回 outputs           (返回 children
    含 error 数据)            含 DAG 条件分支编译)
```

### 关键决策（8 个）

- **D1**: TypeScript MVP（性能下沉逃生通道：单 op NAPI）
- **D2**: Operation 用对象形式（类仅特殊场景）
- **D3**: Address 解析 eager（失败前置）
- **D4**: 错误处置权在 L3（错误作为数据 + throw 冒泡 + handleError 标志）⭐
- **D5**: 扩展启动时加载（编译期可见）
- **D6**: L1 与 host 同进程（简化架构）
- **D7**: 零反射（schema 是纯数据）
- **D8**: L3 不调用 execute（关注点分离）

### MVP 范围

- L1Runtime 核心类（runtime.ts）
- 8 个内置 L2 operation
- 动态加载机制（loader.ts）
- Trace Logger（NullLogger 默认）
- 与 Environment Context 集成（通过 ExecutionContext.env）
- 与 L3 编译器的衔接（registry.get + schema 校验）

### 文件清单

```
src/l1/
├── runtime.ts       (~200 行)
├── types.ts         (~100 行)
├── address.ts       (~50 行)
├── loader.ts        (~80 行)
├── trace.ts         (~30 行)
└── operations/      (8 个文件, 每个 ~30 行)
```

### 演进路径

| 阶段 | 内容 |
|---|---|
| **MVP** | 同进程 TS，8 个内置 op，启动加载扩展 |
| **v1.1** | 复合 operation (microcode)，Result 对象错误处理 |
| **v1.2** | 热路径下沉 Rust（NAPI） |
| **v2** | L1 独立进程（沙箱 + RPC），流式 IO，并行执行 |

---

## 十六、参考与交叉引用

- **doc 02** 翻译层假说：解释为什么需要 L1 这种"硬件层"确定性
- **doc 03** 六层架构：L1 在整体流水线中的位置
- **doc 06** 执行层设计：L1 词汇表（move/execute/Address/Operation）的精确定义
- **doc 07** 意图库：L3 编译器如何编出 L1 序列（自顶向下视角）
- **doc 08** Environment Context：L1 通过 ExecutionContext.env 访问环境
- **doc 04** MVP 范围：完整性分析层负责 default_source 等参数补全
- **doc 05** 实施路线图：L1 Runtime 的实施步骤（在 Week 1-2）