# Test #21: n=-100 抛 ConditionalSkipError

> **Source**: `` → describe('')

## 目的

深值样本防止判定只精确记住了某个特定哨兵值等值比较。

## 主图

![main](./main.puml)

## 数据准备

```ts
entry.n=-100
```

## 预期结果与验证

```ts
expect(...).rejects.toThrow(ConditionalSkipError)
```

## 设计决策说明

对称性检查——最小与深值都应被拦下。

