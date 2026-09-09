# Test #15: $r_err = OperationError（失败）→ truthy

> **Source**: `` → describe('')

## 目的

op 报错后写入的结构化对象稳定落 truthy，驱动 conditional_skip 进入跳过分支。

## 主图

![main](./main.puml)

## 数据准备

```ts
internalStore.set('$r_err', {code,message,op,timestamp})
stack: [thenBlock, cond(n=1)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(0)
```

## 设计决策说明

拦的是'错误对象被误判成 success'的方向反转型退化。

