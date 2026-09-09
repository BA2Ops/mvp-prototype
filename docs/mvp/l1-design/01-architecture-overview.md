# L1 架构总览

> **定位**：本文档是 [L1 设计文档集](./README.md) 的第一篇，阐述 L1 的**高层架构**——双数据区、异构指令栈、与 L2/L3 的关系、指令风格特征。
>
> **刻意不展开的内容**（避免重复维护、造成新的"第二事实源"）：
> - 单条 primitive / builtin operation 的字段级定义 → 见规划中的 [02-instruction-set-reference.md](./README.md#规划中尚未编写)，过渡期以 `src/l1/types.ts` + `src/l2/builtins/*.ts` 源码为准
> - CRR scope-prefixing 的具体 slotIndex 命名规则与 feature flag 现状 → 见规划中的 [03-register-file.md](./README.md#规划中尚未编写)，设计推演过程见顶层 [../19b-register-design.md](../19b-register-design.md)
> - 异常冒泡/handleError 的错误处置权细节 → 见规划中的 [04-error-handling.md](./README.md#规划中尚未编写)，当前实现语义参考 [../10-reactive-execution-model.md §三.8–§三.9](../10-reactive-execution-model.md)

---

## 一、L1 在三层执行架构中的位置

| 层级 | 类比 CPU | 词汇表规模 | 不变性要求 |
|---|---|---|---|
| **L1**（本文档对象） | 硬件 ISA（RISC） | 5 个 primitive，固定不扩展 | 「永远不新增指令」是核心约束 |
| L2 | 微码 / builtin function library | 可扩展的自描述 Operation 集合 | 自由增删，不影响 L1 调度器代码 |
| L3 | 应用程序（编译器产物） | Experience DAG 编译出的 L1/L2 调用序列 | 业务逻辑层，随场景演化 |

「为什么固定为 5 条而不是更多/更少」的完整论证与历史演进（从最初 2-primitive 到现版）见 [../06-execution-layer.md §一](../06-execution-layer.md)、[../10-reactive-execution-model.md §二](../10-reactive-execution-model.md)，本文不复述推导过程。

## 二、双数据区（internalStore + publicStore）

L1 运行时持有的所有"可寻址存储"分成两个彼此隔离的区域：

| 区域 | TypeScript 类型 | 生命周期语义 | 典型写入者 |
|---|---|---|---|
| **`internalStore`** | `Map<string, Value>`（瞬态寄存器区） | 单次外部请求处理循环内有效；跨指令数据复用通过固定的槽位地址引用实现，而不是把值本身当作参数一路传下去 | L3 compiler 生成的 move / execute_op 相关 entry |
| **`publicStore`** | `Map<string, Value>`（业务持久区） | 比 internalStore 更持久的概念层，专门承载「必须跨越一次经验调用边界才能被消费」的数据 | post-bindings move（由 compiler 在 Experience 编译收尾阶段统一生成，见 [../19c-implementation-plan.md T-2.2](../19c-implementation-plan.md)） |

> 两区各自具体的 key 命名规则不属于本架构文档要回答的问题——internalStore 侧的新旧两套寄存器命名约定、publicStore 侧的键格式，都会随 CRR 后续阶段的清理演进，属于规划中的 [03-register-file.md](./README.md#规划中尚未编写) 的职责范围。

### 关键设计原则：`move` 是唯一跨区桥梁

- `execute_op` / `execute_intent` / `conditional_skip` **只能读写 `internal` kind Address**
- `literal` 必须先通过一条独立的 `move` entry 搬进 `internal` 后才能被 op 使用
- `move` 本身允许任意合法的 from→to 组合（除 `to = literal`）。原先还有第 4 种 kind=`file`（把文件系统当作可直接寻址的存储），现已决定**彻底删除该 kind**——IO 职责一律下沉到 L2 op 承担（读用 `execute_op('file_read')`、写用 `execute_op('write_file')`，各自在自己的 execute() 内做真实 fs 调用），L1 层不再持有任何 fs 依赖；详见 [02-instructions/move.md](./02-instructions/move.md#from--to-各-kind-组合的行为矩阵)

这条约束的目的是让"数据从哪个存储区来、写到哪个存储区去"这件事**只发生在显式的 move entry 上**，而不是隐藏在每条指令的参数解析里——L1 调度器因此可以保持对存储区的完全无感知（它只做字符串 key 查表），业务语义边界天然清晰。
> ✅ **已决策（原待确认架构问题）**：Address type 里的 `kind:'file'` 分支已从类型定义正式移除（连同 resolver 的两个 case 分支 + `isFileAddress` guard 一并清理），不再是"保留下来作测试/调试后门"。

### 多请求隔离不变量（K1）

每个 L4/L3 外部发起的请求处理循环都调用一次 `createInitialState()`，得到全新的 `stack`/`publicStore`/`internalStore`/`frameScopeAllocator?`/`recursionDepth` —— **同一进程内并发或连续处理的多个请求之间不存在共享的可变存储**。这是「寄存器架构」在实例粒度上的基本单元：所谓"L1 运行时"不是全局单例，而是 per-request 的 state bundle，由 `l1MainLoop(rootIntent, state, options)` 驱动其整个生命周期直至栈空。（该条约束来源见 [../19-register-file-core.md K1](../19-register-file-core.md)，当前实现入口为 `src/l1/execution-state.ts createInitialState()`。）

## 三、异构指令栈

L1 调度器维护**单一 push/pop LIFO 栈**（`state.stack: StackEntry[]`），栈元素是 5 种 primitive 之一的 discriminated union（公共字段 `id` / `parentIntentId` / `createdAt` + kind-specific payload）：

| kind | 一句话职责 |
|---|---|
| `move` | 跨区/区内数据搬运（唯一数据操作 primitive） |
| `execute_op` | 按名字查表调用一个已注册的 L2 Operation |
| `execute_intent` | 触发一次 L3 compile，把返回的 children 逆序压栈后进入 awaiting_children phase |
| `skip_n` | 无条件弹出 self + n 个后续 entry |
| `conditional_skip` | 读 internal 某寄存器值做 truthy 判断，决定是否额外弹出 n 个后续 entry |

「每条指令的完整字段语义与执行细节」不在此展开（见规划文档指针）。本文档只固定三个对理解整体架构最关键的结构性事实：

### 3.1 帧保留的两阶段生命周期（CALL/RET 的基本骨架）

`execute_intent` entry 携带自己的 `phase` 状态机：`pending →（L1 首次处理时调 L3 compile）→ awaiting_children → done/aborted`。compile 产出的 children 被**逆序压入同一张栈**（而不是另开子栈），随后主循环继续用统一的方式 pop-and-execute——"CALL 就是往共享栈里多推一段指令序列并记住自己还没结束"，"RET 就是检测到该 intentEntry 的所有 children 都完成后回到它的父级上下文继续推进"。这是 L1 唯一的递归/嵌套机制来源，配合 CRR 引入的 frame scope prefixing 实现跨 CALL/RET 边界的地址隔离（详见 [../19b-register-design.md R5.3](../19b-register-design.md)，落地现状待 `03-register-file.md` 记录）。

### 3.2 abortFrame 对称性约束（R-1🔴高关键不变量）

进入一个新意图帧时会同步做一次「scope/depth 登记」（CRR new path 下是 `frameScopeAllocator.enterScope()` + recursion depth map 递增；legacy path 只有后者）。**任何一条让该帧提前退出的路径都必须执行一次完全对称的反向操作**：正常完成走 aggregate/pop 路径时 exitScope + depth 递减；异常冒泡触发 `bubbleError → abortFrame` 时必须同样补上这一次 exitScope——漏掉其中任意一条路径都会造成 allocator 游标单调泄漏或后续帧拿到错误的 scopeId。这条对称性约束目前以代码注释形式标注在 `src/l1/main-loop.ts` 相关函数内，等待未来收进独立的错误处理权威文档（[规划中 04-error-handling.md](./README.md#规划中尚未编写)），在此之前以源码为准。

### 3.3 递归深度安全网（A11）

循环不靠新增 `loop` primitive 表达，而是靠"经验自嵌套引用 + conditional_skip"实现（完整编译示例见 [../06-execution-layer.md §三.6](../06-execution-layer.md)、walkthrough 轨迹见 [../10-reactive-execution-model.md §六.5](../10-reactive-execution-model.md)，本文不复述具体步骤序列）。因为逻辑上不强制终止的写法也能通过这套机制合法构造出来，L1 单独维护一张 per-experience-id 的深度计数 map（`state.recursionDepth`），超过可配置上限（默认 1000，经 `L1RunOptions.maxRecursionDepth` 覆盖）时抛专门的 `RecursionDepthError` —— 这是**系统级防御异常，不走业务冒泡/handleError 流程**（与 L2 op 自身 throw、或 DAG 内部条件分支检测到的业务错误是三类不同来源的错误，处置路径完全不同，详细区分等待 04 文档统一整理）。

## 四、与 L2 的关系：自描述 Operation 契约

- L2 Operation 是**普通对象**（含一个 `execute(inputs)` 方法 + 一份静态 `formalSpec` 元数据声明 inputs/outputs 每个参数的 businessName/slotIndex/required/type 等），通过 `L2Registry.register()` 在启动期集中注册，运行期靠名字字符串查表调用——L1 调度器代码本身对任何具体 operation 的行为零感知。
- **eager input validation + lazy value read**（精确措辞修正自早期"全量预解析并回写 internalStore"的不准确说法，见 §七差异表 #3）：op 被执行时先对其 outputs 的 Address kind 做一次纯结构校验（只检查是否都是 internal，不读值），随后对每个 input 逐个从 `internalStore.get(addr.name)` 读出实际 Value——注意这一步只是把值读进一个普通的 JS 对象字典传参给 `execute()`，**并不会反向写回或改变 internalStore 本身的内容**。换句话说，所谓"eager"体现在的是「结构合法性在调用 execute() 之前就被完整判定」这一点上（缺字段/kind 不对会立刻报错，不会等到 op 内部跑到一半才发现少读了个参数），而不是字面意义上"先把所有输入物化成 slot 里的实体再启动 op"。outputs 的值写入则是发生在 `execute()` 成功返回之后、逐条按 entry.outputs 声明写回对应 internalStore key。（实现位置：`src/l1/primitives/execute-op.ts resolveInputs()/validateOutputs()`；此设计动机完整论证见 [../09-l1-implementation.md](../09-l1-implementation.md)，其部分章节标注为历史版本但这一条原则至今未变。）
- L2 op 有两条独立的失败上报通道：(a) 把结构化 `OperationError` 作为 outputs 的 `error` 字段正常返回（业务级已知错误，交由 DAG 条件分支决定如何处置）；(b) 直接 throw（任意异常，走 §三.3 之外的另一套冒泡机制）。两者并存且都需要在体验层面正确处理，这是理解「为什么不能只看 `$r_err` 是否为 null」的关键分叉点之一——具体的判定优先级与处置权归属等待 04 文档统一整理，当前以 [../10-reactive-execution-model.md §五](../10-reactive-execution-model.md) + `src/l2/errors.ts` 源码为准。

## 五、与 L3 的关系：一次性拿到整层 children

`execute_intent` entry 被 L1 主循环首次 pop 到时，会**同步调用一次**对应 ExperienceService/registry 的 compile 流程，得到该意图**一整层**（不是逐步懒求值）展开后的所有 children stack entries，然后逆序压回共享栈，自身转入 `awaiting_children` phase 挂在栈中不动，直到它名下登记的全部 children 都执行完成才轮到它自己进入 done/aborted 收尾。也就是说：**L3 是"批量预编译一层再交还给 L1 继续驱动"的模式，而不是 L1 每走一步都要回头问一次 L3**。这个设计让控制流的复杂度集中在编译器侧（DAG→线性+skip 序列的翻译），而调度器侧只需要维护一张扁平栈和一个 phase 字段就能表达任意深度的嵌套 CALL/RET 结构。

「两者互不感知对方的内部细节」这句话需要加一个例外才能精确成立：registerOutput 引用、prefilledInputKeys（跳过已被 binding move 提前填充过的输入 sidecar）等 CRR P2/P3 机制确实纯属于编译器侧问题——它们体现为「children 里多出来的一条普通 move entry / 某条 execute_op entry 少了某个 input key」而已，L1 dispatch 逻辑本身从不读取这些字段做分支判断。**但 frame scopeId 是一个真正的例外**：它在 L1 自己的状态机里有真实的读写与条件分支点（enterScope/exitScope/scopeId===undefined 判定，见 §三.1/§三.2 及 R-1🔴对称性约束），不能简单归入"对 L1 完全透明"这一侧。（完整推导见 [../19b-register-design.md §四](../19b-register-design.md)、[../19c-implementation-plan.md T-3.x](../19c-implementation-plan.md)。）

## 六、指令风格特征（RISC 类比的落点）

把 CPU ISA 类比落到这份具体的 primitive 集合上，可以提炼出四条贯穿始终的风格约束：

1. **小而正交** —— 5 个 primitive 各自只负责一类不可再拆的基本动作（搬运一个值 / 调用一次具名函数 / 触发一次编译压栈 / 无条件跳 / 条件跳），任意复杂控制流都可以用这五条组合表达而不需要新增第六种词汇；「循环」「if/else」都不是独立指令种类，而是它们的特定排列方式。
2. **move 是纯值传递，不含算术或类型转换** —— 想要"计算出一个新值"必须显式调用一条 `execute_op`（哪怕只是 evaluate_expr 这种看起来像内置的 op 也一样走这条通道），而不是让 move 偷偷顺带做点别的。这让每条指令的行为面保持可预期、可静态分析。
3. **形参位置固定而非自由命名空间** —— CRR new path 下跨指令复用靠的是 compiler 生成的固定 slot 地址（`$S<scope>.in<k>`/`.out<k>`，slotIndex 由 formalSpec 声明决定），而不是每次分配新的匿名寄存器号——这是"CPU 对齐"这一设计动机在落地层面最直接的体现（详见 [../19b-register-design.md R5.1/R5.2](../19b-register-design.md)）。legacy path（feature flag 关闭时）仍是旧的自增匿名编号风格，两条路径当前并存于同一份代码里，切换机制与删除计划等待 03 文档记录。
4. **错误不是第三种控制流分支类型，而是数据 + 一张处置权标志** —— L2 op 失败有两条独立通道：(a) 把结构化 `OperationError` 作为 outputs 里 error 字段的正常返回值写回 internalStore（op 本身没有 throw），以及 (b) 直接 throw。当前实现中这两条通道的边界值最终都会汇聚到同一个寄存器名（新路径读 `$err`、legacy 路径仍读 `$r_err`，二者目前处于双写过渡期而非已完成替换，详见 [../19c-implementation-plan.md P4 清理项](../19c-implementation-plan.md)）。「谁来接住它」由每个 intentEntry 自己携带的 `handleError: boolean` 编译期字段决定，L1 主循环只按这张表机械执行查找/截获/继续向上冒泡，不需要理解业务上这个错误意味着什么。（完整模型见规划中的 04-error-handling.md，过渡参考 [../10-reactive-execution-model.md §三.8–§三.9](../10-reactive-execution-model.md）。

---

---

## 七、与旧设计稿对账时发现并澄清的差异（本次梳理新增）

写这篇总览时逐项对照了当前代码与较早的设计稿/既有文档描述，发现以下具体不一致点。此处记录是为了明确「以哪个为准」以及是否需要后续回补修改其他位置，避免同一个漂移事实被多篇文档各自独立地再次误抄一遍。

| # | 差异点 | 现状（以 `src/l1` 实际代码为准） | 受影响的历史描述 |
|---|---|---|---|
| 1 | **硬错误冒泡函数的名字** | L1 main loop catch 分支里真正执行"写入 $err/$r_err → 找最近 handleError 帧 → 截获或继续上抛"这套逻辑的函数叫 **`bubbleError`**（`src/l1/main-loop.ts`），不存在名为 `propagateHardError` 的可执行符号 | `execute-op.ts` / `address-resolver.ts` 的多处 JSDoc 注释仍写作 "由 propagateHardError 处理"——纯历史命名残留，指的就是今天这个 `bubbleError`，但没有任何一份正式文档把这个对应关系写明过，只能靠读源码猜出来；本文档起统一按 `bubbleError` 称呼 |
| 2 | **error 寄存器名处于双写过渡期而非已替换完成态** | `$err` 与 legacy `$r_err` 目前每次都会同时写入同一份 error value（见 `main-loop.ts bubbleError` Step 1 的双写实现 + 其注释明确标注 "P4 末统一以 $err 为准"），并非新路径已经完全取代旧名的终局状态 | [../06-execution-layer.md](../06-execution-layer.md) 等较早章节通篇只提 `$r_err`，未反映当前实际已经存在的第二个名字及它何时会被删除的时间表；[§六.4](#六指令风格特征risc-类比的落点) 的措辞据此做了相应修正（从"已取代"改为"双写过渡期"）|
| 3 | **execute_op 对 inputs 的处理被早期描述成"全部解析后回写 internalStore"** | 实际代码（`src/l1/primitives/execute-op.ts resolveInputs()`）只是把各 input 的值读进一个普通 JS 对象字典作为函数实参传出去，并不会反向改变 internalStore 本身的内容；outputs 的回写发生在 execute() 成功返回之后另一步骤里，两者不是同一个动作的两面 | [../10-reactive-execution-model.md §三.3](../10-reactive-execution-model.md) 用词接近但不够精确的地方据此在本文档 [§四](#四与-l2-的关系自描述-operation-契约) 中直接改写了措辞，不再依赖读者自行脑补省略掉的中间环节 |

> 后续若在继续阅读中发现新的同类漂移，请直接在表格中追加一行，而不是另开一篇零散记录再丢回这里。

---

## 附：本文档刻意保持的克制原则

这是一篇**导读型总览**而非逐行规范——凡是已经在源码注释、更早的设计稿、或者即将拆出去的其他 l1-design sibling 文档里有更完整表述的地方，本文只用一句话概括 + 指针代替复述全文，目的是让这份权威源本身不会随时间推移再次分裂成需要同步维护的第二份重复描述（这正是建立本文件夹要解决的结构性问题本身）。
