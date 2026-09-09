# 10 - 响应式执行模型：L1 调度器 + 异构指令栈

> L1 是**调度器**而非执行器；L3 是**被调用的服务**而非编译阶段；错误处理是**DAG 条件分支**（业务逻辑）+ **L1 异常冒泡**（处置权在 L3，handleError 标志）。整个执行模型围绕**异构指令栈 + 5 个 L1 primitive**展开。

本文档是**响应式执行模型**的权威定义。它**重构**了 doc 06 / 07 / 09 中关于 L1 / L3 / 错误处理的旧模型（AOT 编译 + 顺序执行 + 错误分析器）。

---

## 决策摘要

执行模型从 **AOT 编译**转向**解释执行 + 按需分解 + DAG 条件控制流**：

| 维度 | 旧模型（AOT） | 新模型（响应式）|
|---|---|---|
| **L1 角色** | 执行器（执行 Primitive 序列） | **调度器**（5 个 primitive 调度） |
| **L3 角色** | 编译阶段（一次性编完 DAG） | **被调服务**（按需分解一个 intent 一层） |
| **执行驱动** | 完整 Primitive 序列 | **异构指令栈**（5 种 entry 混合） |
| **L1 Primitive 数量** | 2（move + execute）| **5**（move / execute_op / execute_intent / skip_n / conditional_skip）|
| **错误处理路径** | L1 内部 catch + 错误分析器 | **DAG 条件分支**（业务逻辑）+ **L1 异常冒泡**（L3 决定处置权） |
| **错误处理单位** | ErrorHandlerEntry（特殊 intent）| **handleError 标志 + 冒泡截获** + **DAG if-then-else** |
| **L2 Op 契约** | 失败 throw | **错误作为数据返回** + throw 交给 L1 冒泡（L3 决定处理） |
| **ExecutionContext.pushErrorHandler** | 有 | **移除**（业务逻辑应放在 DAG 中）|
| **代码路径** | 多种（正常 + 错误 + 重规划）| **5 种**（move / execute_op / execute_intent / skip_n / conditional_skip）|
| **执行深度** | 一次编完 → 一次跑完 | **L3 每次只分解一层，L1 驱动深度** |

**核心统一原则**：所有路径（正常执行、错误恢复、用户交互、重规划、条件分支、**循环**）**都走同一个调度循环**，区别仅在栈上压入的 primitive 类型。

**循环实现**：通过**递归 intent 引用** + `conditional_skip`实现，不增加 `loop` primitive。
- 意图 A 的 L3 编译结果末尾可以包含对 A 自身的引用
- 终止条件通过 `conditional_skip` 控制
- L1 自动跟踪递归深度作为安全网
- L1 vocabulary 保持 5 primitive（不变）

---

## 一、模型总览（双区架构版）

### 1.1 架构图（2026-08-20 重写）

```
                   User Natural Language
                            ↓ (one-shot)
                         L4: LLM
                            ↓ RecognizedIntent
                            ↓
            ┌────── L1 调度器 Main Loop ──────────┐
            │                                       │
            │  ┌─ 指令栈（异构）───────────────┐ │
            │  │ [intent, op, skip, cond_skip│ │
            │  │  , move, ...]                  │ │
            │  └────────────────────────────────┘ │
            │  ┌─ 双区数据存储 ─────────────────┐ │
            │  │ publicStore：业务数据（持久）  │ │
            │  │ internalStore：寄存器（瞬态）  │ │
            │  │   物理寄存器: $S<scope>.in/out<k> │ │
            │  │   业务变量: $r_<name>, $r_input_<key> │ │
            │  │   全局功能: $err, $path       │ │
            │  └────────────────────────────────┘│ │
            │  ┌─ RegisterAllocator（L1 拥有）─┐│ │
            │  │ 每个外部意图循环初始化一次    │ │
            │  │ L3 通过 state.allocator.allocate()││
            │  └────────────────────────────────┘│ │
            │                                       │
            │  while (stack.length > 0) {         │
            │    top = stack[-1]                   │
            │    switch (top.kind) {               │
            │      case 'move': → 跨区搬运        │
            │      case 'execute_op': → L2.execute │
            │      case 'execute_intent': → L3     │
            │      case 'skip_n': → 无条件跳转     │
            │      case 'conditional_skip': → 条件 │
            │    }                                 │
            │  }                                   │
            │                                       │
            │  on execute_op throws:               │
            │    → 异常冒泡（处置权在 L3）⭐      │
            │    → $r_err 写入异常信息            │
            │    → 找最近 handleError 帧 → 截获   │
            │    → 无 handler → 向上传播到调用者  │
            └─────┬─────────────────────┬──────────┘
                  │                     │
                  ↓                     ↓
        ┌──────────────────┐  ┌──────────────────┐
        │ L2: Operation     │  │ L3: Service      │
        │ Registry          │  │                  │
        │ file_read 等      │  │ compile(intent,  │
        │ execute(inputs)   │  │   state)         │
        │ (返回 error 数据) │  │ → children       │
        │ 或 throw 异常   │  │ (使用 allocator  │
        │                  │  │  分配寄存器)     │
        └──────────────────┘  └──────────────────┘
```

### 1.2 关键定义

| 概念 | 定义 |
|---|---|
| **L1 调度器** | 中央调度循环；维护指令栈、双区存储、调用 L2/L3、调度控制流 |
| **指令栈（Instruction Stack）**| 异构 frame 列表，每个 frame 是 5 种 L1 primitive 之一 |
| **StackEntry** | 栈成员；按 `kind` 区分（`move`/`execute_op`/`execute_intent`/`skip_n`/`conditional_skip`） |
| **L1 Primitive** | L1 调度器直接处理的 5 种指令：move / execute_op / execute_intent / skip_n / conditional_skip |
| **OpEntry** | 栈成员之一；对应一次 L2 operation 调用 |
| **IntentEntry** | 栈成员之一；对应一个待分解的 Experience（包含 type + params）或 RecognizedIntent |
| **L3 Service** | 被 L1 调用的服务；接收 intent + state，返回 children（含 if-then-else 编译后的控制流 entry） |
| **L2 Registry** | L2 operations 的注册表；通过 Map 查找 |
| **publicStore** | 业务数据区（持久，业务命名） |
| **internalStore** | 寄存器区（瞬态，寄存器命名 `$r0`, `$r1`, `$r_err`） |
| **RegisterAllocator** | L1 拥有的寄存器分配器；每个外部意图循环初始化一次 |
| **FormalParam** | 形参元数据：`businessName` ↔ `register`（必填） |
| **业务逻辑** | DAG 条件分支（if-then-else）通过 skip_n/conditional_skip 表达 |
| **异常冒泡** | 任何异常由 L1 主循环捕获；处置权在 L3（handleError 标志）：写 $r_err → 找最近 handleError 帧截获；无 handler → 传播给调用者 |
| **handleError** | IntentEntry 必填标志（L3 编译期设置）：true = 本层异常由后续指令读 $r_err 处理；false = 默认向上冒泡 |
| **循环** | 通过**递归 intent 引用** + `conditional_skip` 实现，不增加新 primitive（见 §六.5）|

### 1.3 与旧文档的关系

| 旧文档章节 | 变化 |
|---|---|
| doc 06 §3 Primitive 规范 | **重大修订**——从 2 primitive（move+execute）改为 5 primitive |
| doc 06 §8 编译示例 | **修订**——展示 DAG 条件分支的编译结果 |
| doc 06 §11.3 错误恢复 | **大幅修订**——指向本文档"异常冒泡（handleError）"和"DAG 条件分支" |
| doc 07 §5 DAG 解析 | **重大修订**——从全量展开改为按需一层 + if-then-else 编译 |
| doc 07 §6 L2/L1 映射 | **修订**——L2/L1 都是 L1 调用的服务 |
| doc 09 §5 L1Runtime 核心 | **重大重写**——5 case dispatch + 异常冒泡 |
| doc 09 §10 D4 错误处理 | **删除**——错误处理不再需要特殊 L1 路径 |
| doc 04 §失败模式目录 | **修订**——基于新错误模型 |

> **2026-08-20 错误模型修订**：原"已知错误 vs 硬错误二分"（L2 op 自分类）已废弃。
> 新模型：**错误处置权在 L3**——是否捕捉/处理由 L3 编译的 handleError 标志决定，
> 无标志默认由 L1 递归向上冒泡。详见 §三.8/§三.9。

---

## 二、异构指令栈（双区架构版）

### 2.1 数据结构（双区架构版，2026-08-20 重写）

