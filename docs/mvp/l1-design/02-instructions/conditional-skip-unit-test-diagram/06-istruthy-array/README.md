# Test #6: array: 空数组 → false, 非空 → true

> **Source**: `` → describe('')

## 目的

结构类型家族第一例：长度可数的容器。

## 主图

![main](./main.puml)

## 数据准备

```ts
isTruthy([]), isTruthy([1,2,3]), isTruthy([null])
```

## 预期结果与验证

```ts
expect(isTruthy([])).toBe(false)
expect(isTruthy([1,2,3])).toBe(true)
expect(isTruthy([null])).toBe(true)
```

## 设计决策说明

含 null 元素的数组非空——判定的不是 elements 而是有无 element。

