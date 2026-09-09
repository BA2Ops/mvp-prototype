# 06 - 执行层设计：三层 RISC-微代码-意图 架构

> Layer 6 的具体设计：5-Primitive RISC 作为硬件底座，业务操作作为微代码层，高层意图编译为微代码/RISC 指令序列。

> ⚠️ **本文档与 [10-reactive-execution-model.md](./10-reactive-execution-model.md) 的关系**：本文档定义 L1 的**词汇表**（`move`/`execute_op`/`execute_intent`/`skip_n`/`conditional_skip`/`Address`/`Operation`），doc 10 定义 L1 的**执行模型**（调度器 + 异构指令栈 + 异常冒泡 + handleError 标志）。**关于"如何执行"，以 doc 10 为准**；本文档描述的是"执行什么"。

---

## 决策摘要

执行系统是一个清晰的**三层架构**：

| 层级 | 词汇 | 类比 | 职责 |
|---|---|---|---|
| **L1 硬件层** | 5 个 primitive（`move` / `execute_op` / `execute_intent` / `skip_n` / `conditional_skip`） | CPU ISA（RISC 指令集） | 不可再分的基础执行单元 |
| **L2 微代码层** | 业务 operations（`file_read`、`glob_match`、`edit_file` 等） | CPU 微码 / Firmware | 业务操作的语义封装 |
| **L3 意图编译层** | 由 L2 operations 和 L1 primitives（含控制流）组成的指令序列 | 应用程序 / 汇编 | 高层意图 → 指令序列的映射 |

**核心原则**：

1. **L1 是绝对不可分的硬件**：词汇表固定为 5 个 primitive，不再扩展
2. **L2 是 L1 的微代码**：每个 L2 operation 可被实现为 L1 序列（"分解"）或保持原样（"原子"）
3. **L3 编译时可选用 L2 / L1**：复杂业务优先用 L2（自描述、可测试），底层细节直接用 L1
4. **业务语义零泄漏到 L1**：L1 不包含 `read_file`、`edit_file` 等业务动词
5. **错误处理走 DAG 条件分支**：业务逻辑通过 `skip_n` / `conditional_skip` 表达，不使用特殊 L1 错误路径

> **执行模型补充**：本文档定义 L1 的**词汇**；具体如何执行由 [doc 10](./10-reactive-execution-model.md) 定义。关键差异：
> - L1 不是"顺序执行完整序列"的执行器，而是**通过异构指令栈调度 L2/L3 的调度器**
> - 错误处理走 **DAG 条件分支**（业务逻辑）+ **L1 异常冒泡**（处置权在 L3 handleError 标志）
> - L3 不是"一次编完"的 phase，而是按需被 L1 调用的 service
> - L3 含 DAG 条件分支编译（if-then-else → conditional_skip + skip_n）

### 与 MVP 04 原提案的关系

MVP 04 提出的 7 个 primitive（`read_file` / `write_file` / `edit_file` / `list_files` / `search_content` / `execute` / `compose`）属于 **L2 微代码层**，不属于 L1。它们是**业务操作**，不是**硬件指令**。

之前的混淆是：把 L2 当成 L1 写进了执行层。现在分层后，L1 永远是 5 个 primitive，L2 是可扩展的业务 operations 集合。

### 与 pi 的对应关系

| Pi 设计 | 本设计 | 关系 |
|---|---|---|
| 核心 4 工具（read/write/edit/bash） | L1 的 5 primitive | 都是"硬件层"，保持最小核心 |
| 扩展机制（`registerTool`） | L2 operations 的注册 | 同样是"微代码层"，可插拔 |
| 用户自然语言输入 | L3 意图编译 | 都是"上层应用" |

---

## 一、设计动机

### 1.1 CPU ISA 的启示

RISC（精简指令集）架构的核心原则：

1. **load/store 架构**：算术指令**不直接**访问内存，数据必须先 load 到寄存器，操作后再 store 回内存
2. **指令自描述**：每条指令的 opcode 隐含操作数约束（ADD 需要 3 个寄存器、MOV 需要 2 个操作数）
3. **小而正交**：指令集小、操作数寻址对称、组合可预测

将此模型应用到翻译层执行层：

- **数据移动独立** → `move` 是**唯一**的数据操作
- **操作自描述** → 每个 operation 定义自己的 inputs/outputs schema
- **地址对称** → 变量、文件、字面量都是同等的 Address

### 1.2 为什么是 5 个而不是 2 个或更多？

| 候选设计 | 问题 |
|---|---|
| 7 primitive（read/write/edit/list/search/exec/compose） | 词汇表大；业务含义泄漏到执行层；规则组合空间爆炸 |
| 2 primitive（move/execute） | 词汇表小，但 `execute` 模糊了"原子操作"和"意图分解"的语义差异 |
| 3 primitive（move/execute_op/execute_intent） | 缺少控制流能力，DAG 条件分支无法表达 |
| **5 primitive（move/execute_op/execute_intent/skip_n/conditional_skip）** | **三类职责清晰分离（数据搬运/原子执行/意图分解）+ 控制流能力；CPU ISA 类比准确** |
| 1 primitive（仅 execute，move 作为内置 operation） | "数据搬运"与"计算"在概念上是不同类别，合并会模糊执行层的核心职责 |

**结论**：5 个 primitive 是执行层词汇表的最小完备集——既保持小词汇表，又支持 DAG 条件分支的编译。

**5 个 primitive 的语义分类**：

| 类别 | Primitive | 职责 |
|---|---|---|
| 数据搬运 | `move` | 唯一的数据操作 |
| 原子执行 | `execute_op` | 调用 L2 operation（8 个内置 + 扩展）|
| 意图分解 | `execute_intent` | 调用 L3 service 分解一个意图一层 |
| 无条件跳转 | `skip_n` | 控制流：跳过 N 个指令 |
| 条件跳转 | `conditional_skip` | 控制流：条件为真时跳过 N 个指令 |

### 1.3 与 MVP 04 原提案的对比

| MVP 04 primitive | 在新设计中的归属 |
|---|---|
| `read_file(path, encoding, range)` | `execute(operation: 'file_read', ...)` |
| `write_file(path, content)` | `execute(operation: 'file_write', ...)` |
| `edit_file(path, find, replace)` | 展开为 `file_read` + `string_replace` + `file_write` |
| `list_files(pattern, recursive)` | `execute(operation: 'glob_match', ...)` |
| `search_content(pattern, path, ctx)` | `execute(operation: 'grep_search', ...)` |
| `execute(command, cwd, timeout)` | `execute(operation: 'shell_exec', ...)` |
| `compose(steps)` | 隐式：Primitive 数组本身就是 sequence |

**7 个动词 → 5 个 L1 primitive + N 个 L2 operations**：业务操作全部下沉为 operation。

---

## 二、三层架构详解

### 2.1 整体模型

```
┌───────────────────────────────────────────────────────────┐
│ L3 意图编译层 │
│ 高层意图 → 由 L2/L1 组成的指令序列 │
│ 例: "读最新日志" → [glob, sort, take, read] │
├───────────────────────────────────────────────────────────┤
│ L2 微代码层 / 业务 operations │
│ file_read, file_write, glob_match, grep_search, │
│ string_replace, sort_by, take_first, shell_exec, ... │
│ 实现方式: 原子函数 OR L1 primitive 序列 │
├───────────────────────────────────────────────────────────┤
│ L1 硬件层 / 2-Primitive RISC │
│ move(from, to) │
│ execute(operation, inputs, outputs) │
└───────────────────────────────────────────────────────────┘
```

### 2.2 L1 硬件层的不可变性

**承诺**：L1 词汇表固定为 5 个 primitive（`move`、`execute_op`、`execute_intent`、`skip_n`、`conditional_skip`），**永远不扩展**。

理由：

- L1 是执行系统的"物理定律"，不应频繁变更
- 任何 L1 改动都会让所有 L2 微代码失效
- 复杂度应该被推到 L2（业务边界）而非 L1（基础设施边界）

如果未来真的需要新原语（如"原子事务"、"流式管道"），有两种处理方式：

| 处理方式 | 适用场景 | 风险 |
|---|---|---|
| **A. 添加 L2 operation**（推荐） | 90% 场景 | 几乎无风险 |
| **B. 扩展 L1 到"富指令集模式"** | 性能/语义不可替代时 | 破坏 L1 不可变性承诺，仅在确实必要时采用 |

B 方式对应你说的"未来扩展底层：5-Primitive RISC 为富指令集模式"。这是**最后手段**，不是首选。

### 2.3 L2 微代码层的两种实现

每个 L2 operation 都有两种实现方式：