```typescript
// ============== Address（4 kinds）==============
type Address =
  | { kind: 'literal'; value: Value }              // 字面量（仅作为 move 源）
  | { kind: 'public'; name: string }               // 业务数据（持久）
  | { kind: 'internal'; name: string }             // 寄存器（瞬态）
  | { kind: 'file'; path: string }                 // 文件路径

// ============== 基础 ==============

interface BaseEntry {
  id: string                       // 全局唯一 ID
  parentIntentId: string | null    // 父意图 ID（用于异常冒泡）
  createdAt: number
}

// ============== 5 种栈成员 ==============

interface MoveEntry extends BaseEntry {
  kind: 'move'
  from: Address                       // 任意 kind
  to: Address                          // 非 literal
}

interface OpEntry extends BaseEntry {
  kind: 'execute_op'
  operation: string
  inputs: Record<string, Address>     // 仅 internal（双区架构约束）
  outputs: Record<string, Address>    // 仅 internal（双区架构约束）
  status: 'pending' | 'running' | 'done' | 'error'
}

interface IntentEntry extends BaseEntry {
  kind: 'execute_intent'
  intent: RecognizedIntent  // type 字段已被 L4 LLM 标准化
  phase: 'pending' | 'awaiting_children' | 'done' | 'aborted'
  children: StackEntry[]
  /**
   * 异常处理标志（L3 编译期设置，2026-08-20 新增）
   * true  = 本层异常由后续指令读 $r_err 处理（L1 不冒泡，截获在此层）
   * false = 默认：异常由 L1 递归向上冒泡
   */
  handleError: boolean
}

interface SkipN extends BaseEntry {
  kind: 'skip_n'
  n: number
}

interface ConditionalSkip extends BaseEntry {
  kind: 'conditional_skip'
  conditionAddr: Address               // 必须 internal（双区架构约束）
  n: number
}

// ============== 类型联合 ==============

type StackEntry = MoveEntry | OpEntry | IntentEntry | SkipN | ConditionalSkip
type InstructionStack = StackEntry[]

// ============== 全局状态（双区架构）==============

interface ExecutionState {
  stack: InstructionStack

  // === 双区架构 ===
  publicStore: Map<string, Value>      // 业务数据（持久，业务命名）
  internalStore: Map<string, Value>    // 寄存器（瞬态，寄存器命名）

  // 寄存器分配器（L1 拥有，每个外部意图处理循环初始化一次）
  allocator: RegisterAllocator

  // === 注入依赖 ===
  env: EnvironmentContext              // 来自 doc 08
  l3: L3Service                        // L3 service
  l2: L2Registry                       // L2 operation 注册表
  logger: TraceLogger
}

// RegisterAllocator 负责分配 $r0, $r1, $r2,... 寄存器名
// $r_err 是保留名（不通过 allocate 分配）
class RegisterAllocator {
  allocate(): string  // 返回 '$r<N>'
  reset(): void       // 重置计数器（外部意图重置）
  static errorRegister(): string  // 返回 '$r_err'
}
```

**重大变更**（2026-08-20）：
- 删除了 `resultStore: Map<string, Value>`（单一存储区）
- 添加了 `publicStore` + `internalStore`（双区）
- 添加了 `allocator: RegisterAllocator`（L1 拥有）
- Address 4 kinds（literal/public/internal/file）
- execute_op inputs/outputs 必须是 internal
- conditional_skip conditionAddr 必须是 internal
- move 的 to 不能是 literal

### 2.2 关键属性

**异构性**：栈成员**不是**统一的——有 5 种 L1 primitive 类型。

**平铺性**：没有嵌套的 frame 结构——所有 frame 都在同一个栈上。

**等同性**：5 种 primitive 都是 `StackEntry`；L1 用 `kind` 字段区分如何处理。

**递归性**：intent 可以包含 sub-intent，sub-intent 又可以包含 sub-intent——通过栈自然表达递归。

**控制流显式化**：`skip_n` 和 `conditional_skip` 让 DAG 的条件分支可以编译为扁平栈序列。

**双区隔离**（新增）：execute_op 只能读写 `internalStore`，通过 `move` 跨区搬运数据。

---

## 三、L1 调度器主循环

### 3.1 完整代码（5-case dispatch）

```typescript
async function l1MainLoop(
  rootIntent: RecognizedIntent,
  state: ExecutionState,
  options?: L1RunOptions  // maxSteps / maxRecursionDepth（防御，A11）
): Promise<void> {
  // 初始化栈：压入根意图（帧，handleError 默认 false）
  state.stack.push(createRootIntentEntry(rootIntent))

  let steps = 0
  while (state.stack.length > 0) {
    // 防御：步数超限（在 try 外——L1 系统错误不走业务冒泡）
    if (options?.maxSteps !== undefined && steps >= options.maxSteps) {
      throw new L1MaxStepsError(steps)
    }
    steps++

    const top = state.stack[state.stack.length - 1]

    try {
      // ====== 分发：根据 kind（5 case 严格穷尽）======
      switch (top.kind) {
        case 'move':
          await executeMove(top, state)
          break

        case 'execute_op':
          await executeAtomicOp(top, state)
          break

        case 'execute_intent':
          await processIntentEntry(top, state, options?.maxRecursionDepth ?? DEFAULT_MAX_RECURSION_DEPTH)
          break

        case 'skip_n':
          await executeSkipN(top, state)
          break

        case 'conditional_skip':
          await executeConditionalSkip(top, state)
          break

        default:
          const _exhaustive: never = top
          throw new Error(`Unknown primitive kind: ${(top as any).kind}`)
      }
    } catch (err) {
      // ====== L1 系统防御错误：不走业务冒泡 ======
      // RecursionDepthError（A11）与 L1MaxStepsError 同类：
      // 若被 handleError 截获，递归经验可无限重试 → 防御机制失效
      if (err instanceof RecursionDepthError) {
        throw err
      }
      // ⭐ 异常冒泡：处置权在 L3（handleError 标志）
      // 任何 primitive 抛出的异常 → 写 $r_err → 找最近 handleError 帧
      const handled = await bubbleError(err, state)
      if (!handled) {
        throw new UnhandledError(`Unhandled error in L1 main loop: ${err.message}`, err)
      }
      // 截获：$r_err 已写入异常信息，继续主循环（后续指令读 $r_err 判断）
    }
  }
}
```

### 3.2 executeMove：处理 move（双区架构版）

```typescript
async function executeMove(entry: MoveEntry, state: ExecutionState) {
  // from 可以是 literal/public/internal/file
  // to 不能是 literal（AddressError）
  const value = await resolveAddress(entry.from, state)
  await writeAddress(entry.to, value, state)
  state.stack.pop()  // 成功完成后 pop
  // 失败时不 pop，向上抛
}
```

### 3.3 executeAtomicOp：处理 op（含已知错误处理，双区架构版）

```typescript
async function executeAtomicOp(entry: OpEntry, state: ExecutionState) {
  const op = state.l2.get(entry.operation)
  if (!op) {
    entry.status = 'error'
    throw new ExecuteOpError(`Operation '${entry.operation}' not registered`)
  }

  // 验证 inputs/outputs 都是 internal（双区架构约束）
  validateInternalAddresses(entry.inputs)
  validateInternalAddresses(entry.outputs)

  entry.status = 'running'

  // 解析 inputs（从 internalStore 读取）
  const resolvedInputs: Record<string, Value> = {}
  for (const [name, addr] of Object.entries(entry.inputs)) {
    resolvedInputs[name] = await resolveAddress(addr, state)
  }

  // 调用 L2 operation
  // op 返回错误作为数据；op throw 交给主循环异常冒泡（处置权在 L3）
  let outputs: Record<string, Value>
  try {
    outputs = await op.execute(resolvedInputs)
  } catch (err) {
    entry.status = 'error'
    throw err  // 向上传播 → 主循环 catch → bubbleError（L3 决定处理权）
  }

  // 写入 outputs 到 internalStore（双区架构）
  for (const [outName, addr] of Object.entries(entry.outputs)) {
    const value = outputs[outName]
    await writeAddress(addr, value, state)  // 直接写入 internalStore
  }

  entry.status = 'done'
  state.stack.pop()
}
```

### 3.4 processIntentEntry：处理 intent（帧保留 + 双 phase，2026-08-20 修订）

**帧保留语义**：IntentEntry 保留在指令栈中作为**调用帧**（不一次性 pop）。
children 压入帧之上；全部执行完后栈顶回到帧 → 主循环再次遇到 → 标记 done + pop。
帧是异常冒泡的边界（handleError 标志在帧上）。

