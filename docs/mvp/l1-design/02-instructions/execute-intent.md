# `execute_intent` — 触发一次 L3 compile，压入一整层 children

## 指令结构定义

```typescript
interface IntentEntry extends BaseEntry {
  kind: 'execute_intent'
  intent: RecognizedIntent               // { type, params } —— L4/L3 识别后的意图规约
  phase: 'pending' | 'awaiting_children' | 'done' | 'aborted'
  children: StackEntry[]                // compile 之后填充，L1 自己从不往里读写单条元素
  handleError: boolean                  // 编译期由 L3 设置：本帧是否截异常（详见 ../04-error-handling.md）
  scopeId?: string                      // CRR new path 下 lazy 分配的 frame scope id；legacy path 保持 undefined
  prefilledInputKeys?: Set<string>      // CRR P3：已被父级 binding move 提前填好的 input key，仅供 compiler 侧感知，L1 dispatch 逻辑本身不读取它做分支判断
}
```

5 个 primitive 里唯一携带自身**多阶段状态机字段**（phase）的一条——其余四条都是"弹完就走、没有中间态"的无记忆指令。

## 用途

这是 L1 与 L3 之间唯一的"函数调用/子程序展开"通道：一条 execute_intent 被首次处理时同步调一次 `state.l3.compile(intent, state, options)` 拿到该意图完整的一层 children，逆序压入同一张栈后转入等待态，直到这批 children 全部执行完才轮到本 entry 自己收尾 pop。它是整套递归/嵌套 CALL-RET 结构的物理载体，也是 R-1🔴对称性约束（enterScope/exitScope/bubbleError-abortFrame 必须配对）真正发挥作用的位置——见 [../01-architecture-overview.md §三.2](../01-architecture-overview.md)。

## 预期执行效果（分 phase）

**pending → awaiting_children**（`executeIntent()` 主体，只在这一段发生，且每个 IntentEntry 生命周期内只会走一次这一段）：
1. phase='awaiting_children'；
2. `children = await state.l3.compile(entry.intent, state, getCompileOptionsForFrame(entry))`；
3. **不 pop self**；把 children **逆序**逐个 push 进共享栈（children[0] 最终最先被执行到，因为栈是 LIFO）。

注意 (2) 这一步可能抛错（compile 内部任何异常），此时本 entry 还停在"刚标过 awaiting_children 但 children 还没填好"的中间状态，靠 bubbleError 冒泡机制兜底处理而非就地 try/catch。

**awaiting_children → done**（后续每次 main loop 轮到这个已是 awaiting 状态的 entry 时都会重新检查一遍这段逻辑，直到某次判定 children 已经全部弹光才真正收尾）：exitScope + depth map 递减 + phase='done' + **pop self**。到达这里的帧必然是正常完成了 children——如果中途被异常打断早就走 abortFrame 单独收尾并标记 aborted、不会留到这里再判断第二次。

## 可穷举的格式维度与示例

phase/scopeId/prefilledInputKeys/children/handleError 各自的合法取值集合都很小且封闭（见上结构定义里列出的枚举值），唯一开放性的部分是 `intent.type`+`params` 的具体内容随业务意图变化，不属于这条指令本身要约束的东西。下面给一个真实编译产物形状的例子（对应 CRR new path 下一次嵌套 CALL，`scopeId: undefined` 是刻意的 lazy-assignment 起点，实际值由 main-loop 在真正进入该 frame 那一刻调用 enterScope() 后回写填充）：

```typescript
{
  kind: 'execute_intent',
  intent: { type: 'exp_b_consumer_xxx', params: {} },   // 具体参数已被父级 binding move 提前处理过,这里可能只剩空对象或纯字面量透传部分
  phase: 'pending',                                     // L1 第一次 pop 到它时才会推进成 awaiting_children
  children: [],                                        // 同上,pending 阶段必然为空数组
  handleError: false,                                  // 取决于 exp_b_consumer_xxx.handleError ?? false
  scopeId: undefined,                                  // ← 关键：compile 阶段不分配,留给运行时帧入口决定
  prefilledInputKeys: new Set(['text'])                // 若该 step 的 inputs.text 用了 registerOutput 引用则会出现这种标记;普通 input/literal 引用则为 undefined(整个字段省略)
}
```

## 边界行为速查

- compile 抛错 → 原样向上交给 main loop catch + bubbleError；此时本 entry **已经**被标记成 awaiting_children（不是 pending），这是有意为之——后续冒泡清理逻辑要据此判断"这一层是否已经进入、是否需要对称地 exitScope/递减 depth"，不能简单回退当作从未开始过的 pending 状态。
- `prefilledInputKeys` / `scopeId` 这两个可选字段**不参与 executeIntent() 自身的任何条件分支判断**——它们分别是给 compiler 侧和 main-loop 顶层 hook 各自消费的元数据，execute_intent 这条指令本身只是被动携带它们而不消费，不要因为看到它们在结构定义里就误以为本 primitive 内部会读它做决策。
