# Test #22: 内部寄存器不存在视为 falsy（不抛错）

> **Source**: `` → describe('')

## 目的

享受比通用 resolver 更宽容的缺省语义：未写入的 internal register 视为 falsy。

## 主图

![main](./main.puml)

## 数据准备

```ts
故意不 set $r_uninit
stack: [m, cond(n=0)]
```

## 预期结果与验证

```ts
expect(...).resolves.not.toThrow()
expect(stack.length).toBe(1)
```

## 设计决策说明

拦的是'偷懒复用 resolver 严格语义'导致本该宽限的边缘情形被误伤。

