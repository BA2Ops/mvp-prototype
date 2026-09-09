# Test #19: intent 字段：type + params

> **Source**: `` → describe('')

## 目的

intent 复合字段（type + params）正确落地，嵌套 params 也保留。

## 主图

![main](./main.puml)

## 数据准备

```ts
createIntentEntry({type:'complex_intent', params:{x:1, y:'hello', z:{nested:true}}})
```

## 预期结果与验证

```ts
intent.type === 'complex_intent'
params.x === 1
params.y === 'hello'
```

## 设计决策说明

复合字段透传——嵌套 params 不丢。