```typescript
// 方式 A: 原子实现（黑盒函数）
const file_read_op: Operation = {
  name: 'file_read',
  inputs: { path: { type: 'path', required: true } },
  outputs: { content: { type: 'string', required: true } },
  execute: async (i) => ({
    content: await fs.readFile(i.path, 'utf-8')
  })
}

// 方式 B: L1 序列实现（微代码）
const edit_file_op: Operation = {
  name: 'edit_file',
  inputs: { path: { type: 'path', required: true },
            find: { type: 'string', required: true },
            replace: { type: 'string', required: true } },
  outputs: { success: { type: 'boolean', required: true } },
  // 内部调用 L1 primitives
  execute: async (i, ctx) => {
    const dataArea = ctx.dataArea
    // L1: move file → variable
    await primitive_move(
      { kind: 'move', from: { kind: 'file', path: i.path },
                     to: { kind: 'variable', name: '$original' } },
      dataArea, ctx
    )
    // L1: execute_op string_replace
    const r = await primitive_execute_op(
      { kind: 'execute_op', operation: 'string_replace',
        inputs: { text: { kind: 'variable', name: '$original' },
                   find: { kind: 'literal', value: i.find },
                   replace: { kind: 'literal', value: i.replace } },
        outputs: { result: { kind: 'variable', name: '$modified' } } },
      dataArea, ctx
    )
    // L1: execute_op file_write
    await primitive_execute_op(
      { kind: 'execute_op', operation: 'file_write',
        inputs: { path: { kind: 'literal', value: i.path },
                   content: { kind: 'variable', name: '$modified' } },
        outputs: { success: { kind: 'variable', name: '$ok' } } },
      dataArea, ctx
    )
    return { success: true }
  }
}
```

**判断标准**：

| 选择 | 条件 |
|---|---|
| **A 原子** | 该操作在系统/语言层面有原生支持（如 `fs.readFile`）；分解反而损失性能或原子性 |
| **B 微代码** | 该操作可清晰分解为其他 L2 operations；分解后各部分都能独立测试 |

**MVP 推荐**：

- 性能敏感且原生支持的 → A（file_read、file_write、glob_match、grep_search、shell_exec）
- 业务逻辑清晰的 → B（string_replace、sort_by、take_first）

### 2.4 L3 意图编译层的选词策略

L3 编译 L2 → L1 序列时，**优先使用 L2 operations** 而非直接展开为 L1 primitives。

理由：

- L2 operations 自带 I/O schema，完整性分析更可靠
- L2 operations 是业务语义单元，可读性、可测试性更好
- L1 primitives 只在 L2 没有对应能力时使用

```typescript
// ✅ 推荐：用 L2 microcode
[
  { kind: 'execute_op', operation: 'glob_match', inputs: {...}, outputs: {...} },
  { kind: 'execute_op', operation: 'sort_by', inputs: {...}, outputs: {...} },
  { kind: 'execute_op', operation: 'file_read', inputs: {...}, outputs: {...} }
]

// ⚠️ 避免：直接用 L1（除非确实必要）
[
  { kind: 'move', from: {...}, to: {...} },
  { kind: 'execute_op', operation: 'fs_open', ... },  // ❌ 假想的低阶 op
  { kind: 'execute_op', operation: 'fs_read', ... }   // ❌ L1 不应承担 FS 细节
]
```

### 2.5 与 CPU 微码的精确类比

| CPU 概念 | 本设计对应 | 关系 |
|---|---|---|
| **ISA 指令**（ADD、MOV、LOAD） | L1 primitives（move、execute_op、execute_intent、skip_n、conditional_skip） | 都是不可分的原子 |
| **微码**（实现复杂指令） | L2 operations（分解到 L1） | 都是上层语义的实现 |
| **复杂指令集**（x86 STRING 指令） | L1 富指令集模式（保留扩展点） | 都是性能优化路径 |
| **应用程序** | L3 编译产物（指令序列） | 都是上层使用 |

CPU 的微码与 ISA 是**同一硬件**（CPU 内部），本设计的 L1 与 L2 是**同一执行系统**。这保证了"L1 不可变"承诺的同时，允许 L2 自由演化。

**L1 5 primitive 与 CPU ISA 的精确映射**：

| L1 primitive | CPU 类比（真实存在） | 职责 |
|---|---|---|
| `move` | MOV / LOAD / STORE | 数据搬运 |
| `execute_op` | ALU op (ADD / MUL / ...) | 原子执行 |
| `execute_intent` | CALL subroutine | 子程序调用 |
| `skip_n` | UNCOND JMP | 无条件跳转 |
| `conditional_skip` | BRANCH (条件跳转) | 条件跳转 |

**重要说明**：L1 没有专门的"loop"primitive。**循环通过递归调用 + conditional_skip 实现**——对应 CPU 中用 CALL + 条件 BRANCH + UNCOND JMP 组合实现循环模式。现代 ISA 无专门 LOOP 指令（x86 历史上有但已弃用）。详见 §3.6 与 [doc 10 §六.5](./10-reactive-execution-model.md)。

### 2.6 三层的失败处理边界

| 层 | 失败来源 | 处理 |
|---|---|---|
| **L1** | 物理资源错误（IO 失败、OS 错误） | 向上抛错，由 L2 决定语义 |
| **L2** | 业务逻辑错误（文件不存在、权限拒绝） | operation 自己处理；返回失败结果 |
| **L3** | 编译错误（意图无法映射） | 完整性分析层拦截，上报用户 |

**关键**：L1 不感知"业务失败"——它只感知"操作执行了/未执行"。

---

## 三、Primitive 规范

L1 的 5 个 primitive 分为三类：

| 类别 | Primitive | 职责 |
|---|---|---|
| 数据搬运 | §3.1 `move` | 唯一的数据操作 |
| 原子执行 | §3.2 `execute_op` | 调用 L2 operation |
| 意图分解 | §3.3 `execute_intent` | 调用 L3 service 分解意图 |
| 控制流（无条件） | §3.4 `skip_n` | 无条件跳转 N 个 entry |
| 控制流（条件） | §3.5 `conditional_skip` | 条件跳转 N 个 entry |

### 3.1 `move` — 数据搬运

**语法**：

```typescript
type Move = {
  kind: 'move',
  from: Address,    // 源地址
  to: Address       // 目标地址
}
```

**语义**：

- 把 `from` 地址指向的数据**拷贝/读取**到 `to` 地址
- `move` 是**值传递**，不涉及计算
- 完成后，`from` 与 `to` 持有相同的数据（按值或按引用，取决于实现）
- `move` **不做类型转换**（如需转换，先用 `execute` 调用 transform operation）

**约束**（双区架构版）：

- `from` 可以是任何 Address kind（literal / public / internal / file）
- `to` **不能是 literal**（尝试写入 literal 抛 `AddressError`）
- 跨区 move 是合法的：public → internal, internal → public, file → internal, internal → file, public → file, file → public 等
- 同区 move：internal → internal（物理寄存器 ↔ 业务变量区搬运）、public → public（业务变量重命名）
- `from` 与 `to` **不需要是同区**（跨区是 move 的主要用途）

**特殊寄存器名**：

- `$r_err` 是保留寄存器（全局错误输出），可以与普通寄存器一样读写

**典型用法**：

- 加载常量：`move(literal → internal)`（必须，execute_op 不能直接读 literal）
- 加载文件：`move(file → internal)`
- 保存结果：`move(internal → public)` 或 `move(internal → file)`

**执行结果**：`move` 不产生输出（除非失败）。它只修改数据区状态。失败时不弹栈，向上传播给上层处理。

### 3.2 `execute_op` — 调用 L2 自描述操作

**语法**：

```typescript
type ExecuteOp = {
  kind: 'execute_op',
  operation: string,                  // operation 名（opcode）
  inputs: Record<string, Address>,    // 输入参数名 → internal 地址
  outputs: Record<string, Address>   // 输出参数名 → internal 地址
}
```

**语义**：

1. 执行层根据 `operation` 名查找已注册的操作
2. 从 `inputs` 中按名字取出值（解析 internal 地址，从 internalStore 读取）
3. 调用 operation 的 `execute(inputs)`
4. 将返回的 outputs 按 `outputs` 映射写入 internalStore
5. 记录 trace（latency、inputs、outputs、success/error）

**输入/输出约束**（强制）：

- `inputs` 中所有 Address 必须是 `internal` kind（不允许 literal/public/file）
- `outputs` 中所有 Address 必须是 `internal` kind（不允许 literal/public/file）
- 违反约束 → 编译期/运行期报错
- **为什么**：L1 调度器不感知业务命名，只识别 `$r0` `$r1` 等寄存器地址

**典型用法**：

```typescript
// ✅ 正确：inputs/outputs 都是 internal
{ kind: 'execute_op',
  operation: 'file_read',
  inputs: { path: { kind: 'internal', name: '$r0' } },
  outputs: { content: { kind: 'internal', name: '$r1' }, error: { kind: 'internal', name: '$r_err' } } }

// ❌ 错误：试图直接传 literal
{ kind: 'execute_op',
  operation: 'file_read',
  inputs: { path: { kind: 'literal', value: '/tmp/x' } },  // 报错：literal 不允许
  outputs: { content: { kind: 'public', name: 'content' } } }  // 报错：public 不允许
```

**关键性质**：

- **operation 自带 I/O 契约**：输入参数名、输出参数名都由 operation 自己声明（通过 `formalSpec`）
- **执行层不做参数验证**：operation 自己负责验证 inputs
- **执行层不做参数推断**：编译层必须显式提供每个输入参数

**错误处理（双区架构版）**：

- operation 返回 `{ content: null, error: OperationError }`（错误作为数据）→ 正常完成，DAG 条件分支检查 `$r_err`
- operation throw（任何异常）→ L1 主循环 catch → bubbleError（写 $r_err → 找最近 handleError 帧；见 doc 10 §三.8）
- 必需 input 缺失 → 完整性分析层在执行前拦截

**标准 OperationError 结构**（所有 op 统一）：

