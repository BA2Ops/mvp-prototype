# Test #8: L3 返回空 children 与抛错是不同路径

> **Source**: `` → describe('')

## 目的

空 children 是正常 resolve，抛错是 reject；两条支路必须互不干扰。

## 主图

![main](./main.puml)

## 数据准备

```ts
createMockL3([])
entry={type:'empty'}
```

## 预期结果与验证

```ts
resolves.not.toThrow()
entry.phase === 'awaiting_children'
```

## 设计决策说明

与 #7 的抛错路径明显分离——防止混入。

