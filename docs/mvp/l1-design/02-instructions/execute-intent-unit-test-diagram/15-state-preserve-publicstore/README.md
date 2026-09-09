# Test #15: 不动 publicStore

> **Source**: `` → describe('')

## 目的

executeIntent 不应触碰业务存储区。

## 主图

![main](./main.puml)

## 数据准备

```ts
createMockL3([])
publicStore.set('business_data','preserve')
entry 推栈
```

## 预期结果与验证

```ts
publicStore.get('business_data') === 'preserve'
```

## 设计决策说明

基线 check——executeIntent 只动栈与 entry.phase。

