# Test #1: 调用 mock_op：x → x*2

> **Source**: `` → describe('')

## 目的

最基础的端到端：读 inputs → 调 handler → 写 outputs → 标 done → 弹栈。

## 主图

![main](./main.puml)

## 数据准备

```ts
internalStore.set('$r0', 5)
entry=mock_op(inputs:{x:$r0}, outputs:{result:$r1})
```

## 预期结果与验证

```ts
$r1 === 10
tracker.getCallCount() === 1
calls[0].inputs.x === 5
entry.status === 'done'
stack.length === 0
```

## 设计决策说明

execute_op 最常见的 happy path——五件事一气呵成。

