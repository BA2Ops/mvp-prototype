# Test #4: n=1：弹出 self + 1 个后续（2 个）

> **Source**: `` → describe('')

## 目的

跨条目弹出一条。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [m2, m1, skip(n=1)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(1)
expect(stack[0].id).toBe('m2')
```

## 设计决策说明

m1 确实被吃，不是仅打标记。