```typescript
interface OperationError {
  code: string         // 'ENOENT', 'EXEC_FAILED', 'PARSE_FAILED',...
  message: string      // 人类可读
  op: string           // 产生此错误的 operation 名
  timestamp: number    // 错误发生时间（毫秒）
  details?: unknown    // 可选额外上下文
}
```

成功时写入 `$r_err` 的值是 `null`，失败时是 `OperationError`。DAG 条件分支通过 `conditional_skip(conditionAddr: $r_err)` 检查。

### 3.3 `execute_intent` — 调用 L3 分解意图

**语法**：

```typescript
type ExecuteIntent = {
  kind: 'execute_intent',
  intent: RecognizedIntent | StandardIntent  // 意图规约
}
```

**语义**：

1. 执行层根据 `intent` 名在 StandardIntent 库中查找（如果是 RecognizedIntent 则先匹配）
2. 调用 L3 service 的 `compile(intent, state)` 方法
3. L3 返回该 intent 的 immediate children（5 种 primitive 之一），L3 使用 `state.allocator` 分配寄存器
4. L1 将 children 压入指令栈（逆序）后继续执行
5. 当所有 children 完成时，intent 聚合 outputs 并完成

**寄存器分配**（双区架构关键）：

- L3 编译时通过 `state.allocator.allocate()` 分配寄存器名（`$r0`, `$r1`, `$r2`, ...）
- `$r_err` 是保留名（通过 `RegisterAllocator.errorRegister()` 获取，不通过 allocate 分配）
- 每次 compile 调用都从当前 allocator 分配新的寄存器名（单调递增）
- 递归 intent 重用同一 allocator（通过 state 传递）

**关键性质**：

- **L3 每次只分解一层**：L1 通过指令栈驱动深度递归
- **DAG 条件分支编译**：L3 负责将 `if-then-else` 编译为 `conditional_skip` + `skip_n` 组合（见 doc 10 §四.3）
- **执行层不感知 DAG 结构**：只看到 5 种 primitive
- **业务名与寄存器分离**：L3 内部处理业务名 → 寄存器名的映射（L3 should-read-metadata-only，见 D8）

**错误处理**：

- L3 compile 失败（throw）→ L1 捕获并向上传播
- DAG 完整性检查失败（编译期）→ throw → L1 传播
- intent 执行中的子 op 错误 → 走 execute_op 的错误处理路径

### 3.4 `skip_n` — 无条件跳转

**语法**：

```typescript
type SkipN = {
  kind: 'skip_n',
  n: number  // 跳过的 entry 数（包含 self）
}
```

**语义**：

- 弹出 self + n 个后续 entry（总 n+1 个）
- 用于 DAG 中"无论条件如何都跳过"的场景
- MVP 仅支持前向跳转（n ≥ 0）

**编译示例**：

```typescript
// DAG: if cond then A else B
// 编译为：
[
  { kind: 'conditional_skip', conditionAddr: condAddr, n: elseBlock.length },  // 条件为真跳 else
  ...elseBlock,
  { kind: 'skip_n', n: thenBlock.length },  // 无论上面发生了什么，跳 then
  ...thenBlock
]
```

### 3.5 `conditional_skip` — 条件跳转

**语法**：

```typescript
type ConditionalSkip = {
  kind: 'conditional_skip',
  conditionAddr: Address,  // 条件值地址（必须指向 internal）
  n: number                 // 条件为真时跳过的 entry 数（包含 self）
}
```

**语义**：

- 从 `internalStore` 中读取 `conditionAddr` 指向的值
- `conditionAddr` **必须是 internal kind**（不允许 literal/public/file）
- 如果值为 truthy：弹出 self + n 个后续 entry
- 如果值为 falsy：仅弹出 self

**Truthy 判断规则**：

| 值类型 | Truthy 条件 |
|---|---|
| `undefined` / `null` | false |
| `boolean` | `value === true` |
| `number` | `value !== 0` |
| `string` | `value.length > 0` |
| `list` | `items.length > 0` |
| `struct` | `Object.keys(obj).length > 0` |

**编译示例**：

```typescript
// DAG: if $error == null then A else B
// 编译为：
[
  { kind: 'execute_op', operation: 'file_read', ..., outputs: { content: '$content', error: '$error' } },
  // 如果 $error 为 null（读取成功），跳过 else 块（创建默认文件）
  { kind: 'conditional_skip', conditionAddr: { kind: 'address', ref: '$error_is_null' }, n: 2 },
  ...elseBlock,
  // 无条件跳过 then 块（已被 cond_skip 跳过，或当前需要跳过）
  { kind: 'skip_n', n: thenBlock.length },
  ...thenBlock
]
```

### 3.6 循环实现：递归 intent 引用

> **不增加 `loop` primitive**——L1 词汇表固定为 5 primitive。

循环通过**递归 intent 引用** + `conditional_skip` 实现：

```typescript
// 循环意图 A
intent A = {
  body: [op_a, op_b, op_c],
  termination: [check_condition],
  on_continue: [self_reference_to_A]  // ⭐ 递归引用自身
}

// L3 编译结果：
[
  ...body,
  ...termination,
  {
    kind: 'conditional_skip',
    conditionAddr: '$should_continue',
    n: 1  // 跳过下一个 entry (A_self)
  },
  {
    kind: 'execute_intent',
    intent: A  // ⭐ 指向自身
  }
]
```

**执行机制**：
1. L1 处理 execute_intent A → 调 L3.compile(A) → 压入 children（逆序）
2. 执行 body
3. 执行 termination 检查（产生 $should_continue）
4. conditional_skip：若条件为真则 pop self + 1（跳过 A_self）；否则仅 pop self
5. 若 A_self 未被跳过：L1 处理 execute_intent A_self → 调 L3.compile(A) → 压入**新** children
6. 重复 2-5

**关键性质**：
- 每次递归都是新 entries（新 ID），resultStore 不冲突
- 栈深度恒定（不增长）
- L1 vocabulary 仍为 5 primitive
- L1 自动跟踪递归深度（默认 1000）作为安全网

**while 模式**（前置条件）：
```yaml
DAG:
  - check_condition # 先检查
  - if $should_continue:
      then: [self_reference]  # 满足条件才继续
    else: [exit_block]
```

**until 模式**（后置条件）：
```yaml
DAG:
  - body # 先执行 body
  - check_condition # 后检查
  - if !$should_continue:
      then: [self_reference]  # 不满足条件才继续
```

**详细 Walkthrough**见 [doc 10 §六.5](./10-reactive-execution-model.md)。

---

## 四、Address 模型（双区架构）

### 4.0 设计动机与双区分类

> **设计背景**（2026-08-20 重写）：原设计中的 `Address` 使用 5 种 kind（literal/variable/file/stream/field），但这种设计将"业务数据"和"执行参数"混在一个 `variable` 概念中，造成：
> - 业务命名（`output_content`）与寄存器命名（`$r0`）冲突
> - execute_op 的 input/output 没有明确的"哪个寄存器"
> - L3 编译时无法确定形参地址

**新设计**将 Address 减为 4 种 kind，并对齐双区架构（publicStore + internalStore）：

| kind | 存储区域 | 命名约定 | 生命周期 | 示例 |
|---|---|---|---|---|
| `literal` | （不存储）| 字面量值 | （只读）| `{ kind: 'literal', value: 'hello' }` |
| `public` | `publicStore` | 业务语义名 | 持久 | `{ kind: 'public', name: 'output_content' }` |
| `internal` | `internalStore` | 寄存器名 `$r<N>` | 瞬态 | `{ kind: 'internal', name: '$r0' }` |
| `file` | 文件系统 | 路径 | 外部存储 | `{ kind: 'file', path: '/tmp/test.txt' }` |

**`$r_err`** 是保留寄存器名（特殊处理，详见 §3.2）。

**关键设计原则**：**move 是唯一跨越数据区的桥梁**。execute_op / execute_intent / conditional_skip **只能读写 internal**（不允许 literal/public/file）。literal 和 file 必须**先通过 move** 移到 internal 后才能被 op 使用。

### 4.1 类型定义

```typescript
type Address =
  | { kind: 'literal'; value: Value }          // 字面量（常量）
  | { kind: 'public'; name: string }           // 业务数据（持久）
  | { kind: 'internal'; name: string }         // 寄存器（瞬态）
  | { kind: 'file'; path: string }             // 文件路径

type Value =
  | string | number | boolean | null | undefined
  | Value[]
  | { [key: string]: Value }
```

### 4.2 关键设计原则：跨区约束

**作为 from 的能力**（能否从中读取）：

| Address 类型 | 作为 `from` | 说明 |
|---|---|---|
| `literal` | ✅ 取字面量值 | 仅作为源（不能作为目标） |
| `public` | ✅ 从 publicStore 读取 | 业务数据 |
| `internal` | ✅ 从 internalStore 读取 | 寄存器 |
| `file` | ✅ 从文件系统读取 | 文件内容 |

**作为 to 的能力**（能否写入）：

| Address 类型 | 作为 `to` | 说明 |
|---|---|---|
| `literal` | ❌ 抛 AddressError | 不允许写入 literal |
| `public` | ✅ 写入 publicStore | 业务数据 |
| `internal` | ✅ 写入 internalStore | 寄存器 |
| `file` | ✅ 写入文件系统 | 文件内容 |

