# Test #18: 完整流程：literal 5 → move → $r0 → mock_op → $r1

> **Source**: `` → describe('')

## 目的

模拟 move 把 literal 5 搬到 $r0 后 op 读取。

## 主图

![main](./main.puml)

## 数据准备

```ts
预先 internalStore.set('$r0', 5) 模拟 move
entry=mock_op
```

## 预期结果与验证

```ts
$r1 === 10
```

## 设计决策说明

跨 primitive 最小集成——move 提供数据、op 消费数据。

