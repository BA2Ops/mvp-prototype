# Test #23: 不动 allocator

> **Source**: `` → describe('')

## 目的

execute_op 期间不分配任何 argtmp 槽位。

## 主图

![main](./main.puml)

## 数据准备

```ts
allocator.allocate() × 2
before = maxAllocated()
entry=mock_op
```

## 预期结果与验证

```ts
maxAllocated() === before
```

## 设计决策说明

execute_op 不涉及 argtmp 分配——槽位全由 compiler 层预留。

