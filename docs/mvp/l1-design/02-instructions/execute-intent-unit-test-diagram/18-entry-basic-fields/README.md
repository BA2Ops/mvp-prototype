# Test #18: id / parentIntentId / createdAt

> **Source**: `` → describe('')

## 目的

三个基础标识字段在 createIntentEntry 时各自正确填充。

## 主图

![main](./main.puml)

## 数据准备

```ts
createIntentEntry({type:'test',params:{}})
```

## 预期结果与验证

```ts
entry.id 已定义
entry.parentIntentId === null
entry.createdAt > > > 0
```

## 设计决策说明

基础字段完整性。

