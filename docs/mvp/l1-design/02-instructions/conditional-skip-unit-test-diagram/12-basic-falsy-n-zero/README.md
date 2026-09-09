# Test #12: falsy + n=0：仅弹出 self

> **Source**: `` → describe('')

## 目的

未命中且跨度为零——与 #10 形成对称性检查点。

## 主图

![main](./main.puml)

## 数据准备

```ts
$r_cond = false
stack: [m1, m2, cond(n=0)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(2)
expect(stack[0].id).toBe('m1')
expect(stack[1].id).toBe('m2')
```

## 设计决策说明

拦的是'实现上把 falsy+n=0 和 truthy+n=0 走成两段独立路径'的隐性差异。

