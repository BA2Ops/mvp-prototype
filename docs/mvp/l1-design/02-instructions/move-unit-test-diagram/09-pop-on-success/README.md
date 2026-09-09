# Test #9: 成功时弹栈

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('栈行为') → test('成功时弹栈')

## 目的

happy path 下 move 执行完一定把自身 entry 摘掉，否则后续逻辑会重复消费。L1 main-loop 依赖每条 primitive 是否主动把自己从 `state.stack` 移除来决定循环继续往下走还是停下来等错误处理接管。这条测试是这个协议本身的单元测试层锚点。

## 主图

![main](./main.puml)

## 子图：栈 push → executeMove → self-pop 时序

![stack-flow](./subfigures/stack-flow.puml)

## 数据准备

```ts
state.stack.push({
  id: 'pre', kind: 'move',
  from: { kind: 'literal', value: 1 },
  to:   { kind: 'internal', name: '$r0' }
})

const entry = move(
  { kind: 'literal', value: 'hello' },
  { kind: 'internal', name: '$r1' }
)
state.stack.push(entry)

expect(state.stack.length).toBe(2)  // 推入后
```

## 预期结果与验证

```ts
await executeMove(entry, state)
expect(state.stack.length).toBe(1)  // 执行后恰好减 1
```

## 设计决策说明

前后两次 length 检查合起来才算完整证明"恰好减了 1"——单看 after.length===1 不足以排除"减了 2 之外补了一条 marker"或"减了 0 没弹但 length 巧合是 1（不太可能但形式上要排除）"等异常路径。
