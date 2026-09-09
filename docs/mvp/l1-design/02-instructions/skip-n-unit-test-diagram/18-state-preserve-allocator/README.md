# Test #18: 不动 allocator

> **Source**: `` → describe('')

## 目的

skip_n 期间不分配任何 argtmp 槽位。

## 主图

![main](./main.puml)

## 数据准备

```ts
allocator.allocate() × 2
before = maxAllocated()
stack: [skip]
```

## 预期结果与验证

```ts
expect(allocator.maxAllocated()).toBe(before)
```

## 设计决策说明

skip_n 是纯栈操作，不应涉及 argtmp 分配。

