# Test #1: 条件为真且 n 足够大 → 停在帧前

> **Source**: `` → describe('')

## 目的

truthy 分支深层弹出同样受 execute_intent 帧标记拦截——不被跨越出当前帧。

## 主图

![main](./main.puml)

## 数据准备

```ts
$r_flag = true
stack: [frame(IE), m1, self]
entry: conditional_skip($r_flag, n=5)
```

## 预期结果与验证

```ts
expect(stack.map(e=>e.id)).toEqual(['frame'])
```

## 设计决策说明

conditional_skip 与 skip_n 同享帧边界保护——本用例确认 truthy 分支不绕过。

