# Test #17: 不动 allocator

> **Source**: `` → describe('')

## 目的

executeIntent 期间不分配任何 argtmp 槽位。

## 主图

![main](./main.puml)

## 数据准备

```ts
createMockL3([])
allocator.allocate() × 2
before = maxAllocated()
```

## 预期结果与验证

```ts
executeIntent 后 maxAllocated() === before
```

## 设计决策说明

executeIntent 不涉及 argtmp——槽位全由 compiler 层预留。

