# Test #3: public → internal（业务加载到寄存器）

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('public → internal（业务加载到寄存器）')

## 目的

与 #2 对称的 inbound 反向。已有业务数据能读进寄存器供后续 op 使用。

## 主图

![main](./main.puml)

## 数据准备

```ts
state.publicStore.set('business_var', 'business_value')\nstate.stack.push({\n  kind: 'move',\n  from: { kind: 'public',   name: 'business_var' },\n  to:   { kind: 'internal', name: '$r0' }\n})
```

## 预期结果与验证

```ts
expect(state.internalStore.get('$r0'))\n  .toBe('business_value')
```

## 设计决策说明

这是 L1 primitive 的核心 inbound 通路——业务数据进入计算区后由后续 op 处理。publicStore 端的 source 同样不被清空。

