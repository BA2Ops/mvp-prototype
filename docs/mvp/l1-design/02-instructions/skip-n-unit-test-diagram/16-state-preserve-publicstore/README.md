# Test #16: 不动 publicStore

> **Source**: `` → describe('')

## 目的

skip_n 不应触碰业务存储区。

## 主图

![main](./main.puml)

## 数据准备

```ts
publicStore.set('business_data', 'preserve me')
stack: [skip]
```

## 预期结果与验证

```ts
expect(publicStore.get('business_data')).toBe('preserve me')
expect(publicStore.has('business_data')).toBe(true)
```

## 设计决策说明

基线 check——skip_n 只动栈不动 store。

