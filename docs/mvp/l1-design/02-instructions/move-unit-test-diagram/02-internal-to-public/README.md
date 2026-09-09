# Test #2: internal → public（寄存器保存到业务）

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('internal → public（寄存器保存到业务）')

## 目的

op 计算完的产物能持久化回业务侧存储（outbound）。这是 move 的核心 outbound 场景——内部计算结果必须能流出到业务可见区域供下游使用。

## 主图

![main](./main.puml)

## 数据准备

```ts
state.internalStore.set('$r0', 'result_data')\nstate.stack.push({\n  kind: 'move',\n  from: { kind: 'internal', name: '$r0' },\n  to:   { kind: 'public',   name: 'output_content' }\n})
```

## 预期结果与验证

```ts
expect(state.publicStore.get('output_content'))\n  .toBe('result_data')
```

## 设计决策说明

注意：internalStore 端的 source 不会被清空——move 是'复制'而非'移动'。这与很多直觉相反（move = 搬走原值），但作为语义已明确。

