# Test #14: op throw 时向上抛（不写入 outputs）

> **Source**: `` → describe('')

## 目的

handler throw 不进入 write 阶段，原异常上抛；outputs 保持未写入。

## 主图

![main](./main.puml)

## 数据准备

```ts
entry=throwing_op(outputs:{result:$r1})
```

## 预期结果与验证

```ts
rejects.toThrow(/hard error/)
internalStore.has('$r1') === false
```

## 设计决策说明

硬错误路径关键不变量：throw 在 write 之前。

