# Test #8: error-as-data 场景：OperationError 对象 → truthy

> **Source**: `` → describe('')

## 目的

用形似 $r_err 实际写入的结构化对象作为条件源——确认这条锚点落在 truthy 一侧。

## 主图

![main](./main.puml)

## 数据准备

```ts
isTruthy({code:'ENOENT', message:'not found', op:'file_read'})
```

## 预期结果与验证

```ts
expect(isTruthy(err)).toBe(true)
```

## 设计决策说明

非空对象一律 truthy——与生产 $r_err 写入结构一致。

