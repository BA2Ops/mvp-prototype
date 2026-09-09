# Test #22: 不动 publicStore

> **Source**: `` → describe('')

## 目的

execute_op 不应触碰业务存储区。

## 主图

![main](./main.puml)

## 数据准备

```ts
publicStore.set('business_data','preserve')
$r0=5
entry=mock_op
```

## 预期结果与验证

```ts
publicStore.get('business_data') === 'preserve'
```

## 设计决策说明

基线 check——execute_op 只动 internalStore 与 entry.status。

