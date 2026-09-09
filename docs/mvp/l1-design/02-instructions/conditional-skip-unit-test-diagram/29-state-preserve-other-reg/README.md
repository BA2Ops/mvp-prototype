# Test #29: 不动其他 internal 寄存器

> **Source**: `` → describe('')

## 目的

conditional_skip 不应改写未涉及的内部寄存器。

## 主图

![main](./main.puml)

## 数据准备

```ts
internalStore.set('$r_other','preserve')
$r_cond=true
stack: [cond]
```

## 预期结果与验证

```ts
expect(internalStore.get('$r_other')).toBe('preserve')
```

## 设计决策说明

only conditionAddr.name 引用的寄存器可能被读取，其他不动。

