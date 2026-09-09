# Test #11: n=-100 抛 SkipNError

> **Source**: `` → describe('')

## 目的

深值样本：防止判定只记住某个特定哨兵值等值比较。

## 主图

![main](./main.puml)

## 数据准备

```ts
entry: skip_n(n=-100)
```

## 预期结果与验证

```ts
expect(executeSkipN(skip, state)).rejects.toThrow(SkipNError)
```

## 设计决策说明

对称性检查——深值与最小值都应被拦下。

