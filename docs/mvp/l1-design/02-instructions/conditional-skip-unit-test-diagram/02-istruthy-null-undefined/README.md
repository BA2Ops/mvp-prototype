# Test #2: null/undefined → false

> **Source**: `` → describe('')

## 目的

两个最经典 falsy 代表各自归类。

## 主图

![main](./main.puml)

## 数据准备

```ts
isTruthy(null)
isTruthy(undefined)
```

## 预期结果与验证

```ts
expect(isTruthy(null)).toBe(false)
expect(isTruthy(undefined)).toBe(false)
```

## 设计决策说明

isTruthy helper 是本 primitive 的判定基石——单独抽出验证。

