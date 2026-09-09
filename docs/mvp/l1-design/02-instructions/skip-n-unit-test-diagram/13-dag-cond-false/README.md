# Test #13: 场景 1：跳过 then-block（条件为假）

> **Source**: `` → describe('')

## 目的

条件为假路径：cond_skip 不跳，执行 else_block，然后 skip_n 跳过 then_block。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [thenBlock, skip(n=1)]
（前置 cond_skip / else_block 已处理）
```

## 预期结果与验证

```ts
expect(stack.length).toBe(0)
```

## 设计决策说明

测试 skip_n 在真实 DAG 场景中的'跳过 else 之后立即跳 then'角色。

