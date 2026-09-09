# Test #4: L3 compile 接收 intent 和 state 参数

> **Source**: `` → describe('')

## 目的

L3 的 compile() 必须拿到正确的 intent（含 params）。

## 主图

![main](./main.puml)

## 数据准备

```ts
createSpyL3([])
entry={type:'my_intent', params:{path:'/tmp/test'}}
```

## 预期结果与验证

```ts
spy.callCount() === 1
lastIntent().type === 'my_intent'
params.path === '/tmp/test'
```

## 设计决策说明

verify L3.compile 被正确调用且参数透传。

