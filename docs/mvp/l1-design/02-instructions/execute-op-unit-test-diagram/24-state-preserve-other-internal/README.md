# Test #24: 不动其他内部寄存器

> **Source**: `` → describe('')

## 目的

execute_op 不应改写未涉及的内部寄存器。

## 主图

![main](./main.puml)

## 数据准备

```ts
internalStore.set('$r_other','preserve')
$r0=5
entry=mock_op
```

## 预期结果与验证

```ts
$r_other === 'preserve'
```

## 设计决策说明

only outputs 引用的寄存器被改写——其他不动。