```typescript
async function processIntentEntry(
  entry: IntentEntry,
  state: ExecutionState,
  maxRecursionDepth: number
) {
  if (entry.phase === 'pending') {
    // A11：激活帧前登记递归深度（超限抛 RecursionDepthError，此时 phase 仍 pending，
    //      冒泡时不会误判为已 enter 的帧）
    enterIntent(entry.intent.type, state, maxRecursionDepth)
    // 首次遇到：调用 L3 分解（帧保留，不 pop self）
    entry.phase = 'awaiting_children'
    const children = await state.l3.compile(entry.intent, state)
    entry.children = children

    // 压入 children（**逆序**：children[0] 先执行）
    for (let i = children.length - 1; i >= 0; i--) {
      state.stack.push(children[i])
    }
    return
  }

  if (entry.phase === 'awaiting_children') {
    // children 已全部执行完（栈顶回到帧）→ 正常完成（释放递归深度）
    exitIntent(entry.intent.type, state)
    entry.phase = 'done'
    state.stack.pop()
  }
  // aborted：冒泡时已被弹出，主循环不会再次遇到（防御 throw）
}
```

### 3.5 executeSkipN：处理无条件跳转（帧边界保护，2026-08-20）

```typescript
async function executeSkipN(entry: SkipN, state: ExecutionState) {
  // 弹出 self + n 个后续 entry（总 n+1 个）
  // 帧边界保护（A11 细化）：
  //   - pending 帧（未开始的子调用）：允许跳过 —— 循环终止需要跳过 execute_intent(self)
  //   - awaiting_children / aborted 帧（执行中/已结束）：停止弹出（保护调用边界）
  for (let i = 0; i <= entry.n; i++) {
    if (state.stack.length === 0) break
    const top = state.stack[state.stack.length - 1]
    if (isIntentEntry(top) && top.phase !== 'pending') break
    state.stack.pop()
  }
}
```

### 3.6 executeConditionalSkip：处理条件跳转（双区架构版）

```typescript
async function executeConditionalSkip(
  entry: ConditionalSkip,
  state: ExecutionState
) {
  // 验证 conditionAddr 是 internal（双区架构约束）
  if (entry.conditionAddr.kind !== 'internal') {
    throw new Error(`conditional_skip conditionAddr must be internal, got ${entry.conditionAddr.kind}`)
  }

  // 从 internalStore 读取条件值（双区架构）
  const cond = state.internalStore.get(entry.conditionAddr.name)
  const truthy = isTruthy(cond)

  if (truthy) {
    // 条件为真：弹出 self + n 个后续 entry
    // 帧边界保护（A11 细化）：pending 帧可跳过，执行中/已结束帧停止弹出
    for (let i = 0; i <= entry.n; i++) {
      if (state.stack.length === 0) break
      const top = state.stack[state.stack.length - 1]
      if (isIntentEntry(top) && top.phase !== 'pending') break
      state.stack.pop()
    }
  } else {
    // 条件为假：仅弹出 self
    state.stack.pop()
  }
}

function isTruthy(value: Value | undefined): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value.length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(value)
}
```

### 3.7 aggregateAndPopIntent：普通 intent 完成（**已废弃** 2026-08-20）

> ❌ 原 DAG 模型的"聚合子结果"机制已移除。
> Experience 模型下，children 是**线性指令序列**（pre-processing + conditional + target-op 编译产物），
> 结果由 target_op 的 op 直接写 internalStore 寄存器，无需聚合。
> 帧保留语义下：children 执行完后栈顶回到帧 → processIntentEntry 标记 done + pop（见 §3.4）。

### 3.8 bubbleError：异常冒泡（2026-08-20 修订，错误处置权在 L3）

**废弃**：原 `propagateHardError`（硬错误逐层 abort + UnrecoverableError）已被本机制取代。

**核心原则**：解释执行下，是否捕捉/处理错误由 **L3 编译结果**决定（handleError 标志），
而非 L2 op 自己分类。L2 op throw 任何异常 → 主循环 catch → bubbleError。

```typescript
// A11：释放帧（exitIntent + 标记 aborted）
// - phase 'pending'（未 enter）：只标记 aborted
// - phase 'awaiting_children'（已 enter/已 compile）：exitIntent 平衡递归计数
function abortFrame(entry: StackEntry, state: ExecutionState) {
  if (isIntentEntry(entry)) {
    if (entry.phase === 'awaiting_children') exitIntent(entry.intent.type, state)
    entry.phase = 'aborted'
  }
}

async function bubbleError(err: Error, state: ExecutionState): Promise<boolean> {
  // ============ Step 1: 异常信息写入 $r_err ============
  // 后续指令（catch 逻辑）通过 $r_err 内容判断处理路径
  // errorToOperationError：保留原始错误码（ENOENT 等），无则 EXCEPTION
  state.internalStore.set(ERROR_REGISTER, errorToOperationError(err))

  // ============ Step 2: 弹出异常点 entry（栈顶，抛错者）============
  // 异常点可能是帧（如 L3 compile 抛错）→ abortFrame 释放
  const popped = state.stack.pop()
  if (popped) abortFrame(popped, state)

  // ============ Step 3: 从栈顶向下找最近的 handleError 帧 ============
  let handlerIndex = -1
  for (let i = state.stack.length - 1; i >= 0; i--) {
    if (isIntentEntry(state.stack[i]) && state.stack[i].handleError) {
      handlerIndex = i
      break
    }
  }

  // ============ Step 4: 无 handler → 全部弹出 → 调用者处理 ============
  if (handlerIndex === -1) {
    for (const e of state.stack) abortFrame(e, state)  // exitIntent + aborted
    state.stack.length = 0
    return false  // 主循环抛 UnhandledError 给调用者
  }

  // ============ Step 5: 有 handler → 保留 handler 调用链 + 剩余 children ============
  // 保留 [0..handlerIndex]（handler 帧及其调用链）
  const keepIds = new Set(state.stack.slice(0, handlerIndex + 1).map(e => e.id))

  // handler 之上（栈顶方向）：
  //   keep = handler 的剩余 children（catch 逻辑）
  //   drop = 无标志帧及其 children（异常子树）
  let mode: 'keep' | 'drop' = 'keep'
  for (let i = handlerIndex + 1; i < state.stack.length; i++) {
    const e = state.stack[i]
    if (isIntentEntry(e)) {
      if (!e.handleError) { abortFrame(e, state); mode = 'drop' }  // 释放 + aborted
    } else if (mode === 'keep') {
      keepIds.add(e.id)
    }
  }

  state.stack = state.stack.filter(e => keepIds.has(e.id))
  return true  // 截获：主循环继续（catch 逻辑读 $r_err 判断）
}
```

> **A11 补充**：所有被弹出的帧（Step 2/4/5）都经 abortFrame 释放递归深度计数——
> 深度跟踪与帧生命周期严格绑定，异常路径不泄漏（enter/exit 成对保证）。

**A/B/C 嵌套冒泡场景**（用户确认）：

```
[A(handleError=true), B(false), C(false)]，C 内 op 异常：
  弹出 C 序列（异常点 + C 帧）
  → 弹出 B 序列（B 帧及其剩余 children）
  → 到 A 帧（handler）→ 截获：保留 A 帧 + A 的剩余 children（catch 逻辑）
  → 继续执行 A 后序列（读 $r_err 判断处理路径）→ 正常完成
```

### 3.9 错误模型（2026-08-20 修订）

**废弃**：原"已知错误 vs 硬错误二分"（L2 op 自分类）已被"L3 决定处理权"取代。

| 概念 | 新定义 |
|---|---|
| **错误处置权** | 在 L3（编译期）。L3 通过 handleError 标志决定异常是否由本层处理 |
| **handleError=true** | 本层异常由后续指令读 $r_err 处理（L1 不冒泡，截获在此层）|
| **handleError=false** | 默认：异常由 L1 递归向上冒泡（弹出本层序列，直到最近 handler）|
| **$r_err** | 异常消息寄存器：L1 冒泡时写入异常信息（errorToOperationError）；L2 op 返回的 error 数据也写入 |
| **UnhandledError** | 无任何层截获时，冒泡到顶层给 mainLoop 调用者 |

**错误路径**（统一走主循环 catch → bubbleError）：

```
execute_op throws (ENOENT / 磁盘故障 / 任何异常)
  ↓ 主循环 catch
bubbleError
  ↓ 1. 异常信息写入 $r_err（保留原始错误码）
  ↓ 2. 找最近 handleError 帧
  有 → 截获：弹出无标志异常子树，保留 handler 的 catch 逻辑
       → 后续指令读 $r_err 判断处理路径
  无 → 全部弹出 → UnhandledError 给调用者
```

**L2 op 契约（简化）**：

```
// 成功
return { content: '...', error: null }

// 已知错误（主动返回，结构化）
return { content: null, error: { code: 'FILE_NOT_FOUND', ... } }

// 任何其他情况（无法处理、意外失败）→ 直接 throw
// L1 不判断错误内容；处置权在 L3（handleError）
throw err
```