**execute_op / execute_intent 的 inputs/outputs 必须使用 `internal`**（强制约束）：

| Primitive | inputs | outputs | conditionAddr |
|---|---|---|---|
| `move` | 任意 | 非 literal | N/A |
| `execute_op` | 仅 `internal` | 仅 `internal` | N/A |
| `execute_intent` | 仅 `internal` | 仅 `internal` | N/A |
| `conditional_skip` | N/A | N/A | 仅 `internal` |
| `skip_n` | N/A | N/A | N/A |

**为什么这样约束**：
- **隔离语义边界**：L1 调度器不感知业务命名，只识别 `$r0` `$r1` 等形参地址
- **强制显式 move**：literal / file 必须先 `move` 到 internal 才能被 op 使用（防止"隐式喂常量"）
- **简化错误流**：所有错误写入 `$r_err`（统一寄存器），便于 DAG 条件分支检查

### 4.3 典型使用模式

**模式 1：literal → internal → execute_op → internal**

```typescript
// 加载常量到寄存器
{ kind: 'move',
  from: { kind: 'literal', value: '/tmp/data.txt' },
  to: { kind: 'internal', name: '$r0' } }

// 调用 op
  inputs: { path: { kind: 'internal', name: '$r0' } },
  outputs: { content: { kind: 'internal', name: '$r1' }, error: { kind: 'internal', name: '$r_err' } } }
```

**模式 2：file → internal → execute_op → public**

```typescript
// 读文件到寄存器
{ kind: 'move',
  from: { kind: 'file', path: '/etc/config' },
  to: { kind: 'internal', name: '$r0' } }

// 处理后保存到业务
{ kind: 'move',
  from: { kind: 'internal', name: '$r1' },
  to: { kind: 'public', name: 'user_config' } }
```

### 4.4 不再支持的 Address 类型

| 原 kind | 替代方案 | 理由 |
|---|---|---|
| `variable` | `public` / `internal` | 业务 vs 寄存器需要明确分离 |
| `stream` | （未列入 MVP）| 可用 file + shell_exec 组合 |
| `field` | （通过结构化 Value + 应用层处理）| 不需要专门的 Address 类型 |

**未来扩展**：如果需要，可加入 `stream`、`http`、`derived` 等类型，但当前 MVP 不实现。

---

## 五、Operation 接口（双区架构版）

### 5.1 自描述契约（formalSpec）

```typescript
interface Operation {
  // 标识
  name: string                       // 全局唯一（"opcode"）
  description: string                // 人类可读描述

  // 形参元数据（双区架构关键）
  formalSpec: OperationFormalSpec    // 业务语义名 ↔ L1 寄存器地址

  // 实际执行逻辑
  execute: (
    inputs: Record<string, Value>   // 从 internalStore 解析出的输入值
  ) => Promise<Record<string, Value>>  // 返回值写入 internalStore
}

// 形参定义（每个 param 声明业务语义名 + L1 寄存器地址）
interface FormalParam {
  businessName: string                // 业务语义名（业务/完整性分析使用）
  register: string                    // L1 寄存器地址（如 '$r0'），必填
  type: ParamType                     // 参数类型
  required: boolean                   // 是否必填
  description?: string                // 可选描述
}

// Operation 的完整形参定义
interface OperationFormalSpec {
  inputs: Record<string, FormalParam>   // key 是 businessName
  outputs: Record<string, FormalParam>  // key 是 businessName
}

// 标准错误结构（所有 op 统一）
interface OperationError {
  code: string         // 'ENOENT', 'EXEC_FAILED', 'PARSE_FAILED',...
  message: string      // 人类可读
  op: string           // 产生此错误的 operation 名
  timestamp: number    // 错误发生时间（毫秒）
  details?: unknown    // 可选额外上下文
}

interface FieldSchema {
  type: ParamType
  required: boolean
  default?: any                       // 默认值（仅 optional 时有意义）
  description?: string                // 用于澄清交互时展示
}

type ParamType =
  | 'string' | 'number' | 'boolean'
  | 'path'                            // 文件路径
  | 'pattern'                         // glob 模式
 | 'list<string>' | 'list<path>' | 'list<struct>'
  | 'struct'

type Value =
  | string | number | boolean | null | undefined
  | Value[]
  | { [key: string]: Value }
```

**为什么 `register` 是必填**：
- 编译期保证每个 param 都有明确的 L1 寄存器地址
- L3 编译时可以直接读取 formalSpec 获取寄存器映射，无需推断
- 防止 "业务名 vs 寄存器名" 的隐式赋值错误

**formalSpec 与 Operation 签名的一致性**：

```
formalSpec.inputs.x.register = '$r0'
formalSpec.outputs.result.register = '$r1'
formalSpec.outputs.error.register = '$r_err'

// execute() 返回：
{
  result: <value>,      // 写入 $r1
  error: OperationError | null  // 写入 $r_err
}
```

### 5.2 自洽性原则

```typescript
// ✅ 正确的 operation：自洽，不依赖外部状态
{
  name: 'file_read',
  formalSpec: {
    inputs: { path: { businessName: 'path', register: '$r0', type: 'path', required: true } },
    outputs: {
      content: { businessName: 'content', register: '$r1', type: 'string', required: false },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false }
    }
  },
  execute: async (i) => {
    try {
      const content = await fs.readFile(i.path, 'utf-8')
      return { content, error: null }
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { content: null, error: { code: 'ENOENT', message: err.message, op: 'file_read', timestamp: Date.now() } }
      }
      throw err  // 其他异常：交给 L1 冒泡（处置权在 L3 handleError）
    }
  }
}
```

**为什么**：operation 必须是"独立可执行的纯函数 over 数据区"。否则 operation 就不再是 opcode，而是带状态的服务。

### 5.3 注册机制

```typescript
// 核心内置 operations（执行层默认提供）
const BUILTIN_OPERATIONS: Operation[] = [
  file_read_op, file_write_op, glob_match_op, grep_search_op,
  shell_exec_op, string_replace_op, sort_by_op, take_first_op
]

// 扩展机制（pi 扩展点）
export default function(pi) {
  pi.registerOperation({
    name: 'docker_run',
    formalSpec: {
      inputs: {
        image: { businessName: 'image', register: '$r0', type: 'string', required: true },
        command: { businessName: 'command', register: '$r1', type: 'string', required: true }
      },
      outputs: {
        stdout: { businessName: 'stdout', register: '$r2', type: 'string', required: true },
        exit_code: { businessName: 'exit_code', register: '$r3', type: 'number', required: true },
        error: { businessName: 'error', register: '$r_err', type: 'object', required: false }
      }
    },
    execute: async (i) => { /* ... */ }
  })
}
```

**MVP 范围**：核心内置 + 扩展注册机制。

---

## 六、数据区（Data Area，双区架构）

### 6.1 概念

数据区是 primitive 之间共享数据的命名空间。**双区架构**（双区架构重大重写，2026-08-20）将数据区分为两部分：

```typescript
interface ExecutionState {
  // 公共数据区：业务数据，持久，业务命名
  publicStore: Map<string, Value>

  // 内部寄存器区：形参，瞬态，寄存器命名
  internalStore: Map<string, Value>

  // 寄存器分配器（L1 拥有，每个外部意图循环初始化一次）
  allocator: RegisterAllocator

  // 其他...
  stack: StackEntry[]
  l2: L2Registry
  l3: L3Service
}
```

### 6.2 命名约定

**publicStore**（业务命名）：
- 业务语义名（如 `output_content`, `user_config`, `final_result`）
- 长期持久，跨 primitive 调用保留
- 主要用于意图间传递“完成”数据

**internalStore**（寄存器命名）：
- `$r<N>` 形式（`$r0`, `$r1`, `$r2`, ...）
- 瞬态（仅在同一 intent 执行周期内有效）
- 专用于 L2 op 的 input/output
- 特殊寄存器： `$r_err` （全局错误寄存器）

| 寄存器 | 含义 |
|---|---|
| `$r0`, `$r1`, ... | L3 编译期分配的通用寄存器（单调递增） |
| `$r_err` | 全局错误寄存器（所有 op 的 error 输出都写到这里） |

**$ctx.* / $env.***：来自上下文层（只读，不在 L1 数据区中）。详见 [doc 08](./08-environment-context.md)。

### 6.3 作用域

```
外部意图处理循环（每个都独立）：
  publicStore: fresh at start（可选传入初始业务变量）
  internalStore: fresh at start（所有内部寄存器重置）
  allocator: fresh at start（新分配器）

子意图调用：
  重用父意图的 publicStore / internalStore / allocator（通过 state 传递）
```

**关键边界**：
- 执行层**不持有**跨外部意图状态（除非明确持久化到 publicStore）
- publicStore 可作为意图间传递数据的通道
- internalStore 是 transient 的（子意图结束后寄存器可能被覆盖）

### 6.4 为什么需要双区

**单区设计的问题**（原设计）：
- `variable` 既能表示业务语义名也能表示寄存器名，语义混淆
- L3 编译时无法确定形参地址（需要推断）
- execute_op 的 inputs/outputs 没有明确的"哪个寄存器"

**双区设计的优势**：
- **隔离语义边界**：public = 业务，internal = 寄存器（职责清晰）
- **形式参数元数据化**：FormalParam 明确声明 `businessName` ↔ `register` 映射
- **L3 应该读元数据**：L3 编译时只需要读 `formalSpec`，不需要推断
- **错误集中**：所有 op 错误都写 `$r_err`（单一寄存器），便于 DAG 条件分支检查

