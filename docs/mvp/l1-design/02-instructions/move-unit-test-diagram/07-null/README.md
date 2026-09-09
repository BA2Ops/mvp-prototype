# Test #7: null

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('各种 Value 类型') → test('null')

## 目的

null 与 `undefined` / "键不存在于 Map" 不能混淆。验证 move 完 null 之后，目标确实存的是 null 本身，而不是"什么都没发生所以读出来是 undefined"的假象。

## 主图

![main](./main.puml)

## 数据准备

```ts
state.stack.push({
  kind: 'move',
  from: { kind: 'literal', value: null },
  to:   { kind: 'internal', name: '$r0' }
})
```

## 预期结果与验证

```ts
expect(state.internalStore.get('$r0')).toBeNull()  // 不是 toBeUndefined()
```

## 设计决策说明

刻意选用 `toBeNull()`（toBeUndefined 的反向），确认 Map 中**显式存在** `null` 这个 entry——而非因为"从未写入"返回 undefined。如果实现错误地把 null 当成"不写入"处理（短路 return），这条会挂掉但 #6 / #8 不会暴露问题。
