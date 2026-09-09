# Test #13: 写入 literal 抛错（设计约束）

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('错误处理') → test('写入 literal 抛错（设计约束）')

## 目的

literal 在架构上是只读的常量节点——往里写是**调用方传参错**而非运行期偶发故障。专门钉死 `LITERAL_WRITE` 这个特定 code/message。

## 主图

![main](./main.puml)

## 数据准备

```ts
const entry = move(
  { kind: 'literal', value: 'x' },
  { kind: 'literal', value: 'y' }  // ← 故意违反只读约束
)
```

## 预期结果与验证

```ts
// 连续两步验证
await expect(executeMove(entry, state))
  .rejects.toThrow(AddressError)
await expect(executeMove(entry, state))
  .rejects.toThrow(/literal/)  // message 文本含 literal 关键词
```

## 设计决策说明

两步分开而非合并：第一步确认异常类型正确（AddressError），第二步正则核对 message 含 "literal" 关键词。万一实现只抛了 Error 没附 message，第二步会立刻挂掉——这就是把"诊断信息完整性"作为独立可观察结论的好处。
