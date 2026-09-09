# Test #14: 场景 2：跳过 then-block（条件为真也走此路径）

> **Source**: `` → describe('')

## 目的

条件为真路径：cond_skip 已跳走 else_block+skip_n——直接到 then_block，skip_n 不会被执行。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [thenBlock] (skip_n 不入栈)
```

## 预期结果与验证

```ts
expect(stack.length).toBe(1)
expect(stack[0].id).toBe('then-block')
```

## 设计决策说明

验证前置状态：skip_n 在该路径下确实未被调度。