---

## 七、Layer 2 内置 Operations（L2 微代码集）

本节列出 MVP 内置的 L2 operations。每个 operation 必须明确两个属性：

- **实现方式**：原子（A，黑盒函数）还是微代码（B，分解到其他 L2/L1）
- **依赖**：是否依赖外部资源（如 shell、二进制）

### 7.1 实现分类：原子 vs 微代码

| Operation | 实现方式 | 依赖 | 理由 |
|---|---|---|---|
| `file_read` | **A 原子** | OS 文件系统 | `fs.readFile` 是原生原子调用 |
| `file_write` | **A 原子** | OS 文件系统 | `fs.writeFile` 是原生原子调用 |
| `glob_match` | **A 原子** | OS 文件系统 | 需要遍历目录，性能敏感 |
| `grep_search` | **A 原子** | OS 文件系统 | 需要扫描内容，性能敏感 |
| `shell_exec` | **A 原子** | shell | 必须交给 shell 执行 |
| `string_replace` | **B 微代码** | 无 | 可分解为 `find + replace` 或调用 `file_read + file_write` |
| `sort_by` | **B 微代码** | 无 | 可用 list ops 表达，但性能差 |
| `take_first` | **B 微代码** | 无 | 可用 list ops 表达，但性能差 |

**判断标准**：

- **A 原子**：调用 OS / 语言原生 API，性能/原子性更优
- **B 微代码**：纯函数变换，可分解为其他 operations

**注意**：MVP 阶段为简化实现，**全部 8 个都先用 A 原子方式实现**。这与 RISC 哲学不矛盾——L2 的实现是 L2 的内部选择，L1/L3 不关心。

### 7.2 核心 operations（11 个，2026-08-20 重构后）

**文件 / 进程 / 数据处理（10）**：

| Operation | Inputs | Outputs | 用途 |
|---|---|---|---|
| `file_read` | path, encoding?, range? | content | 读文件 |
| `file_write` | path, content, mode? | success | 写文件 |
| `glob_match` | pattern, path?, recursive? | matches | 模式匹配文件 |
| `grep_search` | pattern, path, context?, regex? | matches | 内容搜索 |
| `shell_exec` | command, cwd?, timeout? | stdout, stderr, exit_code | shell 执行 |
| `string_replace` | text, find, replace, regex? | result | 字符串替换 |
| `sort_by` | items, by, desc? | sorted | 列表排序 |
| `take_first` | items, n? | taken | 取前 n 个 |
| `increment_counter` | value | new_value | 计数器 + 1 |
| `decrement_counter` | value | new_value | 计数器 - 1 |

**表达式求值（1）**：

| Operation | Inputs | Outputs | 用途 |
|---|---|---|---|
| `evaluate_expr` | expr, env? | result | JSON 树形表达式求值（详见 §7.2.1） |

> **重构说明**（2026-08-20）：原 doc 06 §7.2 列出的"核心 8 个 operation"已扩展为 11 个。**表达式求值从 B06 的 12 个独立条件 op 整合为单一 `evaluate_expr` op**。详见 §7.2.1 与 dev-log/2026-08-20-evaluate-expr-redesign.md。

### 7.2.1 表达式求值 op（evaluate_expr）— 2026-08-20 重构

> **设计反馈（关键事实）**：L1 primitives 完全不调用任何比较/逻辑/算术 op。L1 的 `conditional_skip` 只读 truthy，**不调 op**。**所有"表达式求值"的真实使用方是 L3 编译器**。
>
> **旧设计**（B06）：实现 12 个独立条件 op（equals/gt/and/...）。L3 编译器要把 `if x == 'ENOENT' and not empty(items)` 编译成 4-6 个 execute_op DAG——**关注点切分错误**。
>
> **新设计**：单一 `evaluate_expr` op，接受完整 JSON 树形表达式，递归求值返回结果。L3 编译器只构造表达式树（1 个 execute_op），DAG 长度 N → 1。

#### 表达式 AST（Lisp-style S-expression）

```typescript
// evaluate_expr 的输入：JSON 树
type Expr =
  | { type: 'literal'; value: Value }              // 常量
  | { type: 'var'; name: string }                  // 读 internal 寄存器
  | { type: 'op'; name: OpName; args: Expr[] }     // 操作符调用
  | { type: 'if'; cond: Expr; then: Expr; else: Expr } // 三元（短路）

// evaluate_expr op
inputs:  { expr: Expr; env?: Record<string, string> }  // env: var 名 → internal 寄存器名（默认直接用 var.name）
outputs: { result: Value; error: OperationError }
```

**env 字段说明**：
- 可选映射（var 名 → internal 寄存器名），用于解耦表达式变量名与实际寄存器
- 默认 `env = {}`，表达式 `var.name` 直接作为 internal 寄存器名
- L3 编译器可生成 `env = { 'code': '$r_code' }` 这样的映射

#### MVP 支持的操作符

**算术**（6）：`+`, `-`, `*`, `/`, `%`, `neg`（一元取负）
- 仅支持 number。字符串 `+` = 连接。
- `/` 整数除法，错误数据：`DIVIDE_BY_ZERO`（当右操作数为 0）

**比较**（6）：`==`, `!=`, `>`, `<`, `>=`, `<=`
- 严格等于（`===` 语义）
- number / string / boolean / null / undefined

**逻辑**（3）：`and`, `or`, `not`
- **短路语义**：`and` 第一个 falsy 不评估剩余；`or` 第一个 truthy 不评估剩余
- 返回 boolean

**位运算**（8）：`&`, `|`, `^`, `~`, `<<`, `>>`, `>>>`, `bit_and`/`bit_or`/`bit_xor`（别名）
- 仅整数。浮点截断为 32 位。
- `~` 一元取反

**字符串**（6）：`length`（string/list）, `slice`, `concat`, `regex_match`, `to_string`, `to_number`
- `length`：字符串字节数 / 列表元素数
- `regex_match(str, pattern)` → boolean
- `to_string(value)` → string
- `to_number(str)` → number（解析失败返回 INVALID_INPUT）

**列表**（8）：`head`, `tail`, `length`（同字符串）, `map`, `filter`, `reduce`, `concat`, `contains`
- `head([1,2,3])` = `1`
- `tail([1,2,3])` = `[2,3]`
- `map(items, fn_expr)` / `filter(items, pred_expr)` / `reduce(items, fn_expr, init_expr)`
- `contains(items, value)` → boolean

**对象**（5）：`get`, `has`, `keys`, `values`, `merge`
- `get(obj, path_or_key)` → value（路径可字符串或 list）
- `has(obj, key)` → boolean
- `keys(obj)` → list<string>
- `values(obj)` → list
- `merge(obj1, obj2)` → 合并

**错误**（3）：`error_code`, `error_message`, `is_error`
- `error_code(error_obj)` → string（替代旧 `extract_error_code`）
- `error_message(error_obj)` → string
- `is_error(value)` → boolean（value 是 `{ code, message, op }` 形状）

**空检查**（3）：`is_null`, `is_empty`, `is_truthy`
- `is_null(value)` → boolean（null 或 undefined）
- `is_empty(value)` → boolean（字符串长度/列表长度/对象键数 == 0）
- `is_truthy(value)` → boolean（JS truthy 语义）

**类型**（1）：`typeof`
- `typeof(value)` → string（"number" / "string" / "boolean" / "object" / "undefined" / "function"）

**三元**：直接在 AST 中表达 `{ type: 'if', cond, then, else }`，无需操作符

#### MVP 不实现

- **lambda / 闭包**：MVP 标准意图库 < 50 条，不需要 lambda。表达式树是直接 AST 而非代码
- **in / between**：用 `or(equals(x, a), equals(x, b), ...)` 和 `and(gte(x, min), lte(x, max))` 组合
- **字符串插值 / 模板字符串**：用 `concat` 组合
- **正则替换**：用 L2 `string_replace` op（属于数据处理层，不属于表达式求值）

#### 短路与优先级

**短路**（由 AST 自然表达）：
```typescript
{ type: 'op', name: 'and', args: [
  { type: 'var', name: '$cond1' },
  { type: 'op', name: 'expensive_check', args: [...] }  // 不会被评估
]}
```

**优先级**（无需运算符优先级解析）：
```typescript
// 数学：a + b * c
{ type: 'op', name: '+', args: [
  { type: 'var', name: 'a' },
  { type: 'op', name: '*', args: [
    { type: 'var', name: 'b' },
    { type: 'var', name: 'c' }
  ]}
]}
```

#### L3 使用模式（条件分支判断）

**compileConditionalJudgment 简化为**：

```typescript
// 输入：Experience.conditional_judgment = { trigger: Expr, then_steps, else_steps }
// 输出：execute_op(evaluate_expr, { expr: trigger }, { result: $r_cond }) + conditional_skip

// 用户原始意图："如果 file_read 失败且 code 是 ENOENT，跳到 else 分支创建文件"
// 编译结果：
const trigger: Expr = {
  type: 'op',
  name: 'and',
  args: [
    { type: 'op', name: '!=', args: [
      { type: 'var', name: '$r_err' },
      { type: 'literal', value: null }
    ]},
    { type: 'op', name: '==', args: [
      { type: 'op', name: 'error_code', args: [{ type: 'var', name: '$r_err' }] },
      { type: 'literal', value: 'ENOENT' }
    ]}
  ]
}

// L1 DAG：
// 1. execute_op(evaluate_expr, { expr: trigger }, { result: $r_cond, error: $r_err2 })
// 2. conditional_skip($r_cond, else_steps.length)
// 3. then_steps...
// 4. skip_n(else_steps.length)
// 5. else_steps...
```

