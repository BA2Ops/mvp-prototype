# Test #14: 错误时状态不变（atomic）

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('错误处理') → test('错误时状态不变（atomic）')

## 目的

move 内部是 resolve(源)→write(目标) 两步；如果第一步就挂理论上不可能动过任何存储——但如果第二步才挂、而实现没做好顺序安排，就可能留下被污染了一半的目标值。这条验证无论哪步失败，最终可见状态都跟执行前完全一致。

## 主图

![main](./main.puml)

## 数据准备

```ts
state.internalStore.set('$r0', 'pre-existing')  // 哨兵值

const entry = move(
  { kind: 'internal', name: '$missing' },       // ← 必然在 resolve 阶段就炸
  { kind: 'internal', name: '$r0' }             // ← 目标恰好是哨兵所在
)
```

## 预期结果与验证

```ts
await expect(executeMove(entry, state))
  .rejects.toThrow()

// 核心断言：哨兵值原封未动
expect(state.internalStore.get('$r0'))
  .toBe('pre-existing')
```

## 设计决策说明

这是全文件里**唯一**一条直接以 "data hasn't been touched by a failed operation" 作为独立可观察结论的测试——其他错误处理测试只验证异常本身，本条还验证数据面。如果实现错误地写成"先 write 后 resolve"，目标会被预填 'pre-existing' 之外的值（比如 null / undefined / 部分字段），这条会立刻挂掉。
