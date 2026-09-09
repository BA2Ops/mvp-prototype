# Test #6: 数字

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('各种 Value 类型') → test('数字')

## 目的

最小非字符串基础类型的往返正确性。验证 move 对数字类型不引入额外转换（如 toString 序列化、BigInt 包装等）。

## 主图

![main](./main.puml)

## 数据准备

```ts
state.stack.push({
  kind: 'move',
  from: { kind: 'literal', value: 42 },
  to:   { kind: 'internal', name: '$r0' }
})
```

## 预期结果与验证

```ts
expect(state.internalStore.get('$r0')).toBe(42)
```

## 设计决策说明

`toBe(42)` 是严格全等——不允许 `toEqual(42)`（toEqual 对数字退化为 toBe，但显式 toBe 表达意图更清晰）。如果某次实现错误地走 JSON 序列化路径把 number 转成字符串，这条会立刻挂掉。
