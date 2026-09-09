# Test #4: number: 0 → false, 非零 → true

> **Source**: `` → describe('')

## 目的

JS 数字里 0 是唯一特殊值——正数/负数等非零值都应当 truthy。

## 主图

![main](./main.puml)

## 数据准备

```ts
isTruthy(0), isTruthy(-0), isTruthy(1), isTruthy(-1), isTruthy(42)
```

## 预期结果与验证

```ts
expect(isTruthy(0)).toBe(false)
expect(isTruthy(-0)).toBe(false)
expect(isTruthy(1)).toBe(true)
expect(isTruthy(-1)).toBe(true)
expect(isTruthy(42)).toBe(true)
```

## 设计决策说明

覆盖符号位场景——防止实现意外把符号当作有效判定依据。

