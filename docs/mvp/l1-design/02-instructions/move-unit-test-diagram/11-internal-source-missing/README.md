# Test #11: source 不存在抛 AddressError

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('错误处理') → test('source 不存在抛 AddressError')

## 目的

internal register 从未写过时应报"读取源失败"——而非等到 write 阶段才暴露更靠后、更难定位的错误。这是 resolve 阶段的失败路径。

## 主图

![main](./main.puml)

## 数据准备

```ts
// 不预置 $missing —— 故意保证 resolve 失败
const entry = move(
  { kind: 'internal', name: '$missing' },
  { kind: 'internal', name: '$r0' }
)
```

## 预期结果与验证

```ts
await expect(executeMove(entry, state))
  .rejects.toThrow(AddressError)  // 匹配具体子类
```

## 设计决策说明

用 `AddressError` 而非泛化 `Error — 防止实现悄悄降级为普通 Error，丢失结构化错误码（VARIABLE_NOT_FOUND 等）。如果将来要上层根据错误码做差异化处理，匹配具体子类是必要前提。
