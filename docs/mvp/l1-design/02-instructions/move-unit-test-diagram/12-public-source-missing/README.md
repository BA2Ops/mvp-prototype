# Test #12: source public 不存在抛错

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('错误处理') → test('source public 不存在抛错')

## 目的

#11 的 public 侧镜像版本——public 区的 missing key 也要走完全一致的处理路径，防止某次重构只修好了 internal 一侧。

## 主图

![main](./main.puml)

## 数据准备

```ts
const entry = move(
  { kind: 'public', name: 'missing' },  // public 区从未写入
  { kind: 'internal', name: '$r0' }
)
```

## 预期结果与验证

```ts
await expect(executeMove(entry, state))
  .rejects.toThrow(AddressError)
```

## 设计决策说明

两个区（internal / public）的 missing key 走相同路径——这是 resolver 层的一致性保证。如果某次实现错误地把 internal → public 的两条 lookup 路径写成了两段独立代码，且只给一段加了 AddressError 处理，这条用例会立刻挂掉。
