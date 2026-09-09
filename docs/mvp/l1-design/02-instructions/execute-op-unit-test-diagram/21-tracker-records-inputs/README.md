# Test #21: tracker 记录每个调用的 inputs

> **Source**: `` → describe('')

## 目的

tracker 应按调用顺序记录每次的 inputs 实际值（非引用）。

## 主图

![main](./main.puml)

## 数据准备

```ts
三次 entry 分别 inputs.x=10/20/30
```

## 预期结果与验证

```ts
calls.length === 3
calls[0..2].inputs.x === 10/20/30
```

## 设计决策说明

inputs 是值快照而非延迟求值引用。

