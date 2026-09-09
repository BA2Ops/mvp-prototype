# Test #3: boolean → 本人

> **Source**: `` → describe('')

## 目的

true/false 原样透传不经过任何额外换算。

## 主图

![main](./main.puml)

## 数据准备

```ts
isTruthy(true)
isTruthy(false)
```

## 预期结果与验证

```ts
expect(isTruthy(true)).toBe(true)
expect(isTruthy(false)).toBe(false)
```

## 设计决策说明

防止实现误以为要做一层短路优化而改变后续统一入口的语义。

