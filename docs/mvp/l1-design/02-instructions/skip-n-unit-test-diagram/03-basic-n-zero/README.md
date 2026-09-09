# Test #3: n=0：仅弹出 self（1 个）

> **Source**: `` → describe('')

## 目的

最简弹出：仅 self。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [marker-1, skip(n=0)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(1)
expect(stack[0].id).toBe('marker-1')
```

## 设计决策说明

基础弹栈协议本身的最小锚点。

