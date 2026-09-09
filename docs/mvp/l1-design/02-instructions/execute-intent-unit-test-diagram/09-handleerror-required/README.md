# Test #9: handleError 是必填字段

> **Source**: `` → describe('')

## 目的

createIntentEntry 第二参 handleError 必须显式传入（true/false 二选一），构造时即落库。

## 主图

![main](./main.puml)

## 数据准备

```ts
createIntentEntry({type:'t',params:{}}, true)
createIntentEntry({type:'t2',params:{}}, false)
```

## 预期结果与验证

```ts
entry.handleError === true
entry2.handleError === false
```

## 设计决策说明

handleError 必填——L3 必须为每个 child intent 显式决策。

