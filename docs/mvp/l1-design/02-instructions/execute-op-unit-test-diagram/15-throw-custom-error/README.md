# Test #15: 自定义 throw 的 Error 向上抛

> **Source**: `` → describe('')

## 目的

任意 Error 实例（含 message）都能原样透传。

## 主图

![main](./main.puml)

## 数据准备

```ts
createProgrammableOp({name:'custom_throw'}, behavior:{kind:'throw', error:new Error('custom hard error')})
```

## 预期结果与验证

```ts
rejects.toThrow('custom hard error')
```

## 设计决策说明

验证 throw 路径不修改 Error 实例（无 wrap）。

