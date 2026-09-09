# Test #1: 调用 L3.compile，children 压入帧之上（帧保留）

> **Source**: `` → describe('')

## 目的

验证 executeIntent 把 L3.compile 返回的 children 逆序压栈到 entry 之上，entry 自身保留在栈底。

## 主图

![main](./main.puml)

## 数据准备

```ts
createMockL3([c1, c2]) 两个 skip_n
entry 推入栈底
```

## 预期结果与验证

```ts
stack.length === 3
[entry.id, 'c2', 'c1']
依次 pop 得 c1 → c2 → entry
```

## 设计决策说明

帧保留——entry 不被弹出，children 逆序压栈。

