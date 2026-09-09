# Test #1: literal → internal（常量加载到寄存器）

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('literal → internal（常量加载到寄存器）')

## 目的

最基础字面量入参：不依赖既有状态的值能进入内部区。验证 move 对 literal source 的最简路径。literal 自带 value，无需预置任何 state。

## 主图

![main](./main.puml)

## 数据准备

```ts
state.stack.push({\n  kind: 'move',\n  from: { kind: 'literal', value: 'hello' },\n  to:   { kind: 'internal', name: '$r0' }\n})
```

## 预期结果与验证

```ts
expect(state.internalStore.get('$r0'))\n  .toBe('hello')
```

## 设计决策说明

literal 作为 source 是常量节点的唯一合法角色。本测试确认 move 把 literal value 完整搬入目标区，未做任何额外转换（无 clone / JSON 序列化）。