**对比旧设计**：5 个 execute_op（extract_error_code + equals + not_equals + and + ...）→ **1 个 evaluate_expr**

#### 输入约束

**重要约束**：evaluate_expr 的 inputs（`expr`, `env`）是**表达式数据**，由 L3 编译器生成（不来自 LLM）。
- L3 编译产物 = JSON 树 → 不需要 LLM 在运行时构造表达式
- LLM 只生成"高级意图"（如 "如果文件不存在则..."），L3 编译器映射为 Expr

**execute_op 只读 internal 的约束**：
- evaluate_expr 内部通过 `var` 引用读 internal 寄存器
- **不在 inputs 中**（否则违反 execute_op 只读 internal 的约束）
- 这是 evaluate_expr op 与其他 op 的差异点：它**主动读** internal 寄存器

#### 实现阶段

- **Phase B 末尾重构**（2026-08-20）：删除 12 个独立 op，实现 evaluate_expr
- **Phase C 依赖**：compileConditionalJudgment 用 evaluate_expr 简化（工时 1d → 0.3d）
- **替代决策**：本节**废弃** B06 实现的 12 个独立 op（equals/not_equals/gt/lt/gte/lte/and/or/not/is_truthy/is_empty/extract_error_code）

#### 实现位置

- `src/l2/builtins/evaluate-expr.ts`
- 测试：`tests/phase-b/tier-b07-evaluate-expr.test.ts`（替代 `tier-b06-conditional-ops.test.ts`）
- 替代文件：`tier-b06-conditional-ops.test.ts` **删除**

### 7.3 详细 Schema

```typescript
// 1. file_read
{
  name: 'file_read',
  inputs: {
    path: { type: 'path', required: true },
    encoding: { type: 'string', required: false, default: 'utf-8' },
    range: { type: 'struct', required: false }  // { start: number, end: number }
  },
  outputs: {
    // ⚠️ 已修订：错误作为数据返回（见 doc 10 §五.2）
    content: { type: 'string', required: false },  // 成功时有值
    error: { type: 'object', required: false }     // 已知错误时为 { code, message }
  }
}

// 2. file_write
{
  name: 'file_write',
  inputs: {
    path: { type: 'path', required: true },
    content: { type: 'string', required: true },
    mode: { type: 'string', required: false, default: 'overwrite' } // overwrite | append
  },
  outputs: {
    success: { type: 'boolean', required: true }
  }
}

// 3. glob_match
{
  name: 'glob_match',
  inputs: {
    pattern: { type: 'pattern', required: true },
    path: { type: 'path', required: false, default: '.' },
    recursive: { type: 'boolean', required: false, default: false }
  },
  outputs: {
    matches: { type: 'list<path>', required: true }
  }
}

// 4. grep_search
{
  name: 'grep_search',
  inputs: {
    pattern: { type: 'string', required: true },
    path: { type: 'path', required: true },
    context: { type: 'number', required: false, default: 0 },
    regex: { type: 'boolean', required: false, default: false }
  },
  outputs: {
    matches: { type: 'list<struct>', required: true }
    // struct shape: { file: string, line: number, content: string, before?: string, after?: string }
  }
}

// 5. shell_exec（兜底）
{
  name: 'shell_exec',
  inputs: {
    command: { type: 'string', required: true },
    cwd: { type: 'path', required: false },
    timeout: { type: 'number', required: false }  // 毫秒
  },
  outputs: {
    stdout: { type: 'string', required: true },
    stderr: { type: 'string', required: true },
    exit_code: { type: 'number', required: true }
  }
}

// 6. string_replace
{
  name: 'string_replace',
  inputs: {
    text: { type: 'string', required: true },
    find: { type: 'string', required: true },
    replace: { type: 'string', required: true },
    regex: { type: 'boolean', required: false, default: false }
  },
  outputs: {
    result: { type: 'string', required: true }
  }
}

// 7. sort_by
{
  name: 'sort_by',
  inputs: {
    items: { type: 'list<string>', required: true },
    by: { type: 'string', required: true }, // 'name' | 'mtime' | 'size'
    desc: { type: 'boolean', required: false, default: false }
  },
  outputs: {
    sorted: { type: 'list<string>', required: true }
  }
}

// 8. take_first
{
  name: 'take_first',
  inputs: {
    items: { type: 'list<string>', required: true },
    n: { type: 'number', required: false, default: 1 }
  },
  outputs: {
    taken: { type: 'list<string>', required: true }
  }
}

// 9. evaluate_expr（2026-08-20 重构新增）
{
  name: 'evaluate_expr',
  inputs: {
    expr: { type: 'object', required: true, description: 'JSON 树形表达式' },
    env: { type: 'object', required: false, description: 'var 名 → 寄存器名映射' }
  },
  outputs: {
    result: { type: 'any', required: true },
    error: { type: 'object', required: false }
  }
}
```

### 7.4 选择标准

v1 内置集的选择原则：

1. **不可替代性**：不能用其他 operations 表达的操作优先
3. **高频使用**：日常任务中常见
4. **业务无关**：不带"日志"、"测试"、"git"等业务含义
6. **易于实现**：不引入额外依赖

被故意排除的操作：

- `git_commit`、`docker_run`、`npm_test` → 业务操作，应通过 `shell_exec` 或扩展实现
- `read_log_file` → 业务操作，应通过 `glob_match('*.log') + sort_by + file_read` 组合
- `run_tests` → 业务操作，需要项目上下文

---

## 八、编译示例

> **重要更新（参见 [doc 10](./10-reactive-execution-model.md) §七）**：本文档的"编译示例"展示的是 L3 一次分解一层产生的 children。每个 child 是 op 或 sub-intent；具体执行时由 L1 通过异构指令栈调度。
>
> 旧理解的"完整 Primitive 序列"被替换为"指令栈轨迹"——见 doc 10 §七完整 walkthrough。

### 8.1 "读 README.md"

```typescript
[
  { kind: 'execute_op',
    operation: 'file_read',
    inputs:  { path: { kind: 'literal', value: 'README.md' } },
    outputs: { content: { kind: 'variable', name: '$readme' } } }
]
```

### 8.2 "查找最近的日志文件并显示"

```typescript
[
  // 1. 找日志
  { kind: 'execute_op',
    operation: 'glob_match',
    inputs:  { pattern: { kind: 'literal', value: '*.log' },
               path: { kind: 'literal', value: '.' } },
    outputs: { matches: { kind: 'variable', name: '$log_files' } } },

  // 2. 按 mtime 排序
  { kind: 'execute_op',
    operation: 'sort_by',
    inputs:  { items: { kind: 'variable', name: '$log_files' },
               by: { kind: 'literal', value: 'mtime' },
               desc: { kind: 'literal', value: true } },
    outputs: { sorted: { kind: 'variable', name: '$sorted_logs' } } },

  // 3. 取最新一个
  { kind: 'execute_op',
    operation: 'take_first',
    inputs:  { items: { kind: 'variable', name: '$sorted_logs' } },
    outputs: { taken: { kind: 'variable', name: '$latest_log' } } },

  // 4. 提取 path
  { kind: 'move',
    from: { kind: 'field', parent: { kind: 'variable', name: '$latest_log' }, path: '[0]' },
    to:   { kind: 'variable', name: '$log_path' } },

  // 5. 读文件
  { kind: 'execute_op',
    operation: 'file_read',
    inputs:  { path: { kind: 'variable', name: '$log_path' } },
    outputs: { content: { kind: 'variable', name: '$log_content' } } }
]
```

### 8.3 "在所有 .ts 文件中搜索 'TODO'"

```typescript
[
  { kind: 'execute_op',
    operation: 'glob_match',
    inputs:  { pattern: { kind: 'literal', value: '*.ts' },
               recursive: { kind: 'literal', value: true } },
    outputs: { matches: { kind: 'variable', name: '$ts_files' } } },

  { kind: 'execute_op',
    operation: 'grep_search',
    inputs:  { pattern: { kind: 'literal', value: 'TODO' },
               path: { kind: 'variable', name: '$ts_files' },
               context: { kind: 'literal', value: 2 } },
    outputs: { matches: { kind: 'variable', name: '$todo_matches' } } }
]
```

### 8.4 "把 foo.txt 里的 'old' 替换成 'new'"

```typescript
[
  { kind: 'execute_op',
    operation: 'file_read',
    inputs:  { path: { kind: 'literal', value: 'foo.txt' } },
    outputs: { content: { kind: 'variable', name: '$original' } } },

  { kind: 'execute_op',
    operation: 'string_replace',
    inputs:  { text: { kind: 'variable', name: '$original' },
               find: { kind: 'literal', value: 'old' },
               replace: { kind: 'literal', value: 'new' } },
    outputs: { result: { kind: 'variable', name: '$modified' } } },

  { kind: 'execute_op',
    operation: 'file_write',
    inputs:  { path: { kind: 'literal', value: 'foo.txt' },
               content: { kind: 'variable', name: '$modified' } },
    outputs: { success: { kind: 'variable', name: '$ok' } } }
]
```

