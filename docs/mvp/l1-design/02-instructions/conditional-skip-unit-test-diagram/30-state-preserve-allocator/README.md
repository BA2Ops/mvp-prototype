# Test #30: 不动 allocator

> **Source**: `` → describe('')

## 目的

conditional_skip 期间不分配任何 argtmp 槽位。

## 主图

![main](./main.puml)

## 数据准备

```ts
allocator.allocate() × 2
before = maxAllocated()
stack: [cond]
```

## 预期结果与验证

```ts
expect(allocator.maxAllocated()).toBe(before)
```

## 设计决策说明

conditional_skip 是栈+条件读取——不应涉及 argtmp 分配。

