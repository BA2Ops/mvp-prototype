# `skip_n` — 无条件跳转

## 指令结构定义

```typescript
interface SkipN extends BaseEntry {
  kind: 'skip_n'
  n: number   // 跳过后续 entry 数（含 self，总弹出 n+1 个）
}
```

5 个 primitive 里最"没有状态感知"的一条——它不读任何寄存器、不调用任何外部函数、不看 phase，纯粹是一个数字决定要弹掉多少条栈上的东西。

## 用途

无条件地让执行流越过接下来的 n 条 entry（加上自己一共 n+1 条）。DAG if-then-else 编译出来时专门用来做"无论条件分支哪一路已经走过、都要保证另一路被跳过去不重复执行"的收尾兜底动作（通常紧跟着一条 conditional_skip 使用成对出现）。

## 预期执行效果

(1) 校验 `n >= 0`，否则抛 SkipNError；(2) 从当前栈顶开始最多弹 n+1 次：每弹一次前先检查**将要弹出的那条**是不是一个已进入执行中状态的 IntentEntry 帧（phase !== 'pending'），如果是就停止弹出不再继续（保护调用帧边界不被越界撕裂，详见 [../01-architecture-overview.md §三.1](../01-architecture-overview.md) 的帧保留机制）；(3) self 本身也是这 n+1 次弹窗操作序列的一部分（不需要额外单独处理"要不要弹自己"这种问题，因为它就是循环里的第 0 步自然覆盖到的对象之一——注意这个说法指的是它排在待弹队列的最顶端位置，而不是说 skip_n 会去遍历自己内部再找什么东西来跳过）。

整个过程中如果栈提前弹空了也属于正常情况（graceful），不算错误。

## 可穷举的格式维度与示例

唯一的开放性字段是数字 `n` 本身，其合法取值范围是一个连续区间 `[0, +∞)`（受限于运行时实际剩余栈深度上限，但那属于运行期约束而非编译期语法限制）。没有其他 kind/结构变体可以列举，因为 shape 只有一个自由度（这个数字本身）：

```typescript
// n=0：只弹掉自己，等价于什么也没跳、纯粹一条空操作式的自我移除（实践中极少有意义地单用，更多出现在编译器生成代码里作为占位对齐用途）
{ kind: 'skip_n', n: 0 }

// n=2：连同自己在内一共弹出栈顶接下来的 3 条 entry（自己 + 后续两条）
{ kind: 'skip_n', n: 2 }

// 典型配对用法（if cond then A else B 的编译产物骨架，具体每个块的长度由 DAG 内容决定此处以占位数示意）：
[
  { kind: 'conditional_skip', conditionAddr: {...}, n: <elseBlockLength> },   // 条件满足 → 跳过 else 块落到 skip_n 之后
  ...elseBlockEntries,
  { kind: 'skip_n', n: <thenBlockLength> },                                   // 条件不满足走完 else 后 → 无条件跳过后面的 then 块，防止两路都被执行
  ...thenBlockEntries
]
```

## 边界行为速查

- `n < 0` → SkipNError，self **留在栈上不弹**（这是唯一会抛错的情况）。
- 弹窗过程中遇到"已进入执行中/已结束状态的 IntentEntry 帧"（phase='awaiting_children' 或 'aborted'）→ 立即停止继续往下弹，剩余没数到的 n-i+1 个名额就作废了不会补别的东西凑数——这是一种静默的提前收敛，不算错误也不打 warning。
- phase='pending' 的帧（还没开始展开的子调用）**允许被正常弹掉**，这个特例是循环模式（doc 10 §六.5 自嵌套终止场景）刻意保留的能力：需要在某一次迭代末尾精确地跳过"自己再递归调自己这一次"而不触发它的 compile 逻辑，如果 pending 帧也被当作不可跨越的边界来保护，那种细粒度的控制流就没法用 skip_n 单独表达了。