### 8.5 "运行 npm test 并显示结果"

```typescript
[
  { kind: 'execute_op',
    operation: 'shell_exec',
    inputs:  { command: { kind: 'literal', value: 'npm test' },
               cwd: { kind: 'field', parent: { kind: 'variable', name: '$ctx' }, path: 'project_root' } },
    outputs: { stdout: { kind: 'variable', name: '$test_output' },
               stderr: { kind: 'variable', name: '$test_errors' },
               exit_code: { kind: 'variable', name: '$test_rc' } } }
]
```

### 8.6 "读文件或创建文件"（DAG 条件分支示例）

> **新示例**：展示 L3 如何编译 if-then-else 为 conditional_skip + skip_n 组合。

```typescript
// 意图: read_or_create_file
// DAG:
//   1. file_read(path)
//   2. if $error == null:
//        then: nothing (已读到)
//        else: file_write(path, "default")

// 编译为 children 数组:
[
  { kind: 'execute_op',
    operation: 'file_read',
    inputs: { path: { kind: 'input', name: 'path' } },
    outputs: { content: '$content', error: '$error' } },

  // 条件为真（$error == null）时跳过整个 else 块
  { kind: 'conditional_skip',
    conditionAddr: { kind: 'address', ref: '$error_is_null' },
    n: 2 },  // 跳过 noop + skip_n

  // else 块：创建默认文件
  { kind: 'execute_op',
    operation: 'noop',
    inputs: {},
    outputs: {} },

  // 无条件跳过 then 块
  { kind: 'skip_n',
    n: 1 },  // 跳过 noop

  // then 块：什么都不做（file_read 已成功）
  { kind: 'execute_op',
    operation: 'noop',
    inputs: {},
    outputs: {} }
]
```

### 8.7 复杂度统计

| 意图 | 步骤数 | 涉及 operations |
|---|---|---|
| 读单文件 | 1 | file_read |
| 读最新日志 | 5 | glob_match, sort_by, take_first, file_read |
| 全局搜索 | 2 | glob_match, grep_search |
| 文件编辑 | 3 | file_read, string_replace, file_write |
| 跑命令 | 1 | shell_exec |

**观察**：

- 简单意图 → 1 步
- 复合意图 → 3-5 步
- 步骤数与意图复杂度成正比，**没有"快捷方式"**

---

## 九、关键决策记录

### D1. 为什么 `move` 不做类型转换？

`move` 的职责是"搬运数据"，不是"处理数据"。若需要在搬运过程中转换类型，先用 `execute_op(transform_op, ...)` 再用 `move`。

**反例**：把 `move` 设计为支持 `{ from: json, to: yaml, transform: 'auto' }` 会让 `move` 失去纯数据搬运的语义。

### D2. 为什么 `execute` 的 inputs/outputs 用 Record 而不是 Array？

`Record<string, Address>` 让：

- operation 的 I/O 契约**自描述**（key 就是参数名）
- 编译层可以**按名校验**完整性
- 顺序无关（不易出错）

**反例**：用 `args: Address[]` 会丢失参数名信息。

### D3. 为什么 `glob_match` 是 operation 而不是内置 `move` 来源？

理论上 `move(from: glob, to: var)` 可以工作。但 `glob_match` 需要：

- 计算（按模式匹配文件）
- 输出列表（结构化数据）

这两点让它**属于 compute**，不属于 data movement。

### D4. 为什么 `edit_file` 拆为 read + replace + write？

让"修改"成为**显式的三步组合**：

```
file_read → string_replace → file_write
```

收益：

- `string_replace` 可以独立测试、独立复用
- 修改逻辑清晰可见（编译产物可读）
- 没有"特殊编辑语义"，与 RISC 哲学一致

### D5. 为什么 shell_exec 作为兜底而不是主路径？

- `shell_exec` 命令的语义**不属于执行层**（是 shell 的语义）
- 它无法做完整性分析（命令内容太开放）
- 优先用语义 operation，兜底走 shell_exec

### D6. operation 的 `required: false` 与默认值如何处理？

- `required: false` 表示该参数可省略
- 若有 `default`，operation 内部使用默认值
- 若省略且无 default，operation 应抛错（不假设空值）
- 完整性分析层根据 `required` 决定是否必须澄清

---

## 十、与上游层的接口

### 10.1 接收自编译层

```typescript
// 编译层输出
interface CompiledSequence {
  primitives: Primitive[]      // move | execute_op | execute_intent | skip_n | conditional_skip
  metadata: {
    intent_type: string
    derived_data_area_init?: Record<string, Value>  // 初始化数据区
  }
}
```

### 10.2 接收自完整性分析层

完整性分析层确保：

- 每个 `execute` 的 `operation` 已注册
- 每个 `execute` 的 `inputs` 中**必需参数都已提供**
- 每个 `execute` 的 `outputs` 中 `Address` 类型合法
- 每个 `move` 的 `from` 与 `to` 类型域一致

### 10.3 输出到上下文层

执行层不直接与上下文层通信。通过：

- `$ctx.*` Address（只读访问）
- trace logger（可观测性输出）

---

## 十一、边界与开放问题

### 11.1 跨序列状态共享

**问题**：用户说"先读 X，再编辑 Y，再读 X"，三个动作是 3 个 sequence 还是 1 个？

**当前决策**：MVP 默认每个用户 turn 是 1 个 sequence。跨 turn 状态通过上下文层（Layer 2）。

**开放**：是否需要"跨 sequence 显式变量传递"语法？例如：

```typescript
[primitive_1, pipe_to: '$x', primitive_2, primitive_3, from: '$x']
```

### 11.2 流式/管道数据

**问题**：`shell_exec` 的 stdout 可能很大（GB 级）。`execute` 一次性返回整个 stdout 字符串合理吗？

**当前决策**：MVP 假设所有 operation 输出都装入数据区。大数据场景需要"流式 operation"。

**开放**：是否需要异步流式输出（`ReadableStream` 类型）？

### 11.3 错误恢复（双区架构版，2026-08-20 修订）

**问题**：op 失败时，整个 sequence 是否中止？是否可以指定某些 primitive 失败可忽略？

**当前决策**（**已重大修订**，详见 [doc 10 §三.8/§三.9](./10-reactive-execution-model.md)）：
- L1 不做集中式错误分析（执行层只关心调度）
- **错误处置权在 L3**（handleError 标志）——是否捕捉/处理由 L3 编译结果决定：
  - **op 返回错误数据**：`{ content: null, error: OperationError }` → 写入 `$r_err`，DAG 通过 conditional_skip 检查
  - **op throw（任何异常）**：主循环 catch → bubbleError → 写 `$r_err` → 找最近 handleError 帧截获；无 handler → 冒泡给调用者
- **不**使用 ErrorHandlerEntry 或 pushErrorHandler（业务逻辑应在 DAG 中表达）
- DAG 条件分支是**业务逻辑**，不属于错误处理
- ❌ 原"已知错误 vs 硬错误二分 + propagateHardError"已废弃（详见 doc 10）

**$r_err 全局错误寄存器**（双区架构重要变更）：
- 所有 op 的 `error` 输出都写入 `$r_err`（全局共享）
- 成功时：`$r_err` = `null`
- 失败时：`$r_err` = 标准 `OperationError` 结构
- 同一个 `$r_err` 被后续 op 覆盖（last-op-wins）
- DAG 通过 `conditional_skip(conditionAddr: $r_err)` 检查

**理由**：
- "错误后做什么"是业务决策，应在意图 DAG 中显式表达
- DAG if-then-else 让所有可能路径可见
- L1 主循环极简：5 primitive 调度，无需特殊错误路径
- 错误处理与正常处理统一为同一个调度循环（5-case dispatch）
- `$r_err` 统一错误输出位置，简化 DAG 表达式

**示例**：file_read 修订（双区架构版）

```typescript
const fileRead: Operation = {
  name: 'file_read',
  formalSpec: {
    inputs: {
      path: { businessName: 'path', register: '$r0', type: 'path', required: true }
    },
    outputs: {
      content: { businessName: 'content', register: '$r1', type: 'string', required: false },
      error: { businessName: 'error', register: '$r_err', type: 'object', required: false }
    }
  },
  execute: async (inputs) => {
    try {
      const content = await fs.readFile(inputs.path, 'utf-8')
      return { content, error: null }  // 成功
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { content: null, error: createOperationError('ENOENT', err.message, 'file_read') }
      }
      throw err  // 其他异常：交给 L1 冒泡（处置权在 L3 handleError）
    }
  }
}
```

**DAG 中处理错误**（双区架构表达）：

```typescript
[
  // 调用 file_read（输出到 $r1, $r_err）
  { kind: 'execute_op', operation: 'file_read',
    inputs: { path: { kind: 'internal', name: '$r0' } },
    outputs: { content: { kind: 'internal', name: '$r1' }, error: { kind: 'internal', name: '$r_err' } } },

  // 如果 $r_err 为 null（成功）则跳过 else 块
  { kind: 'conditional_skip', conditionAddr: { kind: 'internal', name: '$r_err' }, n: 2 },

  // --- else 块：错误处理 ---
  { kind: 'move', from: { kind: 'literal', value: 'DEFAULT_CONTENT' }, to: { kind: 'internal', name: '$r1' } },

  // 跳过 then 块
  { kind: 'skip_n', n: 1 },

  // --- then 块：成功处理 ---
  { kind: 'move', from: { kind: 'internal', name: '$r1' }, to: { kind: 'public', name: 'final_content' } }
]
```

