# `conditional_skip` — 条件跳转

## 指令结构定义

```typescript
interface ConditionalSkip extends BaseEntry {
  kind: 'conditional_skip'
  conditionAddr: Address   // 必须指向 internal（运行时强校验）
  n: number                // 同 skip_n：truthy 时额外跳过后续多少条 entry
}
```

## 用途

读一个内部寄存器的值做 truthy/falsy 判断，决定要不要像 skip_n 那样再额外弹掉后面的 n 条 entry——falsy 就只移除自己本身。是 DAG if-then-else 分支语义里真正"做选择"的那一半（skip_n 负责的是无论怎么选都要兜底跳过的另一半收尾动作，二者通常成对出现，见 [../01-architecture-overview.md §三](../01-architecture-overview.md)）。

## 预期执行效果

(1) 校验 `conditionAddr.kind === 'internal'`，否则抛 ConditionalSkipError；(2) 校验 `n >= 0`，同上规则；(3) 从 internalStore **读取** conditionAddr.name 对应的值——注意这一步查不到 key 时**不抛错**而是当作 undefined 参与后续 truthy 计算（因为未初始化的条件值在设计上等价于"条件尚未满足"这种业务含义，直接报错会让整个 DAG 在早期顺序执行还没铺满所有前置写入点的时候就崩溃）；(4) isTruthy(value) 判定（完整真值表见下方）；(5) truthy → 走一段与 skip_n 完全相同的弹窗循环逻辑（self + 最多 n 个后续 entry，遇到已进入执行中/已结束状态的 IntentEntry 帧同样提前收敛），falsy → 仅弹掉 self。

### Truthy 判定规则（isTruthy 的完整分支表，穷尽所有 Value 类型）

| 值 | 结果 |
|---|---|
| null / undefined | false |
| boolean | 本身 |
| number | !== 0 |
| string | length > 0 |
| array | length > 0 |
| object（非数组） | Object.keys(...).length > 0 |
| 其他兜底 | Boolean(value) |

## 可穷举的格式维度与示例

shape 比 skip_n 多一个 `conditionAddr` 字段但它的 kind 取值集合是封闭的四选一，n 的规则与 skip_n 完全一致：

```typescript
// conditionAddr 只能是 internal —— 这是唯一合法的 Address kind，其余三种写成条件源都会在第 (1) 步被直接拦下抛错
{
  kind: 'conditional_skip',
  conditionAddr: { kind: 'internal', name: '$Ss0.out5' },   // 例如某个 op 刚写出来的判断结果 slot
  n: 3                                                      // truthy 时连同自己一共弹出接下来 4 条 entry；falsy 只弹自己这一条
}
```

典型的成对出现骨架同 [skip-n.md](./skip-n.md) 末尾展示的 if-then-else 编译产物——本指令负责"选哪一路进入"的判断动作本身，紧随其后的 skip_n 负责"另一路无论前面怎么选都别再执行一遍"的收尾清理。

## 边界行为速查

- conditionAddr.kind !== 'internal' → ConditionalSkipError（第 1 步）。
- n < 0 → ConditionalSkipError（第 2 步），规则与 skip_n 完全平行。
- **conditionAddr.name 在 internalStore 里查不到 key → 不报错**，按 undefined 参与 isTruthy 计算得到 false，等价于走 falsy 分支只弹掉自己——这是刻意设计而非遗漏，对应"DAG 还没走到写入这个条件的上游步骤、就先碰到了消费它的判断点"这种理论上不该发生但一旦发生的优雅降级路径。
- 弹窗循环阶段遇到 phase !== 'pending' 的 IntentEntry 帧会提前收敛的规则，与 [skip-n.md](./skip-n.md) 描述的行为逐字一致，此处不再重复展开推导过程。
