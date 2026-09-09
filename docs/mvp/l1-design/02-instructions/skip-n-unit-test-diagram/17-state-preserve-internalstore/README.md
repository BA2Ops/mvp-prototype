# Test #17: 不动 internalStore

> **Source**: `` → describe('')

## 目的

skip_n 不应改写任何内部寄存器，包括 $r_err。

## 主图

![main](./main.puml)

## 数据准备

```ts
internalStore.set('$r0', 'preserve me')
internalStore.set('$r_err', null)
stack: [skip]
```

## 预期结果与验证

```ts
expect(internalStore.get('$r0')).toBe('preserve me')
expect(internalStore.has('$r_err')).toBe(true)
```

## 设计决策说明

包含 $r_err 全局功能寄存器——验证 skip_n 与 error 流无关。