### 11.3.1 AddressError 错误码约定（2026-08-20 增强）

L1 Address 解析器（`AddressError`）与 L2 Op 错误（`OperationError`）是**两个独立错误层**，使用不同的 code 约定：

**AddressError.code**（L1 层）：
- `LITERAL_WRITE`：写入 literal（编程错误）
- `VARIABLE_NOT_FOUND`：public/internal 不存在（语义错误）
- 原始 fs code：`ENOENT`, `EACCES`, ...（系统错误，透传）
- `undefined`：未分类（默认值）

**OperationError.code**（L2 层）：
- L2 op 自己定义的错误分类（如 `FILE_NOT_FOUND`, `PARSE_FAILED`）
- 与 AddressError.code 可以相同（如都用 'ENOENT'）但语义不同

**DAG 中可以基于两个 code 做决策**：

```typescript
[
  // 例：file_read 失败但 ENOENT 特殊处理（创建默认），其他错误重新抛出
  { kind: 'execute_op', operation: 'file_read',
    outputs: { content: $r1, error: $r_err } },

  // 如果 $r_err 是 OperationError（truthy），跳到错误分支
  { kind: 'conditional_skip', conditionAddr: $r_err, n: 3 },

  // 成功分支...
  { kind: 'skip_n', n: 4 },

  // 错误分支开始
  // 检查 err.code 决定是 ENOENT 还是其他错误
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

  { kind: 'conditional_skip', conditionAddr: $r_is_enoent, n: 1 },

  // ENOENT 处理
  { kind: 'move', from: literal('default'), to: $r1 },
  { kind: 'skip_n', n: 1 },

  // 其他错误：重新抛出
  { kind: 'execute_op', operation: 'error_rethrow', inputs: { error: $r_err } }
]
```

**注意**：当前 MVP 阶段 `execute_op` 接收的 inputs 是 `internal` Address，不能直接传 `$r_err.code`（因为 code 在 err 对象内部）。**重构后** evaluate_expr 通过 `{ type: 'var', name: '$r_err' }` 直接读寄存器内的 OperationError 对象，再用 `error_code($err)` 操作符提取 code——不需要单独的 extract_error_code op。详见 [§7.2.1 evaluate_expr](./06-execution-layer.md#721-表达式求值-opevaluate_expr-2026-08-20-重构)。
```

这是 Phase C（DAG 编译器）需要实现的功能。

**详细设计**见 [doc 10 §五/§六/§七](./10-reactive-execution-model.md) 和 [prototype 实现](../../mvp-prototype/src/l1/address-resolver.ts)。

### 11.4 operation 的依赖

**问题**：operation 之间是否允许依赖？例如 `docker_run` 是否依赖 `docker` 二进制存在？

**当前决策**：operation 是纯函数，依赖检测由调用方（编译层/完整性分析层）负责。

**开放**：是否需要 operation 的 `requires: ['docker']` 声明？

### 11.5 Address 类型扩展

**当前**：5 种 Address（literal、variable、file、stream、field）

**待讨论**：

- `env` —— 环境变量
- `http` —— HTTP 资源
- `derived` —— 派生数据（已在 sort_by/take_first 中使用，**不是独立 Address**）
- `concat` —— 字符串拼接 Address（语法糖 vs 独立 operation？）

### 11.6 operation schema 的形式化

**当前**：TypeScript 接口 + 手写 ParamSpec

**待讨论**：

- 是否用 TypeBox schema（与 pi 现有风格一致）？
- 是否需要 JSON Schema 形式（用于多语言实现）？
- schema 版本管理（operation 升级时如何处理旧 inputs）？

---

## 十二、设计意图一页纸

### 三层架构总览

| 层级 | 词汇表 | 类比 | 不变性 |
|---|---|---|---|
| **L1 硬件层** | 5 primitive（`move` / `execute_op` / `execute_intent` / `skip_n` / `conditional_skip`） | CPU ISA (RISC) | **永远不扩展** |
| **L2 微代码层** | 业务 operations（file_read, glob_match, ...） | CPU 微码 | 可扩展 |
| **L3 意图编译层** | L2/L1 指令序列（含 DAG 条件分支） | 应用程序 | 可演化 |

### 核心决策

1. **L1 不可变**：词汇表固定为 5 个 primitive
2. **L2 可扩展**：业务 operations 通过微代码或原子方式实现
3. **L3 优先 L2**：意图编译优先使用 L2 operations，自带 I/O schema 更可靠
4. **错误处理走 DAG 条件分支**：不特殊化错误路径

### 关键原则

1. **业务语义零泄漏到 L1**：L1 不包含 `read_file`、`edit_file` 等业务动词
2. **Operation 自描述**：每个 L2 operation 定义自己的 inputs/outputs schema
3. **Address 对称**：变量、文件、字面量在 `move` 中地位平等
4. **数据区隔离**：L1 不持有跨序列状态
5. **5 primitive 调度**：move / execute_op / execute_intent / skip_n / conditional_skip

### 与 MVP 04 原提案的关系

- MVP 04 的 7 primitive → 全部属于 L2 微代码层
- L1 词汇表从 MVP 04 的"7 + compose"演进为"5 primitive"
- 业务操作全部下沉为可注册的 L2 operations

### MVP 范围

- **L1**：5 primitive（`move` / `execute_op` / `execute_intent` / `skip_n` / `conditional_skip`）
- **L2**：8 内置 operations（file_read、file_write、glob_match、grep_search、shell_exec、string_replace、sort_by、take_first）
- **Address**：5 类型（literal、variable、file、stream、field）
- **注册机制**：核心内置 + 扩展注册

### 演进路径

- **优先**：新增 L2 operations（90% 场景）
- **备选**：L1 富指令集模式（仅当性能/语义不可替代时）

### 类比

CPU 的 RISC + 微码架构——L1 是 ISA，L2 是微码，L3 是应用。

### 收益

- 词汇表最小（L1 只有 2 个动词）
- 完整性分析简化（只需检查 Address 合法性）
- L2 可插拔（新增 operation 不需要改 L1）
- 编译规则简单（只需展开为 L2/L1 序列）

### 代价

- 简单意图可能编译出多步（如"读最新日志" = 5 步 L2 operations）
- 需要维护 L2 operation 注册表
- L2 operation 升级需要 schema 版本管理

---

## 十三、参考：与相关系统的对照

### 13.1 与 CPU 架构的对照（三层对应，双区架构版）

| CPU 概念 | 本设计 | 关系 |
|---|---|---|
| ISA 指令（ADD、MOV、LOAD） | L1 primitives（5 primitive） | 都是不可分的原子 |
| 微码（实现复杂指令） | L2 operations（分解到 L1） | 都是上层语义的实现 |
| 复杂指令集（x86 STRING） | L1 富指令集模式（保留扩展点） | 都是性能优化路径 |
| 应用程序 | L3 编译产物（指令序列） | 都是上层使用 |
| **寄存器文件**（RAX, RBX,...） | `internalStore` ($r0, $r1, $r_err) | 都是形参的动态存储 |
| **主存 / RAM** | `publicStore` | 都是业务数据的持久存储 |
| **MOV / LOAD / STORE** | `move` primitive | 都是数据搬运指令 |
| **ALU 操作**（ADD, SUB,...） | `execute_op` | 都是数据变换 |
| **函数调用 / CALL** | `execute_intent` | 都是宏操作调用 |
| **BRANCH / JMP** | `skip_n` / `conditional_skip` | 都是控制流 |
| **FLAGS 寄存器** | `$r_err` | 都是错误/状态标记 |
| **寄存器分配器** | `RegisterAllocator` | 都是寄存器调度 |

### 13.2 与其他执行模型的对照

| 系统 | L1 词汇表 | 数据移动 | 计算 | 控制流 | 备注 |
|---|---|---|---|---|---|
| **CPU RISC** | ~50 指令 | MOV/LOAD/STORE | ADD/MUL/... | BRANCH/JMP | 寄存器文件 + 内存 |
| **LLVM IR** | 30+ 指令 | load/store | add/mul/call | br/switch | SSA 形式 |
| **数据库** | DDL/DML | SELECT/INSERT | JOIN/AGG | WHERE | 表作为数据 |
| **本设计** | 5 primitive | move | execute_op | skip_n/conditional_skip | publicStore + internalStore（双区） |

**共同模式**：**定义层（操作自描述）+ 验证层（schema 校验）+ 执行层（纯函数调用）**。

### 13.3 与 pi 的对照

| Pi 设计 | 本设计 | 对应层级 |
|---|---|---|
| 4 核心工具（read/write/edit/bash） | L1 5 primitive（move/execute_op/execute_intent/skip_n/conditional_skip） | L1 |
| 扩展注册（`registerTool`） | L2 operations 注册 | L2 |
| `tool_call` 拦截 | L3 编译产物拦截点 | L3 |
| 自然语言 → 工具调用 | 意图编译规则 | L3 |

**核心观察**：本设计是 pi 架构的"形式化版本"——把 pi 隐式的工具调用关系显式分层。