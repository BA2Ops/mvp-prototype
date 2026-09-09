# Test #3: 空 children：帧保留，无子指令

> **Source**: `` → describe('')

## 目的

L3 返回 [] 时不抛错、不清栈，entry 直接进入 awaiting_children。

## 主图

![main](./main.puml)

## 数据准备

```ts
createMockL3([])
entry={type:'empty'}
```

## 预期结果与验证

```ts
stack.length === 1 仅剩 entry
entry.phase === 'awaiting_children'
```

## 设计决策说明

空 children 是合法输入——frame 保留等主循环收尾。

