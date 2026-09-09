# Test #4: internal → internal（寄存器重命名）

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('internal → internal（寄存器重命名）')

## 目的

同区内复制到另一名字下，source 未被清空/覆盖。验证 move 的'复制而非移动'语义在 internal 区内部也成立。

## 主图

![main](./main.puml)

## 数据准备

```ts
state.internalStore.set('$r0', 'value')\nstate.stack.push({\n  kind: 'move',\n  from: { kind: 'internal', name: '$r0' },\n  to:   { kind: 'internal', name: '$r1' }\n})
```

## 预期结果与验证

```ts
expect(state.internalStore.get('$r0'))\n  .toBe('value')  // 不变\nexpect(state.internalStore.get('$r1'))\n  .toBe('value')  // 新写入
```

## 设计决策说明

两条断言缺一不可：仅验证 $r1 拿到值不够——必须同时验证 $r0 保持原样。这是'复制'而非'移动'的契约锚点。

