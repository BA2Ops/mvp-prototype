# Test #28: 不动 publicStore

> **Source**: `` → describe('')

## 目的

conditional_skip 不应触碰业务存储区。

## 主图

![main](./main.puml)

## 数据准备

```ts
publicStore.set('business_data','preserve')
$r_cond=true
stack: [cond]
```

## 预期结果与验证

```ts
expect(publicStore.get('business_data')).toBe('preserve')
```

## 设计决策说明

基线 check——conditional_skip 只动栈与指定 internal reg。

