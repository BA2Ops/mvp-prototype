# Test #5: string: 空串 → false, 非空 → true

> **Source**: `` → describe('')

## 目的

字符串家族唯一 falsy 是 length===0。

## 主图

![main](./main.puml)

## 数据准备

```ts
isTruthy(''), isTruthy('hello'), isTruthy(' ')
```

## 预期结果与验证

```ts
expect(isTruthy('')).toBe(false)
expect(isTruthy('hello')).toBe(true)
expect(isTruthy(' ')).toBe(true)
```

## 设计决策说明

空格视为非空——与经典 JS 语义一致。

