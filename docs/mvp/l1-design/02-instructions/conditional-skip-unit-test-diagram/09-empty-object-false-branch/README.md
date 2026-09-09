# Test #9: conditional_skip 用空对象作为条件值（false 分支）

> **Source**: `` → describe('')

## 目的

端到端验证：isTruthy({})===false 走'仅弹 self'分支。

## 主图

![main](./main.puml)

## 数据准备

```ts
$r_cond = {}
stack: [thenBlock, cond(n=0)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(1)
expect(stack[0].id).toBe('thenBlock')
```

## 设计决策说明

从 #7 单独的 isTruthy 验证延伸到端到端 primitive 行为验证。

