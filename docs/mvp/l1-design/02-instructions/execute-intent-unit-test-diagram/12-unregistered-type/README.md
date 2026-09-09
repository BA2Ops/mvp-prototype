# Test #12: 未注册的 type 路由返回空 children

> **Source**: `` → describe('')

## 目的

未注册 type 不抛错，等同于空编译产物，帧保留。

## 主图

![main](./main.puml)

## 数据准备

```ts
createProgrammableL3()
entry={type:'unregistered'}
```

## 预期结果与验证

```ts
entry.phase === 'awaiting_children'
stack.length === 1
```

## 设计决策说明

未注册 type 的 graceful 处理——不是 throw 而是空。