**错误分层（保留）**：

| 层 | 错误类 | code 来源 | 说明 |
|---|---|---|---|
| L1 (Address) | `AddressError` | LITERAL_WRITE / VARIABLE_NOT_FOUND / fs code | L1 内部错误，走冒泡 |
| L2 (Operation) | `OperationError` | L2 op 自定义 | 可写入 $r_err（数据）或 throw（冒泡）|

详细设计反馈见 [mvp-prototype/docs/dev-log/2026-08-20-a10.md](../../mvp-prototype/docs/dev-log/2026-08-20-a10.md)。

---

## 四、L3 服务契约（Experience 模型版）

> **2026-08-20 重写**：原 §四 基于"StandardIntent + DAG 节点"的接口已重写为基于"Experience 三段式"的接口。
> 详见 [doc 12-experience-model.md](../../mvp-prototype/docs/dev-log/../../docs/mvp/12-experience-model.md) 完整设计响应。
>
> **关键变更**：
> - L3 不持有 LLM 能力（业务意义识别在 L3 之前完成）
> - Experience 三段式：pre-processing + conditional-judgment + target-op
> - skip-cost 参数（0-100 浮点）控制跳过必要性
> - 新增 `getExperience` / `recordFeedback` / `listExperiences` 接口

### 4.1 Experience 模型定义

```typescript
/**
 * Experience：有业务意义的可执行单元
 */
interface Experience {
  /** 业务意义 ID（与 L4 LLM 识别的 type 对应）*/
  id: string

  /** 业务描述（自然语言）*/
  description: string

  /** 输入参数 schema */
  inputs: Record<string, ParamSpec>

  /** 输出参数 schema */
  outputs: Record<string, ParamSpec>

  /** 前置处理（可选）—— 收集数据为条件判断做准备 */
  pre_processing?: PreProcessing[]

  /** 条件判断（可选）—— 决定 target-op 路径 */
  conditional_judgment?: ConditionalJudgment[]

  /** 目标操作（必有）—— 至少一个 base_op */
  target_op: TargetOp

  /** 用户反馈历史（MVP 仅存储，不自动演化）*/
  feedback_history?: FeedbackRecord[]
}

// 三段式详解见 doc 12
interface PreProcessing {
  id: string
  operation: string
  inputs: Record<string, ParamRef>
  outputs: Record<string, ParamRef>
  /** skip_cost >= skip_threshold 时跳过 */
  skip_threshold: number  // 0-100
}

interface ConditionalJudgment {
  id: string
  trigger: JudgmentTrigger
  then_path: string  // 路径 ID
  else_path?: string
}

interface TargetOp {
  base_op: string
  paths: TargetOpPath[]
  default_path: string
}

interface TargetOpPath {
  id: string
  description: string
  steps: OpStep[]
}
```

### 4.2 L3Service 接口

```typescript
/**
 * L3 Service 接口（Experience 模型版）
 */
interface L3Service {
  /**
   * 编译经验为子 entries
   * @param intent 已识别意图（包含 type + params）
   * @param state ExecutionState（访问 allocator、internalStore）
   * @returns 生成的 StackEntry[]
   *
   * 编译流程：
   * 1. 根据 intent.type 获取 Experience 定义
   * 2. 绑定输入参数（intent.params → internal 寄存器）
   * 3. 编译前置处理（按 skip_cost 跳过）
   * 4. 编译条件判断（决定 target-op 路径）
   * 5. 编译 target-op 选定路径的 steps
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

  /**
   * 失败后重新编译（可产生不同的 children）
   */
  recompile(
    intent: RecognizedIntent,
    state: ExecutionState,
    errorInfo: ErrorInfo
  ): Promise<StackEntry[]>
}

interface ErrorInfo {
  failedExperienceId?: string
  failedOpName: string
  failedOpId: string
  errorCode?: string
  errorMessage: string
  errorStack?: string
  attemptedInputs: Record<string, Value>
}
```

### 4.3 MVP 实现策略（简化版）

```typescript
class L3ServiceImpl implements L3Service {
  private experienceLibrary: Map<string, Experience>
  private feedbackStore: Map<string, FeedbackRecord[]>
  private l2Registry: L2Registry

  async compile(intent, state): Promise<StackEntry[]> {
    const exp = this.getExperience(intent.type)
    if (!exp) {
      throw new Error(`Experience '${intent.type}' not found`)
    }

    const entries: StackEntry[] = []
    const skip_cost = intent.params.skip_cost ?? 0  // 默认不跳过

    // 1. 绑定输入参数：move(intent.params → internal registers)
    for (const [name, paramSpec] of Object.entries(exp.inputs)) {
      if (name === 'skip_cost') continue
      const paramValue = intent.params[name]
      if (paramValue === undefined) continue
      const reg = state.allocator.allocate()
      state.internalStore.set(reg, paramValue)
      entries.push(makeMoveEntry(literal(paramValue), internal(reg)))
    }

    // 2. 编译前置处理（按 skip_cost 跳过）
    const preprocOutputs = new Map<string, Record<string, string>>()
    for (const preproc of exp.pre_processing ?? []) {
      if (skip_cost >= preproc.skip_threshold) {
        continue  // 跳过
      }
      const opEntries = compileOpStep(preproc, preproc.outputs, state)
      entries.push(...opEntries)
      preprocOutputs.set(preproc.id, preproc.outputs)
    }

    // 3. 编译条件判断 → 决定 target-op 路径
    const pathId = compileConditionalJudgment(
      exp.conditional_judgment ?? [],
      preprocOutputs,
      state,
      exp.target_op.default_path
    )

    // 4. 编译 target-op 选定路径
    const path = exp.target_op.paths.find(p => p.id === pathId)
      ?? exp.target_op.paths[0]  // fallback
    for (const step of path.steps) {
      // 检测 step.operation 是否是 Experience id（嵌套调用）
      if (this.experienceLibrary.has(step.operation)) {
        // 嵌套：生成 execute_intent entry
        entries.push(makeIntentEntry({
          type: step.operation,
          params: resolveInputs(step.inputs, preprocOutputs)
        }))
      } else {
        // L2 operation：生成 execute_op entry
        entries.push(...compileOpStep(step, step.outputs, state))
      }
    }

    return entries
  }

  // 其他方法实现略...
}
```

### 4.4 条件判断编译（多路径选择）

```typescript
/**
 * 编译条件判断：基于 trigger 结果选择 pathId
 *
 * 编译为：
 * 1. execute_op（条件 op，如 is_truthy / string_equals）
 * 2. conditional_skip + skip_n（路径选择）
 */
function compileConditionalJudgment(
  judgments: ConditionalJudgment[],
  preprocOutputs: Map<string, Record<string, string>>,
  state: ExecutionState,
  defaultPath: string
): string {
  // MVP 简化：返回 defaultPath
  // 完整实现：根据条件编译为 conditional_skip 链
  if (judgments.length === 0) return defaultPath

  // 示例：单个条件判断编译
  const judgment = judgments[0]
  // 1. 分配条件结果寄存器
  const condReg = state.allocator.allocate()
  // 2. 编译条件 op（根据 trigger.condition_op）
  // 3. 生成 conditional_skip + path 选择
  // 完整实现见 Phase C4

  return defaultPath  // MVP 简化
}
```

### 4.5 Experience 调用（DAG 嵌套）

```
Experience A.target_op.paths[normal].steps[0].operation === 'file_read'
  → generate execute_op entry

Experience A.target_op.paths[normal].steps[0].operation === 'read_latest_file' (另一个 Experience)
  → generate execute_intent entry（嵌套调用）
  → L1 会再次调 L3.compile 来展开 read_latest_file
```

**关键**：L3 编译时检测 step.operation 是 L2 op 还是 Experience，生成不同 entry 类型。
嵌套深度由 L1 主循环的栈深度限制（参见 doc 06 §11）。

---

## 五、L2 Op 契约与错误处理

### 5.1 修订后的 Operation 接口

```typescript
interface Operation {
  name: string
  description: string
  inputs: Record<string, ParamSpec>
  outputs: Record<string, ParamSpec>
  execute: (
    inputs: Record<string, Value>,
    ctx: ExecutionContext
  ) => Promise<Record<string, Value>>
}

interface ExecutionContext {
  /** Environment Context (来自 doc 08, 只读) */
  env: EnvironmentContext
  /** Trace Logger (注入式) */
  logger: TraceLogger
  /** AbortSignal (用于取消) */
  signal: AbortSignal
  // ⭐ 移除 pushErrorHandler——错误处理走 DAG 条件分支
}
```

### 5.2 Op 的错误处理策略（2026-08-20 修订）

