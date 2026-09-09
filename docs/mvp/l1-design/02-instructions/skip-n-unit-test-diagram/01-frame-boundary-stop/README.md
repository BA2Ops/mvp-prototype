# Test #1: 弹出时遇到帧 → 停止（不跨帧）

> **Source**: `` → describe('')

## 目的

truthy 分支深层弹出同样受 execute_intent 帧标记拦截——不被跨越出当前帧。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [frame(IE), m1, m2, self]
entry: skip_n(n=3)
```

## 预期结果与验证

```ts
expect(stack.map(e=>e.id)).toEqual(['frame'])
```

## 设计决策说明

verify 停驻位置由帧标记决定而非由 n 决定。

