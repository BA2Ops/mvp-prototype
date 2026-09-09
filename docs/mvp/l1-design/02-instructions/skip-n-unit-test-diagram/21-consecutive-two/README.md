# Test #21: 连续两个 skip_n

> **Source**: `` → describe('')

## 目的

两个相邻 skip 各自弹 self 后栈逐次递减。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [skip1, skip2] (均 n=0)
```

## 预期结果与验证

```ts
先 pop skip2 → stack.length===1
再 pop skip1 → stack.length===0
```

## 设计决策说明

多次连续调用——验证 pop 顺序不被破坏。