> **修订**：L2 op 不再自分类"已知/硬错误"。错误处置权在 L3（handleError 标志）。
> op 的唯一契约：返回数据（含 error 字段）或 throw。

| 错误类型 | Op 处理方式 | L1 行为 |
|---|---|---|
| **业务错误**（file_missing 等）| 返回 `{ value: null, error: OperationError }` | 正常完成；DAG 通过 conditional_skip 处理 |
| **主动 throw**（无法处理、意外失败）| throw | 主循环 catch → bubbleError（L3 决定处置权）|
| **参数缺失**（required input 未提供）| throw | 冒泡（应在编译期捕获）|
| **未注册 operation** | L1 抛 ExecuteOpError | 冒泡（防御）|

### 5.3 file_read 修订示例（双区架构版）

```typescript
// ⭐ 新版契约：错误作为数据返回，写入 $r_err
const fileRead: Operation = {
  name: 'file_read',
  description: 'Read file content as UTF-8 string',
  formalSpec: {
    inputs: {
      path: { businessName: 'path', register: '$r0', type: 'path', required: true },
      encoding: { businessName: 'encoding', register: '$r1', type: 'string', required: false }
    },
    outputs: {
      content: { businessName: 'content', register: '$r2', type: 'string', required: false },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false }
    }
  },

  execute: async (inputs) => {
    const fs = await import('fs/promises')
    try {
      const content = await fs.readFile(inputs.path as string, (inputs.encoding as string) ?? 'utf-8')
      // 成功：error 为 null
      return { content, error: null }
    } catch (err: any) {
      if (err.code === 'ENOENT' || err.code === 'EACCES') {
        // 已知错误：作为数据返回（标准 OperationError）
        return {
          content: null,
          error: createOperationError(err.code, err.message, 'file_read')
        }
      }
      // 其他异常：throw → 交给 L1 冒泡（处置权在 L3 handleError）
      throw err
    }
  }
}
```

> **2026-08-20 修订**：L2 op 契约不再自分类"已知/硬错误"。op 可以主动返回结构化错误（数据）
> 或直接 throw；是否捕捉/处理由 **L3 编译的 handleError 标志**决定（见 §3.8/§3.9）。

### 5.4 Experience 编译示例：read_or_create_file

> **2026-08-20 更新**：基于"Experience 三段式"模型重写。原"DAG 节点"示例保留为历史对比。

```typescript
// Experience 定义（read_or_create_file）
const readOrCreateFile: Experience = {
  id: 'read_or_create_file',
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
      inputs: { path: { kind: 'input', name: 'path' } },
      outputs: {
        content: { kind: 'register', name: '$r_content' },
        error: { kind: 'register', name: '$r_err' }
      },
      skip_threshold: 50  // skip_cost >= 50 时跳过此检查
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
        description: '文件存在，使用读取结果',
        steps: []  // 前置处理已读取，直接使用 $r_content
      },
      {
        id: 'file_not_found',
        description: '文件不存在，使用默认内容',
        steps: [
          {
            operation: 'move',
            inputs: { source: { kind: 'input', name: 'default_content' } },
            outputs: { content: { kind: 'register', name: '$r_content' } }
          }
        ]
      }
    ]
  }
}
```

**L3 编译后产生**（双区架构版）：

```typescript
// children 数组（执行顺序），所有 address 都是 internal kind
[
  // 1. 绑定输入参数
  // move(input.path → $r0)
  // move(input.default_content → $r1)

  // 2. 前置处理 try_read（file_read，输出到 $r_content, $r_err）
  { kind: 'execute_op', operation: 'file_read',
    inputs: { path: { kind: 'internal', name: '$r0' } },
    outputs: { content: { kind: 'internal', name: '$r_content' }, error: { kind: 'internal', name: '$r_err' } } },

  // 3. 条件判断编译（提取 $r_err.code，判断是否是错误）
  // execute_op(extract_error_code): $r_err → $r_err_code
  { kind: 'execute_op', operation: 'extract_error_code',
    inputs: { error: { kind: 'internal', name: '$r_err' } },
    outputs: { code: { kind: 'internal', name: '$r_err_code' } } },

  // execute_op(is_truthy): $r_err_code → $r_has_error
  { kind: 'execute_op', operation: 'is_truthy',
    inputs: { value: { kind: 'internal', name: '$r_err_code' } },
    outputs: { result: { kind: 'internal', name: '$r_has_error' } } },

  // 4. DAG 路径选择：$r_has_error 为真则跳 normal 路径
  { kind: 'conditional_skip',
    conditionAddr: { kind: 'internal', name: '$r_has_error' }, n: 1 },

  // 5. normal 路径：不需要做什么（前置处理已读取）
  { kind: 'skip_n', n: 1 },

  // 6. file_not_found 路径：使用 default_content
  { kind: 'execute_op', operation: 'move',
    inputs: { source: { kind: 'internal', name: '$r1' } },
    outputs: { content: { kind: 'internal', name: '$r_content' } } }
]
```

**栈布局（逆序压入）**：

```
[file_not_found_path, skip_n(1), conditional_skip, is_truthy, extract_error_code, file_read, move(input), move(input)]
```

**执行（文件不存在，skip_cost=30 < 50，执行前置）**：

```
1. file_read → ENOENT → $r_err = OperationError → $r_content = null
2. extract_error_code → $r_err_code = 'ENOENT'
3. is_truthy → $r_has_error = true
4. conditional_skip → $r_has_error = true → 弹出 self + 1（skip_n）
5. file_not_found_path → move(default_content → $r_content)
6. 意图完成
```

**执行（skip_cost=80 >= 50，跳过前置）**：

```
1. （跳过前置处理）
2. file_read → ENOENT → $r_err = OperationError
3. 同样走 file_not_found 路径（条件判断仍执行）
```

**执行（文件存在）**：

```
1. file_read → { content: 'hello', error: null } → $r_err = null
2. conditional_skip → $r_err = null (falsy) → 仅跳 self
3. noop_else → 立即完成
4. skip_n(1) → 弹出 self + 1（noop_then）
5. 意图完成
```

**关键差异**（双区架构）：
- 所有 address 都是 `internal` kind（不允许 literal/public/file 作为 execute_op 的 input）
- 错误条件地址是 `$r_err`（全局错误寄存器，不是任意命名变量）
- conditional_skip conditionAddr 必须是 internal（type check at validatePrimitive）
- move 是唯一允许 literal/public/file 的 primitive（作为 from/to）

---

## 六、Walkthrough：完整执行示例

### 6.1 场景：读文件或处理错误

User：「读 README.md」（README.md 不存在）

意图：`read_or_create_file` (如 §5.4)

### 6.2 执行轨迹

```
栈 操作───────────────────────────── ───────────────────────────────────────
[read_or_create_file] L1:调 L3.compile(read_or_create_file)
                              → children = [
                                   execute_op(file_read),
                                   conditional_skip($error_is_null, n=2),
                                   execute_op(noop),
                                   skip_n(n=1),
                                   execute_op(noop)
                                 ]
[read_or_create_file,      L1:压入 children（逆序）
 noop_then, skip_n(1),
 noop_else, cond_skip,
 file_read]

[read_or_create_file,      L1:执行 file_read
 noop_then, skip_n(1),     → ENOENT
 noop_else, cond_skip,     → 返回 { content: null, error: {code:ENOENT} }
 file_read]                 → $error_is_null = false
                              → 正常完成，pop

[read_or_create_file,      L1:执行 conditional_skip
 noop_then, skip_n(1),     → $error_is_null = false → 仅跳 self
 noop_else, cond_skip]

[read_or_create_file,      L1:执行 noop_else
 noop_then, skip_n(1),     → 立即完成，pop
 noop_else]

[read_or_create_file,      L1:执行 skip_n(1)
 noop_then, skip_n(1)]     → 弹出 self + 1 (noop_then)

[read_or_create_file,      L1:栈顶是 intent
 noop_then]                  → phase=awaiting_children, all done
                              → aggregate → pop

[]                       完成
```

### 6.3 场景：异常冒泡（用户 2026-08-20 场景）

**A/B/C 嵌套，A 有 handleError，B/C 无**：

```
[A(handleError=true), B(false), C(false)]，C 内 op 异常：

栈 ──────────────────────────────────────────────
[root, A帧, A剩余..., B帧, B剩余..., C帧, c_op]
                                             ↑ c_op 抛错

→ L1 catch → bubbleError:
  1. $r_err = OperationError{ code: 'EXCEPTION', ... }（保留原始错误码）
  2. 弹出 c_op（异常点）
  3. 弹出 C 帧（aborted）→ 弹出 B 剩余 → 弹出 B 帧（aborted）
  4. 到 A 帧（handleError=true）→ 截获！
     → 保留 A 帧 + A 剩余（catch 逻辑）

→ 继续执行 A 剩余（读 $r_err 判断处理路径）→ A 帧 done → 完成
```

