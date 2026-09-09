# Test #22: skip_n 之间有其他 entry

> **Source**: `` → describe('')

## 目的

skip_n 与非 skip entry 交替穿插——验证只弹 self 不污染中间条目。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [skip1, m, skip2] → 执行 skip2 → pop m → 执行 skip1
```

## 预期结果与验证

```ts
skip2 后 stack.length===2；pop m 后===1；skip1 后===0
```

## 设计决策说明

穿插场景——保证 self-pop 不会越过应当保留的 entry。

