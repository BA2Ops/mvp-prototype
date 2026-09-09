# Test #19: 不动 l2/l3 引用

> **Source**: `` → describe('')

## 目的

skip_n 不应替换 registry / L3 引用。

## 主图

![main](./main.puml)

## 数据准备

```ts
l2Ref = state.l2
l3Ref = state.l3
stack: [skip]
```

## 预期结果与验证

```ts
expect(state.l2).toBe(l2Ref)
expect(state.l3).toBe(l3Ref)
```

## 设计决策说明

引用同一性检查——handler 内部错误地 replace registry 会立刻暴露。

