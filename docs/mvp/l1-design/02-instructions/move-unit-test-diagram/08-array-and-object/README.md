# Test #8: 数组和对象

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('各种 Value 类型') → test('数组和对象')

## 目的

复合结构（数组、对象）整体搬运不丢字段；顺带覆盖一次 executeMove 调用内连续两次不同 target move 是否互相污染。

## 主图

![main](./main.puml)

## 数据准备

```ts
// 第一次：数组 → $r0
await executeMove(
  move({ kind: 'literal', value: [1, 2, 3] }, { kind: 'internal', name: '$r0' }),
  state
)
// 第二次：对象 → $r1
await executeMove(
  move({ kind: 'literal', value: { a: 1 } }, { kind: 'internal', name: '$r1' }),
  state
)
```

## 预期结果与验证

```ts
expect(state.internalStore.get('$r0')).toEqual([1, 2, 3])  // 深层结构比较
expect(state.internalStore.get('$r1')).toEqual({ a: 1 })
```

## 设计决策说明

- 用 `toEqual` 而非 `toBe`：`[1,2,3]` 是新数组引用，`toBe` 必然失败；`toEqual` 走深层结构比较
- 两次连续调用验证：若实现错误地复用了某个临时 slot（如把第一次写入的内部引用复用到第二次），第二条会暴露污染
