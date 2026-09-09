# Test #16: 不动 internalStore

> **Source**: `` → describe('')

## 目的

executeIntent 不应改写任何内部寄存器，包括 $r_err。

## 主图

![main](./main.puml)

## 数据准备

```ts
createMockL3([])
internalStore.set('$r0','preserve')
internalStore.set('$r_err', null)
```

## 预期结果与验证

```ts
$r0 === 'preserve'
internalStore.has('$r_err') === true
```

## 设计决策说明

include $r_err 关键全局寄存器验证。

