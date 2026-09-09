# Test #10: 失败时不弹栈

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('栈行为') → test('失败时不弹栈')

## 目的

与 #9 镜像：resolve/write 中途抛错时 entry 必须原地保留，不能默默消失。这条专门拦"反正报错了顺手清理现场"的好心办坏事实现倾向。

## 主图

![main](./main.puml)

## 子图：失败时栈保留时序

![failure-flow](./subfigures/failure-flow.puml)

## 数据准备

```ts
const entry = move(
  { kind: 'internal', name: '$missing' },  // ← 从未写入，保证触发 AddressError
  { kind: 'internal', name: '$r0' }
)
state.stack.push(entry)
```

## 预期结果与验证

```ts
await expect(executeMove(entry, state))
  .rejects.toThrow()
expect(state.stack.length).toBe(1)  // 关键：栈长度不变
```

## 设计决策说明

重点在第二条断言（栈长度不变）。很多人直觉上会觉得"反正都报错了顺手清理一下现场也挺合理"——但 main loop 需要这条 entry 仍可见，才能在 abort 整条 frame 时正确归因到具体哪一步出了问题。如果悄悄弹出，main loop 就丢失了关键诊断信息。
