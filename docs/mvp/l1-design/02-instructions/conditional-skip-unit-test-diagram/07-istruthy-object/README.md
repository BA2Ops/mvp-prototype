# Test #7: object: 空对象 → false, 非空 → true

> **Source**: `` → describe('')

## 目的

**注意**：判定按'自有 key 数量'而非 JS 引用 truthiness。

## 主图

![main](./main.puml)

## 数据准备

```ts
isTruthy({}), isTruthy({key:'value'}), isTruthy({null:null})
```

## 预期结果与验证

```ts
expect(isTruthy({})).toBe(false)
expect(isTruthy({key:'value'})).toBe(true)
expect(isTruthy({null:null})).toBe(true)
```

## 设计决策说明

实现敏感——朴素'引用是否非空'理解会得到相反结论，立即暴露实现用的是哪种规则。