**关键**：错误处置权在 L3（handleError 标志），L1 只是机械执行冒泡。

### 6.4 场景：handleError 经验内 DAG catch 逻辑

```
经验 guarded（handleError=true）编译产物：
  [op_throw, conditional_skip($r_err, n=2), normal, skip_n(1), err_path]

op_throw 抛错 → 冒泡截获在 guarded 帧 → 继续执行：
  conditional_skip($r_err truthy, n=2) → 跳过 normal + skip_n
  → 执行 err_path（$r_out = 'error_handled'）→ 完成
```

### 6.5 场景：循环（递归 intent 引用 + conditional_skip）

User：「重试读取文件，直到成功或达到最大次数」

意图：`retry_until_success`

```yaml
intent: retry_until_success
inputs: { max_attempts: 5 }
outputs: { result: any }
dag:
  body:
    - try_operation: { operation: 'file_read', inputs: { path: '$path' }, outputs: { content: '$attempt_result', error: '$r_err' } }
  termination:
    - increment_counter: { var_name: '$attempts' }
    - check_should_stop: { expr: 'gte($attempts, 5)', outputs: { result: '$should_stop' } }
    - if not $should_stop:
        then: [self_reference_to_retry_until_success]
```

**L3 编译结果**（使用 [evaluate_expr op](./06-execution-layer.md#721-表达式求值-opevaluate_expr-2026-08-20-重构)）：

```typescript
// 终止判断表达式
const shouldStopExpr = {
  type: 'op',
  name: 'gte',
  args: [
    { type: 'var', name: '$attempts' },
    { type: 'literal', value: 5 }
  ]
}

// DAG：
[
  // body
  { kind: 'execute_op', operation: 'file_read', inputs: { path: '$path' },
    outputs: { content: '$attempt_result', error: '$r_err' } },

  // termination: increment + evaluate + conditional_skip + 递归
  { kind: 'execute_op', operation: 'increment_counter',
    inputs: { value: '$attempts' }, outputs: { new_value: '$attempts' } },

  { kind: 'execute_op', operation: 'evaluate_expr',
    inputs: { expr: shouldStopExpr },
    outputs: { result: '$should_stop', error: '$r_err2' } },

  // 终止条件（truthy → 跳过 self → 终止；falsy → 继续递归）
  { kind: 'conditional_skip', conditionAddr: '$should_stop', n: 1 },

  // ⭐ 递归引用自身
  { kind: 'execute_intent', intent: retry_until_success }
]
```

**L1 执行轨迹**（同 B06），但 evaluate_expr 替代了 B06 的 check_max/is_null：

```
栈                                            操作 ──────────────────────────────────────────
[retry_until_success]                       L1:压入根意图

[retry_until_success, A_self_1]             L1:A_self_1 是 execute_intent → 调 L3.compile
                                              → children = [file_read, incr, evaluate, cond_skip, A_self_2]
                                              → 压入 children（逆序）

Iteration 1 (attempts=0→1):
[retry_until_success, A_self_1,             L1:执行 file_read_1 (新 ID)
 cond_skip_1, evaluate_1, incr_1,             → 返回 $attempt_result
 file_read_1]                                → pop

[retry_until_success, A_self_1,             L1:执行 incr_1
 cond_skip_1, evaluate_1, incr_1]            → $attempts = 1
                                              → pop

[retry_until_success, A_self_1,             L1:执行 evaluate_1 (gte($attempts, 5))
 cond_skip_1, evaluate_1]                    → $should_stop = false (1 < 5)
                                              → pop

[retry_until_success, A_self_1,             L1:执行 cond_skip_1
 cond_skip_1]                                  → $should_stop = false → 仅 pop self（继续）

[retry_until_success, A_self_1]             L1:A_self_1 是 execute_intent → 调 L3.compile
                                              → 返回新 children（新 ID）
                                              → 压入

Iteration 2 (attempts=1→2):
[retry_until_success, A_self_1,             同样的过程，但都是新 ID（file_read_2, ...）
 cond_skip_2, evaluate_2, incr_2,
 file_read_2]

...

Iteration 5 (attempts=5):
[retry_until_success, A_self_1,             evaluate_5 返回 $should_stop = true (5 >= 5)
 cond_skip_5, evaluate_5]

[retry_until_success, A_self_1,             cond_skip_5 → true → pop self + 1
 cond_skip_5]                                  （跳过 A_self_5 帧，终止循环）
                                              （A11：skip 可跳过 pending 帧 = 不执行子调用）

[retry_until_success, A_self_1]             A_self_1 顶部 → all children done → pop

[]                                            循环结束，意图完成
```

**关键观察**：

1. **栈深度恒定**：始终 6 左右（不含根意图 A），不会增长
2. **conditional_skip 语义（doc 06 §3.5）**：truthy → 跳过后续 n 个；此处条件为**终止信号**（$should_stop）
3. **A11 帧边界细化**：skip 可跳过 **pending** 帧（未开始的子调用 = 不执行它），
   但不可跨 **awaiting_children/aborted** 帧（执行中/已结束 = 保护调用边界）
4. **每次迭代全新寄存器**：L3 重新 compile 通过 state.allocator 分配新寄存器，双区架构下不会冲突
5. **无需 L1 特殊循环逻辑**：只靠现有 execute_intent 递归 + conditional_skip
6. **词汇表仍为 5 primitive**：没有 loop
7. **终止判断 = 单个 evaluate_expr**（对比旧设计需 2-3 个条件 op：DAG 长度显著缩短）

---

## 七、与 L2/L3 的关系重定义

### 7.1 旧理解

- **L2** = 业务微指令（file_read 等）
- **L3** = 编译阶段（一次性把意图展开为 L2 序列）
- **L1** = 执行器（执行序列）

### 7.2 新理解

- **L1** = 调度器（5 primitive 主循环）
- **L2** = 服务（被 L1 调用执行 op）
- **L3** = 服务（被 L1 调用分解 intent，含 DAG 条件分支编译）

L1 是核心控制流，L2 和 L3 都是**按需调用的 service**。

### 7.3 调用关系图

```
        ┌──────────┐
        │ L1 调度器│
        └────┬─────┘
             │ 调用
   ┌─────────┼─────────────────────────┐
   ↓         ↓                         ↓
 L2       L3                       L3 (DAG 条件分支编译)
 (op 执行)(intent 分解基础)        → conditional_skip
                                   → skip_n
```

---

## 八、关键设计决策

### D11. 错误处理是业务逻辑还是错误处理？

**决策**：**业务逻辑**——通过 DAG if-then-else 表达，不使用特殊 L1 路径。

**理由**：
- "file missing 后做什么" 是业务决策，应由意图作者显式表达
- 特殊错误处理路径（ErrorHandlerEntry）混淆了错误与业务
- DAG 条件分支让意图的"所有可能路径"显式可见

### D12. L1 primitive 是几个？

**决策**：**5 个**——`move` / `execute_op` / `execute_intent` / `skip_n` / `conditional_skip`。

**理由**：
- move/execute_op/execute_intent 是核心三件套
- skip_n/conditional_skip 让 DAG 条件分支可表达
- 词汇表小（5 个）；dispatch 路径清晰（switch 5 case）

**替代方案**：合并 skip_n 和 conditional_skip 为 `skip(condition: Address | null, n)`。

**未选**：分开更清晰，dispatch 无需特例。

### D13. 业务错误是否 throw？（2026-08-20 修订）

**决策**：**否**——业务错误作为数据返回（`{ value: null, error: OperationError }`）。

**理由**：
- 业务逻辑可以通过 DAG 条件分支处理 error 数据
- L1 不需要特例处理业务错误
- op 无法处理/意外失败 → throw（交给 L1 冒泡，处置权在 L3 handleError）

### D14. 异常如何处理？（2026-08-20 修订）

**决策**：**L1 主循环 catch → bubbleError**（写 $r_err → 找最近 handleError 帧 → 截获/传播）。

**理由**：
- 错误处置权在 L3（handleError 标志），L2 op 不自分类
- 无 handler → UnhandledError 抛给调用者
- 原"硬错误逐层 abort + UnrecoverableError"（propagateHardError）已废弃

### D15. ExecutionContext 是否保留 pushErrorHandler？

**决策**：**移除**。

**理由**：
- 业务错误走 DAG 条件分支（conditional_skip + $r_err）
- 异常由 L1 冒泡（处置权在 L3 handleError）
- 不需要 op 主动 push handler 帧

### D16. DAG 条件分支如何编译？

**决策**：**显式编译为 conditional_skip + skip_n 组合**。

**理由**：
- 控制流显式化（栈序列可读）
- L1 dispatch 路径不变
- 不需要 L1 内部特例处理"分支"概念

### D17. 错误处理的遥测

**决策**：trace logger 记录：

- `error_bubbled` — 异常冒泡时（$r_err 写入）
- `intent_aborted` — intent 被 abort 时
- `conditional_skip_executed` — 条件跳转执行时

### D18. Operation 是否需要 try/catch？（2026-08-20 修订）

**决策**：**可选**——op 可以主动返回结构化错误（数据），或直接 throw（交给 L1 冒泡）。
不再强制区分"已知/硬错误"——处置权在 L3 handleError 标志。

```typescript
try {
  return { content, error: null }
} catch (err) {
  // 可选：主动返回结构化错误（供 DAG 直接判断）
  return { content: null, error: createOperationError(err.code, err.message, 'file_read') }
  // 或直接 throw（走 L1 冒泡，由 L3 handleError 决定处理权）
  // throw err
}
```

### D19. 嵌套异常的冒泡深度

**决策**：递归向上，直到最近的 handleError 帧截获；无 handler → UnhandledError 给调用者。

**理由**：
- 与 CPU 异常展开（unwinding）类似
- 每层无标志帧标记 aborted；handler 帧保留并继续（catch 逻辑）

### D20. DAG 编译时的完整性检查

**决策**：每次 L3.compile 调用时执行完整性检查。

**理由**：
- 编译时检测：operation 是否注册、required inputs 是否提供
- 失败时 throw → L1 传播

### D21. 条件值的来源（双区架构版）

**决策**：条件值从 `internalStore` 读取（通过 internal Address 寻址）。

**理由**：
- 双区架构下 conditional_skip.conditionAddr 必须是 internal
- 与 execute_op outputs 写入 internalStore 一致
- 条件表达式的计算由 L2 op 完成（如 `equals`、`is_truthy`），结果写入 `$r_err` 或其他 internal 寄存器
- L1 只做简单的 truthy/falsy 判断

### D22. 如何支持循环？

**决策**：**通过递归 intent 引用 + `conditional_skip`**——不增加 `loop` primitive。

**机制**：
- 循环意图 A 的 DAG 在末尾引用自身（A → children → A_self）
- 终止条件由 `conditional_skip` 检查
- L1 跟踪递归深度（安全网，默认 1000）

**L3 编译结果**：
```
[body_a, body_b, ..., check, conditional_skip, execute_intent(A_self)]
```

**详细设计**见 §六.5（Walkthrough）以及新决策 D26-D32。

**对比方案**（已拒绝）：
- 增加 `loop` primitive（6 primitive）——会增加词汇表
- `skip_n(-n)` 反向跳转——会与"顺序 pop" 假设冲突
- `goto(label)`——需要 label 机制，过重

**理由**：
- 递归是已有机制（`execute_intent`本身支持递归调用）
- `conditional_skip` 已经是 primitive 5
- 词汇表不变（5 primitive）
- 栈深度恒定（不增长）

### D23. 重规划（recompile）的触发条件

**决策**：当前仅在 L3 内部主动调用 `recompile`；MVP 不强制触发。

**理由**：
- 异常冒泡截获后，handler 的 DAG（catch 逻辑）已通过 conditional_skip + $r_err 决定下一步
- 重规划是优化路径，不是必须

### D24. 是否需要 Result 对象？

**决策**：**否**——L2 op 直接返回 outputs（成功时 + 错误数据）。

**理由**：
- 与 JS / TS Promise 风格一致
- 错误作为数据是普通模式

### D25. skip_n 是否包含 self？

**决策**：**包含**——`skip_n(n)` 弹出 self + n 个后续 entry。

**理由**：
- 实现简单（for 循环 0..=n）
- 语义清晰（"跳过我 + 我后面的 n 个"）

### D26. 循环是 L1 primitive 还是 L3 结构？

**决策**：**L3 结构**——不增加 L1 primitive。

**理由**：
- `execute_intent` 已经支持递归调用（指向自身的 intent）
- `conditional_skip` 已经提供条件控制
- 两者组合 = 完整循环机制
- 词汇表保持 5 primitive（不增加）

**对比方案**（已拒绝）：增加 `loop` primitive 会有额外 8+ 字段（mode、iteration、maxIterations、hasRunOnce、iterationVarAddr、itemVarAddr、breakable、broken），过度设计。

### D27. 循环是 while 还是 until？

**决策**：两者都支持，通过**意图 DAG 表达**。

**while**（前置条件）：
```yaml
DAG:
  - check_condition
  - if $cond:
      then: [body_a, body_b]
      else: [exit]  # 或不推入 A_self
```

**until**（后置条件）：
```yaml
DAG:
  - body_a
  - body_b
  - check_condition
  - if !$cond:
      then: [self_reference]  # 继续
```

**理由**：
- 两种循环是同一种机制（递归 + 条件）
- 区别仅在于条件检查在 body 前还是后
- 意图作者可以选择任何一种

### D28. 循环终止条件谁负责？

**决策**：**意图作者**在 DAG 中显式表达终止判断。

**理由**：
- 终止条件是业务逻辑的一部分
- 意图作者最清楚何时该停止
- 不强制统一模式

**安全网**：L1 跟踪递归深度，默认 1000 次。超过则 abort。

### D29. 递归深度跟踪的颗粒度？

**决策**：**按 intent name 跟踪**——同一 intent 的递归次数累加，不同 intent 独立计数。

```typescript
interface ExecutionState {
  // ...
  recursionDepth: Map<string, number>  // intent name → 当前递归深度
}

const DEFAULT_MAX_RECURSION_DEPTH = 1000

function enterIntent(intentName: string, state: ExecutionState): void {
  const current = state.recursionDepth.get(intentName) ?? 0
  if (current + 1 > DEFAULT_MAX_RECURSION_DEPTH) {
    // 防御：递归深度超限（A11 实现）
    throw new Error(`Intent '${intentName}' exceeded max recursion depth`)
  }
  state.recursionDepth.set(intentName, current + 1)
}

function exitIntent(intentName: string, state: ExecutionState): void {
  const current = state.recursionDepth.get(intentName) ?? 0
  state.recursionDepth.set(intentName, Math.max(0, current - 1))
}
```

**理由**：
- 颗粒度太粗（整个栈）会误判
- 颗粒度太细（每次调用）难以跟踪
- 按 intent name 跟踪语义清晰

### D30. Iteration 计数器如何管理？

**决策**：**意图作者使用专用 counter op**（`increment_counter`）或显式变量。

**理由**：
- Iteration 计数器是业务逻辑的一部分
- 不强制统一实现
- 意图作者可以灵活使用不同模式

**示例**（使用 [evaluate_expr](./06-execution-layer.md#721-表达式求值-opevaluate_expr-2026-08-20-重构)）：
```yaml
intent: retry_until_success
dag:
  - try_operation  # a
  - increment_counter('$attempts')  # c1：增加计数
  - evaluate_expr(expr: 'gte($attempts, 5)')  # c2：检查上限 → $should_stop
  - if not $should_stop:
      then: [self_reference]  # 继续循环
```

### D31. 循环中的寄存器冲突如何避免？（双区架构版）

**决策**：**自然避免**——L3 每次递归调用通过 `state.allocator` 分配新寄存器名。

**机制**：
1. L3 编译时调用 `state.allocator.allocate()`，每次返回新的 `$r<N>`（单调递增）
2. 递归调用时，新的 `execute_intent` entry 会调 L3.compile，返回的 children 同样使用新寄存器
3. 同一寄存器名在不同迭代中代表不同位置（双区架构下 internalStore 是瞬态的，可被覆盖）

**示例**：
- 第 1 次迭代：try_op_1, check_1, incr_1, check_max_1, cond_skip_1, A_self_1（使用 $r0-$r4）
- 第 2 次迭代：try_op_2, check_2, incr_2, check_max_2, cond_skip_2, A_self_2（使用 $r5-$r9）
- 同一寄存器名（如 $r0）在不同时刻代表不同迭代，无冲突

**栈深度恒定**：每次迭代的 children 完成后被 pop，新的 children 被压入——栈深度不变。

### D32. 循环中如何 break / continue？

**决策**：**break**——通过终止条件检查；**continue**——通过立即递归调用。

**break 实现**（编译为 cond_skip(stop, n=1) + self 引用）：
```yaml
while $should_stop == false:
  if $should_break:
    set $should_stop = true
  body
```

**continue 实现**：
```yaml
while $should_stop == false:
  if $should_skip:
    self_reference  # 立即递归，跳过后续 body
  body
```

**理由**：
- break/continue 是业务逻辑，应在 DAG 中表达
- 不需要 L1 特殊路径

---

## 九、失败模式目录

| 失败 | 检测点 | 应对 |
|---|---|---|
| **L2 op 未注册** | executeAtomicOp | 抛 ExecuteOpError → 冒泡（防御）|
| **L2 op 抛异常** | 主循环 catch | bubbleError → 写 $r_err → 找最近 handleError 帧（L3 决定处置权）|
| **L3 编译失败** | processIntentEntry | 冒泡；fallback 到 bash 兜底（MVP）|
| **DAG 条件分支引用未定义 output** | compileIf | 编译时校验 |
| **无 handler 截获** | bubbleError | UnhandledError → L4/用户 |
| **栈溢出** | 实际限制 | 意图库有界性保证；MVP 不考虑 |
| **寄存器冲突** | allocator.allocate | 双区架构下使用 entryId 不同寄存器名，理论不会冲突 |
| **User cancel** | UI 层信号 | signal AbortController 传播 |
| **Intent author 未考虑错误** | 编译时 | DAG 完整性检查 → 强制要求 if-then-else 处理业务错误 |

---

## 十、开放问题

### 10.1 循环意图（已解决）

**问题**：循环意图（如"持续监控日志"）如何表达？

**决策**：**通过递归 intent 引用 + `conditional_skip`**。

**机制**（详见 §六.5 Walkthrough）：
- 循环意图 A 的 DAG 末尾包含对 A 自身的引用
- L3 编译为 [body, check, conditional_skip, execute_intent(A_self)]
- L1 跟踪递归深度（默认 1000）作为安全网
- 词汇表仍为 5 primitive（不增加 `loop`）

### 10.2 并行执行

**问题**：DAG 某些子节点可并行执行。

**当前决策**：MVP 串行。

### 10.3 已知错误的"自动 fallback"

**问题**：是否提供"自动 fallback"机制（如果 op 失败且未在 DAG 中处理，自动跳到下一个 sibling）？

**当前决策**：否——强制意图作者显式表达错误处理。

### 10.4 Handler 库的迁移

**问题**：之前设计中的 handler（handle_file_missing 等）是否保留？

**当前决策**：保留为 StandardIntent 库中的"提示性条目"——意图作者可以引用它们，但**不自动触发**。

### 10.5 if-then-else 编译的复杂表达式

**问题**：条件表达式如果是 `a && b` 或 `a == b` 等复杂逻辑，是否需要专门的 L2 op？

**当前决策**：是——L2 提供 `equals`、`and`、`or`、`not` 等布尔运算 op。

### 10.6 错误快照的传递（2026-08-20 修订）

**问题**：异常冒泡截获后，错误信息如何传递给 handler 的 DAG？

**当前决策**：bubbleError 时 err 信息写入 `$r_err`（errorToOperationError，保留原始错误码），handler 的后续指令通过 conditional_skip 检查 `$r_err` 判断处理路径。

---

## 十一、与现有文档的修订关系

### 11.1 doc 06 (Execution Layer)

| 章节 | 变化 |
|---|---|
| §1 决策摘要 | 添加 "L1 是 5 primitive 调度器" |
| §3 Primitive 规范 | **重大修订**——从 2 primitive 改为 5 primitive |
| §8 编译示例 | **修订**——展示 DAG 条件分支的编译 |
| §11.3 错误恢复 | **大幅修订**——指向本文档"异常冒泡（handleError）"和"DAG 条件分支" |

### 11.2 doc 07 (Intent Library)

| 章节 | 变化 |
|---|---|
| §5 DAG 结构与解析 | **重大修订**——增加 if-then-else 编译规则 |
| §5.3 DAG 模板与按需分解 | **修订**——增加 DAG 条件分支编译 |
| §6 L2/L1 映射 | **修订**——L1 是 5 primitive 调度器 |

### 11.3 doc 09 (L1 Implementation)

| 章节 | 变化 |
|---|---|
| §5 L1Runtime 核心结构 | **重大重写**——5 case dispatch + 异常冒泡 |
| §10 D4 错误处理 | **删除**——错误处理走 DAG 条件分支 |
| §九 与 L3 编译器的衔接 | **修订**——L3 含 DAG 条件分支编译 |
| §十五 设计意图一页纸 | **更新**——5 primitive 调度器图 |

### 11.4 doc 04 (MVP Scope)

| 章节 | 变化 |
|---|---|
| §失败模式目录 | **修订**——基于新错误模型 |

### 11.5 新增文档

- **doc 10**（本文档）：响应式执行模型权威定义

---

## 十二、设计意图一页纸

### 一句话定义

**L1 是中心调度器，通过异构指令栈（5 种 L1 primitive）调度 L2（op 执行）和 L3（intent 分解 + DAG 条件分支编译），错误处理通过 DAG if-then-else 表达业务逻辑，循环通过递归 intent 引用 + conditional_skip 实现。**

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
└─────┬──────────────────────────┬───────────────────────┘
      ↓                          ↓
   L2: Operation              L3: Intent
   (返回 outputs           (返回 children
    含 error 数据)            含 DAG 条件分支编译)
```

### 关键原则

1. **5 primitive 调度**：move / execute_op / execute_intent / skip_n / conditional_skip
2. **L3 是 service**：每次只分解一个 intent 一层（含 DAG 条件分支编译）
3. **业务逻辑即 DAG 条件分支**：错误处理不需要特殊路径
4. **异常冒泡**：L1 catch → 写 $r_err → 找最近 handleError 帧截获；无 handler → 给调用者
5. **异构栈**：5 种 primitive 都是 StackEntry，L1 用 kind 字段分发
6. **极简 L1**：5 种处理路径
7. **循环即递归**：循环意图的 DAG 末尾引用自身，L1 通过递归深度跟踪保证安全
8. **词汇表不增加**：循环不需要新 primitive

### MVP 范围

- L1 main loop（~200 行 TS，5 case dispatch + 递归深度跟踪）
- L2 registry（Map<name, Operation>）
- L3 service（含 DAG 条件分支编译：if-then-else → conditional_skip + skip_n）
- 8 个内置 L2 operations（每个：返回数据含 error 或 throw）
- DAG 条件分支编译规则
- **循环支持**：通过递归 intent 引用 + conditional_skip 实现，不需 loop primitive
- ResultStore + Environment Context 集成
- Trace Logger

### 文件组织

```
src/l1/
├── main-loop.ts       ← l1MainLoop + bubbleError（异常冒泡）
├── types.ts           ← 5 种 StackEntry 定义（IntentEntry 含 handleError）
├── execution-state.ts ← ExecutionState + RegisterAllocator
├── id.ts              ← generateId
├── primitives/
│   ├── move.ts
│   ├── execute-op.ts
│   ├── execute-intent.ts   ← 帧保留（不 pop self）
│   ├── skip-n.ts           ← 帧边界保护
│   └── conditional-skip.ts ← 帧边界保护
├── trace.ts           ← TraceLogger
└── operations/
    ├── file_read.ts   ← 返回数据含 error 或 throw
    └── ... (8 个)

src/l3/
├── service.ts         ← L3Service 接口 + 实现
├── compiler.ts        ← Experience 编译（pre-processing + conditional + target-op）
├── validator.ts       ← Experience DAG 循环检测
└── experiences/       ← Experience 库
    ├── read_or_create_file.ts  ← 含 conditional_judgment
    ├── read_file.ts
    └── ...

**关键变更**（2026-08-20 Experience 模型）：
- `intents/` → `experiences/`（命名反映新设计）
- compiler 从"DAG 节点"改为"三段式编译"
- 新增 skip_cost 参数处理

### 演进路径

| 阶段 | 内容 |
|---|---|
| **MVP** | TS Runtime；5 primitive；8 个内置 op；Experience 三段式编译；异常冒泡（handleError）|
| **v1.1** | 循环支持（反向跳转）；L2 条件计算 op 族；skip-cost 多维化 |
| **v1.2** | L2 hot path 下沉 Rust（NAPI）；流式 IO；动态学习（feedback 演化）|
| **v2** | L1 独立进程（沙箱）；并行执行；DAG 节点共享 |

---

## 十三、参考与交叉引用

- **doc 02** 翻译层假说：解释为什么 L1 必须是确定性的
- **doc 03** 六层架构：L1 在流水线中的位置
- **doc 04** MVP 范围：基于新错误模型的失败模式目录
- **doc 05** 实施路线图：基于本模型的实施步骤
- **doc 06** 执行层设计：5 L1 primitive 词汇表（move / execute_op / execute_intent / skip_n / conditional_skip）
- **doc 07** 意图库：DAG 模板 + 按需一层分解 + 条件分支编译
- **doc 08** Environment Context：L1 通过 ExecutionContext.env 访问
- **doc 09** L1 实现：5 case dispatch 的 TypeScript Runtime