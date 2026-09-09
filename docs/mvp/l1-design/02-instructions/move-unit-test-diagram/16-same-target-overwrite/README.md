# Test #16: 同名寄存器覆盖

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('多次执行场景') → test('同名寄存器覆盖')

## 目的

与 #15 镜像：**同一目标名**被两次先后写入不同源值时，最终只保留最后一次的值——不允许两份数据互相污染或旧值残留。专门防止有人误以为 move 天然带某种去重/合并语义而做出多余处理。

## 主图

![main](./main.puml)

## 子图：两轮覆盖对比

![overwrite-rounds](./subfigures/overwrite-rounds.puml)

## 数据准备

```ts
// Round 1
state.internalStore.set('$r0', 'v1')
await executeMove(
  move({ kind: 'internal', name: '$r0' }, { kind: 'internal', name: '$r1' }),
  state
)
// 此时：$r1 = 'v1'

// Round 2：手动 mutate $r0 后再写
state.internalStore.set('$r0', 'v2')
await executeMove(
  move({ kind: 'internal', name: '$r0' }, { kind: 'internal', name: '$r1' }),
  state
)
```

## 预期结果与验证

```ts
expect(state.internalStore.get('$r1'))
  .toBe('v2')  // 仅最后一次的值
```

## 设计决策说明

- 不需要也不应该检查中间状态（Round 1 后 $r1='v1'）——那是 #15 的范畴
- 仅断言最终值，验证"覆盖语义而非追加"
- 如果某次实现错误地写成"如果 target 已有值则保留为数组"或"merge"而非"覆盖"，这条会立刻挂掉
